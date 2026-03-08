import { constants, generateKeyPairSync, sign } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import {
  type Algorithm,
  signatureHeadersSync,
  signatureHeaders,
  type RequestLike,
  type Signer,
  type SignerSync,
} from "http-message-sig";
import { HttpSigAlgorithm, verifyHttpMessageSignature } from "./httpSig";

type PrivateKey = ReturnType<typeof generateKeyPairSync>["privateKey"];
type DigestHttpSigAlgorithm = Exclude<HttpSigAlgorithm, "eth-personal-sign">;

function signByAlgorithm(
  algorithm: DigestHttpSigAlgorithm,
  privateKey: PrivateKey,
  signingString: string,
): Uint8Array {
  const data = Buffer.from(signingString, "utf8");

  switch (algorithm) {
    case "rsa-v1_5-sha256":
      return sign(
        "sha256",
        data,
        { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      );
    case "rsa-pss-sha512":
      return sign("sha512", data, {
        key: privateKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      });
    case "ecdsa-p256-sha256":
      return sign("sha256", data, privateKey);
    case "ecdsa-p384-sha384":
      return sign("sha384", data, privateKey);
    default:
      throw new Error("unsupported signature algorithm");
  }
}

function createSignedRequest(input: {
  keyId: string;
  privateKey: PrivateKey;
  algorithm: DigestHttpSigAlgorithm;
}): RequestLike {
  const message: RequestLike = {
    method: "POST",
    url: "/verify",
    protocol: "http",
    headers: {
      host: "pod.web-os.live",
      date: "Sat, 07 Mar 2026 12:00:00 GMT",
    },
  };

  const signer: SignerSync = {
    keyid: input.keyId,
    alg: input.algorithm as Algorithm,
    signSync: (signingString) =>
      signByAlgorithm(input.algorithm, input.privateKey, signingString),
  };

  const headers = signatureHeadersSync(message, {
    signer,
    components: ["@method", "@path", "host", "date"],
  });

  message.headers = {
    ...message.headers,
    signature: headers.Signature,
    "signature-input": headers["Signature-Input"],
  };

  return message;
}

test("accepts valid RSA HTTP message signature", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyId = "owner-rsa";
  const request = createSignedRequest({
    keyId,
    privateKey,
    algorithm: "rsa-v1_5-sha256",
  });

  const verified = await verifyHttpMessageSignature(request, async (requestedKeyId) => {
    if (requestedKeyId !== keyId) {
      return undefined;
    }

    return publicKey.export({ type: "spki", format: "pem" }).toString();
  });

  assert.equal(verified, true);
});

test("accepts valid ECDSA HTTP message signature", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const keyId = "owner-ecdsa";
  const request = createSignedRequest({
    keyId,
    privateKey,
    algorithm: "ecdsa-p256-sha256",
  });

  const verified = await verifyHttpMessageSignature(request, async (requestedKeyId) => {
    if (requestedKeyId !== keyId) {
      return undefined;
    }

    return publicKey.export({ type: "spki", format: "pem" }).toString();
  });

  assert.equal(verified, true);
});

test("rejects invalid HTTP message signature", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyId = "owner-rsa";
  const request = createSignedRequest({
    keyId,
    privateKey,
    algorithm: "rsa-v1_5-sha256",
  });

  (request.headers as Record<string, string>)["date"] = "Sat, 07 Mar 2026 13:00:00 GMT";

  const verified = await verifyHttpMessageSignature(request, async (requestedKeyId) => {
    if (requestedKeyId !== keyId) {
      return undefined;
    }

    return publicKey.export({ type: "spki", format: "pem" }).toString();
  });

  assert.equal(verified, false);
});

test("rejects signature with unknown key id", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const request = createSignedRequest({
    keyId: "owner-rsa",
    privateKey,
    algorithm: "rsa-v1_5-sha256",
  });

  const verified = await verifyHttpMessageSignature(request, async (): Promise<string | undefined> => {
    return undefined;
  });

  assert.equal(verified, false);
});

test("accepts valid Ethereum personal_sign HTTP message signature", async () => {
  const wallet = Wallet.createRandom();
  const keyId = wallet.address.toLowerCase();
  const message: RequestLike = {
    method: "POST",
    url: "/verify",
    protocol: "http",
    headers: {
      host: "pod.web-os.live",
      date: "Sat, 07 Mar 2026 12:00:00 GMT",
    },
  };

  const signer: Signer = {
    keyid: keyId,
    alg: "eth-personal-sign" as unknown as Signer["alg"],
    sign: async (signingString) => {
      const signatureHex = await wallet.signMessage(signingString);
      return Buffer.from(signatureHex.slice(2), "hex");
    },
  };

  const headers = await signatureHeaders(message, {
    signer,
    components: ["@method", "@path", "host", "date"],
  });

  message.headers = {
    ...message.headers,
    signature: headers.Signature,
    "signature-input": headers["Signature-Input"],
  };

  const verified = await verifyHttpMessageSignature(message, async (): Promise<string | undefined> => {
    return undefined;
  });

  assert.equal(verified, true);
});

test("rejects Ethereum personal_sign signature for different key id", async () => {
  const wallet = Wallet.createRandom();
  const message: RequestLike = {
    method: "POST",
    url: "/verify",
    protocol: "http",
    headers: {
      host: "pod.web-os.live",
      date: "Sat, 07 Mar 2026 12:00:00 GMT",
    },
  };

  const signer: Signer = {
    keyid: Wallet.createRandom().address.toLowerCase(),
    alg: "eth-personal-sign" as unknown as Signer["alg"],
    sign: async (signingString) => {
      const signatureHex = await wallet.signMessage(signingString);
      return Buffer.from(signatureHex.slice(2), "hex");
    },
  };

  const headers = await signatureHeaders(message, {
    signer,
    components: ["@method", "@path", "host", "date"],
  });

  message.headers = {
    ...message.headers,
    signature: headers.Signature,
    "signature-input": headers["Signature-Input"],
  };

  const verified = await verifyHttpMessageSignature(message, async (): Promise<string | undefined> => {
    return undefined;
  });

  assert.equal(verified, false);
});
