import { constants, verify as verifyDigestSignature } from "node:crypto";
import { verifyMessage } from "ethers";
import { verify, type Parameters, type RequestLike } from "http-message-sig";

export type HttpSigAlgorithm =
  | "rsa-v1_5-sha256"
  | "rsa-pss-sha512"
  | "ecdsa-p256-sha256"
  | "ecdsa-p384-sha384"
  | "eth-personal-sign";

export type PublicKeyResolver = (
  keyId: string,
  algorithm: HttpSigAlgorithm,
) => string | Buffer | undefined | Promise<string | Buffer | undefined>;

function parseStringParam(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

function parseAlgorithm(value: unknown): HttpSigAlgorithm | null {
  const algorithm = parseStringParam(value);

  switch (algorithm) {
    case "rsa-v1_5-sha256":
    case "rsa-pss-sha512":
    case "ecdsa-p256-sha256":
    case "ecdsa-p384-sha384":
    case "eth-personal-sign":
      return algorithm;
    default:
      return null;
  }
}

function bytesToHex(value: Uint8Array): string {
  return `0x${Buffer.from(value).toString("hex")}`;
}

function verifyEthereumPersonalSign(
  keyId: string,
  signingString: string,
  signature: Uint8Array,
): boolean {
  try {
    const recoveredAddress = verifyMessage(signingString, bytesToHex(signature));
    return recoveredAddress.toLowerCase() === keyId.toLowerCase();
  } catch {
    return false;
  }
}

function verifyByAlgorithm(
  algorithm: HttpSigAlgorithm,
  signingString: string,
  signature: Uint8Array,
  publicKey: string | Buffer,
): boolean {
  const payload = Buffer.from(signingString, "utf8");

  switch (algorithm) {
    case "rsa-v1_5-sha256":
      return verifyDigestSignature(
        "sha256",
        payload,
        { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
        signature,
      );
    case "rsa-pss-sha512":
      return verifyDigestSignature(
        "sha512",
        payload,
        {
          key: publicKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
        },
        signature,
      );
    case "ecdsa-p256-sha256":
      return verifyDigestSignature("sha256", payload, publicKey, signature);
    case "ecdsa-p384-sha384":
      return verifyDigestSignature("sha384", payload, publicKey, signature);
    default:
      return false;
  }
}

export async function verifyHttpMessageSignature(
  request: RequestLike,
  resolvePublicKey: PublicKeyResolver,
  expectedKeyId?: string,
): Promise<boolean> {
  try {
    return await verify(request, async (signingString, signature, params: Parameters) => {
      const keyId = parseStringParam(params.keyid);
      const algorithm = parseAlgorithm(params.alg);

      if (!keyId || !algorithm) {
        return false;
      }

      if (expectedKeyId && keyId.toLowerCase() !== expectedKeyId.toLowerCase()) {
        return false;
      }

      if (algorithm === "eth-personal-sign") {
        return verifyEthereumPersonalSign(keyId, signingString, signature);
      }

      const publicKey = await resolvePublicKey(keyId, algorithm);
      if (!publicKey) {
        return false;
      }

      return verifyByAlgorithm(algorithm, signingString, signature, publicKey);
    });
  } catch {
    return false;
  }
}
