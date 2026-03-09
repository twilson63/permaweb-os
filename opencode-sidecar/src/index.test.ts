import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import test from "node:test";
import { Wallet } from "ethers";
import { signatureHeaders, type RequestLike, type Signer } from "http-message-sig";
import { computeContentDigest } from "./httpSig";
import { createSidecarServer } from "./index";

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

test("POST /verify returns 400 for missing content", async () => {
  const wallet = Wallet.createRandom();
  const ownerKeyId = wallet.address.toLowerCase();

  const server = createSidecarServer({ ownerKeyId });
  const sidecarPort = await listen(server);

  try {
    const host = `127.0.0.1:${sidecarPort}`;
    const date = new Date().toUTCString();
    const body = JSON.stringify({});
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
      body, // No content field
    });

    assert.equal(response.status, 400);
    const responseBody = await response.json();
    assert.equal(responseBody.error, "missing content");
  } finally {
    await close(server);
  }
});

test("POST /verify returns 401 for invalid signature", async () => {
  const wallet = Wallet.createRandom();
  const ownerKeyId = wallet.address.toLowerCase();

  const server = createSidecarServer({ ownerKeyId });
  const sidecarPort = await listen(server);

  try {
    const host = `127.0.0.1:${sidecarPort}`;
    const signedDate = new Date().toUTCString();
    const tamperedDate = new Date(Date.now() + 60_000).toUTCString();
    const body = JSON.stringify({ content: "hello" });
    const signedHeaders = await createSignedHeaders({
      wallet,
      keyId: ownerKeyId,
      host,
      date: signedDate,
      body,
    });

    const response = await fetch(`http://${host}/verify`, {
      method: "POST",
      headers: {
        date: tamperedDate,
        "content-digest": computeContentDigest(body),
        signature: signedHeaders.Signature,
        "signature-input": signedHeaders["Signature-Input"],
        "content-type": "application/json",
      },
      body,
    });

    assert.equal(response.status, 401);
    const responseBody = await response.json();
    assert.equal(responseBody.error, "invalid signature");
  } finally {
    await close(server);
  }
});

test("POST /verify returns 401 for missing signature", async () => {
  const server = createSidecarServer({ ownerKeyId: "owner" });
  const sidecarPort = await listen(server);

  try {
    const host = `127.0.0.1:${sidecarPort}`;

    const response = await fetch(`http://${host}/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-digest": computeContentDigest(JSON.stringify({ content: "hello" })),
      },
      body: JSON.stringify({ content: "hello" }),
    });

    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, "missing signature header");
  } finally {
    await close(server);
  }
});

test("POST /verify returns 400 for invalid JSON", async () => {
  const wallet = Wallet.createRandom();
  const ownerKeyId = wallet.address.toLowerCase();

  const server = createSidecarServer({ ownerKeyId });
  const sidecarPort = await listen(server);

  try {
    const host = `127.0.0.1:${sidecarPort}`;
    const date = new Date().toUTCString();
    const body = "not valid json";
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

    assert.equal(response.status, 400);
    const responseBody = await response.json();
    assert.equal(responseBody.error, "invalid JSON");
  } finally {
    await close(server);
  }
});

test("POST /verify returns 401 for tampered request body", async () => {
  const wallet = Wallet.createRandom();
  const ownerKeyId = wallet.address.toLowerCase();

  const server = createSidecarServer({ ownerKeyId });
  const sidecarPort = await listen(server);

  try {
    const host = `127.0.0.1:${sidecarPort}`;
    const date = new Date().toUTCString();
    const signedBody = JSON.stringify({ content: "hello" });
    const tamperedBody = JSON.stringify({ content: "tampered" });
    const signedHeaders = await createSignedHeaders({
      wallet,
      keyId: ownerKeyId,
      host,
      date,
      body: signedBody,
    });

    const response = await fetch(`http://${host}/verify`, {
      method: "POST",
      headers: {
        date,
        "content-digest": computeContentDigest(signedBody),
        signature: signedHeaders.Signature,
        "signature-input": signedHeaders["Signature-Input"],
        "content-type": "application/json",
      },
      body: tamperedBody,
    });

    assert.equal(response.status, 401);
    const responseBody = await response.json();
    assert.equal(responseBody.error, "invalid content digest");
  } finally {
    await close(server);
  }
});
