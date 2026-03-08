import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import test from "node:test";
import { Wallet } from "ethers";
import { signatureHeaders, type RequestLike, type Signer } from "http-message-sig";
import { createSidecarServer } from "./index";

function signatureHexToBytes(signatureHex: string): Uint8Array {
  return Buffer.from(signatureHex.slice(2), "hex");
}

async function createSignedHeaders(input: {
  wallet: { signMessage: (message: string) => Promise<string> };
  keyId: string;
  host: string;
  date: string;
}): Promise<{ Signature: string; "Signature-Input": string }> {
  const message: RequestLike = {
    method: "POST",
    url: "/verify",
    protocol: "http",
    headers: {
      host: input.host,
      date: input.date,
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
    components: ["@method", "@path", "host", "date"],
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

test("POST /verify proxies verified request as JSONL stream", async () => {
  const wallet = Wallet.createRandom();
  const ownerKeyId = wallet.address.toLowerCase();
  const openCodeServer = createServer((req, res) => {
    assert.equal(req.url, "/verify");
    assert.equal(req.method, "POST");
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write('{"type":"assistant_message","content":"hello"}\n');
    res.end('{"type":"done","status":"success"}\n');
  });
  const openCodePort = await listen(openCodeServer);
  const server = createSidecarServer({
    ownerKeyId,
    openCodeBaseUrl: `http://127.0.0.1:${openCodePort}`,
  });
  const sidecarPort = await listen(server);

  try {
    const host = `127.0.0.1:${sidecarPort}`;
    const date = new Date().toUTCString();
    const signedHeaders = await createSignedHeaders({ wallet, keyId: ownerKeyId, host, date });

    const response = await fetch(`http://${host}/verify`, {
      method: "POST",
      headers: {
        date,
        signature: signedHeaders.Signature,
        "signature-input": signedHeaders["Signature-Input"],
      },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/x-ndjson");

    const body = await response.text();
    assert.equal(
      body,
      '{"type":"assistant_message","content":"hello"}\n{"type":"done","status":"success"}\n',
    );
  } finally {
    await Promise.all([close(server), close(openCodeServer)]);
  }
});

test("POST /verify returns 401 for invalid signature", async () => {
  const wallet = Wallet.createRandom();
  const ownerKeyId = wallet.address.toLowerCase();
  let upstreamCalled = false;
  const openCodeServer = createServer((_req, res) => {
    upstreamCalled = true;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}\n");
  });
  const openCodePort = await listen(openCodeServer);
  const server = createSidecarServer({
    ownerKeyId,
    openCodeBaseUrl: `http://127.0.0.1:${openCodePort}`,
  });
  const sidecarPort = await listen(server);

  try {
    const host = `127.0.0.1:${sidecarPort}`;
    const signedDate = new Date().toUTCString();
    const tamperedDate = new Date(Date.now() + 60_000).toUTCString();
    const signedHeaders = await createSignedHeaders({ wallet, keyId: ownerKeyId, host, date: signedDate });

    const response = await fetch(`http://${host}/verify`, {
      method: "POST",
      headers: {
        date: tamperedDate,
        signature: signedHeaders.Signature,
        "signature-input": signedHeaders["Signature-Input"],
      },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 401);
    assert.equal(upstreamCalled, false);
  } finally {
    await Promise.all([close(server), close(openCodeServer)]);
  }
});
