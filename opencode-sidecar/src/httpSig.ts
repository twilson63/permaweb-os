import { constants, createHash, verify as verifyDigestSignature } from "node:crypto";
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
 * Reads a single-valued request header from a RequestLike object.
 *
 * @param request - Request-like payload from http-message-sig.
 * @param name - Header name to resolve (case-insensitive).
 * @returns Header value when present and singular.
 */
function getRequestHeader(request: RequestLike, name: string): string | undefined {
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const value = headers[name.toLowerCase()] ?? headers[name];

  if (typeof value === "string") {
    return value;
  }

  return undefined;
}

/**
 * Ensures Signature-Input declares `content-digest` among covered components.
 *
 * @param request - Request-like payload containing Signature-Input.
 * @returns `true` when content-digest is explicitly covered.
 */
function hasContentDigestSignatureComponent(request: RequestLike): boolean {
  const signatureInput = getRequestHeader(request, "signature-input");
  if (!signatureInput) {
    return false;
  }

  return /"content-digest"/i.test(signatureInput);
}

/**
 * Computes an RFC 9530 `Content-Digest` header value for a UTF-8 body.
 *
 * @param body - Request body text.
 * @returns Header value in `sha-256=:<base64>:` format.
 */
export function computeContentDigest(body: string): string {
  const digest = createHash("sha256").update(body, "utf8").digest("base64");
  return `sha-256=:${digest}:`;
}

/**
 * Extracts the `sha-256` digest payload from a Content-Digest header.
 *
 * @param digestHeader - Raw `Content-Digest` header value.
 * @returns Base64 digest payload when present and valid.
 */
function extractSha256Digest(digestHeader: string): string | null {
  const entries = digestHeader
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const match = /^sha-256=:([^:]+):$/i.exec(entry);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Validates request body text against a `Content-Digest` header.
 *
 * @param body - Request body text.
 * @param digestHeader - Raw `Content-Digest` header value.
 * @returns `true` when digest is present and matches the body.
 */
export function validateContentDigest(body: string, digestHeader: string): boolean {
  const digestPayload = extractSha256Digest(digestHeader);
  if (!digestPayload) {
    return false;
  }

  const computedDigestPayload = extractSha256Digest(computeContentDigest(body));
  return computedDigestPayload === digestPayload;
}

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
  if (!hasContentDigestSignatureComponent(request)) {
    return false;
  }

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
