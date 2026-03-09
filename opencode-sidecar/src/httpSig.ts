import { constants, verify as verifyDigestSignature } from "node:crypto";
import { verifyMessage } from "ethers";
import { verify, type Parameters, type RequestLike } from "http-message-sig";

/**
 * HTTP signature algorithms supported by sidecar verification.
 */
export type HttpSigAlgorithm =
  | "rsa-v1_5-sha256"
  | "rsa-pss-sha512"
  | "ecdsa-p256-sha256"
  | "ecdsa-p384-sha384"
  | "eth-personal-sign";

/**
 * Function contract used to resolve a public key by key identifier.
 */
export type PublicKeyResolver = (
  keyId: string,
  algorithm: HttpSigAlgorithm,
) => string | Buffer | undefined | Promise<string | Buffer | undefined>;

/**
 * Coerces unknown parameter values into strings.
 *
 * @param value - Raw parameter value.
 * @returns String representation; empty string for nullish values.
 */
function parseStringParam(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

/**
 * Validates and narrows an algorithm parameter.
 *
 * @param value - Raw `alg` parameter from signature input.
 * @returns Supported algorithm identifier or `null`.
 */
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

/**
 * Encodes byte signatures as `0x`-prefixed hex.
 *
 * @param value - Signature bytes.
 * @returns Hex representation usable by ethers verification helpers.
 */
function bytesToHex(value: Uint8Array): string {
  return `0x${Buffer.from(value).toString("hex")}`;
}

/**
 * Verifies an Ethereum `personal_sign` signature against a keyId address.
 *
 * @param keyId - Expected Ethereum address (case-insensitive).
 * @param signingString - Canonical string signed by the client.
 * @param signature - Raw signature bytes.
 * @returns `true` when the recovered address matches keyId.
 */
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

/**
 * Verifies a signature using non-Ethereum digest algorithms.
 *
 * @param algorithm - Signature algorithm.
 * @param signingString - Canonical string signed by the client.
 * @param signature - Raw signature bytes.
 * @param publicKey - PEM or key buffer used for verification.
 * @returns `true` when the signature is valid.
 */
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

/**
 * Verifies HTTP Message Signatures for incoming requests.
 *
 * @param request - Request-like object containing method, url, and headers.
 * @param resolvePublicKey - Callback to resolve key material for a keyId.
 * @param expectedKeyId - Optional keyId allow-list guard.
 * @returns `true` when the message signature is valid.
 */
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
