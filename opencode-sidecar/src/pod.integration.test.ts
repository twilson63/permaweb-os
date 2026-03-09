import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import { signatureHeaders, type RequestLike, type Signer } from "http-message-sig";
import { computeContentDigest } from "./httpSig";
import { createSidecarServer } from "./index";
import { createServer, Server } from "node:http";
import { spawn } from "node:child_process";

function signatureHexToBytes(signatureHex: string): Uint8Array {
  return Buffer.from(signatureHex.slice(2), "hex");
}

async function createSignedHeaders(input: {
  wallet: { signMessage: (message: string) => Promise<string> };
  keyId: string;
  host: string;
  date: string;
  body: string;
}): Promise<{ Signature: string; "Signature-Input": string }> {
  const message: RequestLike = {
    method: "POST",
    url: "/verify",
    protocol: "http",
    headers: {
      host: input.host,
      date: input.date,
      "content-digest": computeContentDigest(input.body),
    },
  };

  const signer: Signer = {
    keyid: input.keyId,
    alg: "eth-personal-sign" as unknown as Signer["alg"],
    sign: async (signingString) => {
      const signatureHex = await input.wallet.signMessage(signingString);
      return signatureHexToBytes(signatureHex);
    },
  };

  return signatureHeaders(message, {
    signer,
    components: ["@method", "@path", "host", "date", "content-digest"],
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addressInfo = server.address();

  if (!addressInfo || typeof addressInfo === "string") {
    throw new Error("failed to get listening address");
  }

  return addressInfo.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test("pod integration: signed /verify request runs OpenCode and returns JSONL", async () => {
  const wallet = Wallet.createRandom();
  const ownerKeyId = wallet.address.toLowerCase();

  const sidecarServer = createSidecarServer({
    ownerKeyId,
    // Use default model (no model specified)
  });
  const sidecarPort = await listen(sidecarServer);

  try {
    const host = `127.0.0.1:${sidecarPort}`;
    const date = new Date().toUTCString();
    const body = JSON.stringify({ content: "Say hello in 3 words" });
    const signedHeaders = await createSignedHeaders({ wallet, keyId: ownerKeyId, host, date, body });

    const response = await fetch(`http://${host}/verify`, {
      method: "POST",
      headers: {
        date,
        "content-digest": computeContentDigest(body),
        signature: signedHeaders.Signature,
        "signature-input": signedHeaders["Signature-Input"],
        "content-type": "application/json",
      },
      body,
    });

    assert.equal(response.status, 200, `Expected 200, got ${response.status}`);
    assert.equal(
      response.headers.get("content-type"),
      "application/x-ndjson",
      "Expected JSONL content type"
    );

    const text = await response.text();
    assert.ok(text.length > 0, "Expected non-empty response");

    // Verify it's valid JSONL
    const lines = text.trim().split("\n");
    assert.ok(lines.length > 0, "Expected at least one JSONL line");

    // Each line should be valid JSON
    for (const line of lines) {
      if (line.trim()) {
        const parsed = JSON.parse(line);
        assert.ok(parsed.type, `Expected type field in JSONL line: ${line}`);
      }
    }

    // Should have at least step_start, text, and step_finish
    const types = lines
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l).type);
    
    assert.ok(types.includes("step_start"), "Expected step_start in response");
    assert.ok(types.includes("step_finish"), "Expected step_finish in response");
    assert.ok(types.includes("text"), "Expected text in response");
  } finally {
    await close(sidecarServer);
  }
});
