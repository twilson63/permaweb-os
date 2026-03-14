/**
 * @fileoverview Arweave wallet authentication utilities.
 * @author Web OS contributors
 * @exports isValidArweaveAddress, verifyArweaveSignature, detectWalletType, WalletType
 */

import { constants, createPublicKey, verify as cryptoVerify } from "node:crypto";
import Arweave from "arweave";

// Arweave instance for verification
const arweave = Arweave.init({});

/**
 * Supported wallet types for authentication.
 */
export type WalletType = "ethereum" | "arweave" | "rsa" | "ecdsa";

/**
 * JWK key components for Arweave RSA keys.
 */
export interface ArweaveJWK {
  kty: "RSA";
  n: string;
  e: string;
  d?: string;
  p?: string;
  q?: string;
  dp?: string;
  dq?: string;
  qi?: string;
}

/**
 * Verifies an Arweave signature using the Arweave SDK.
 * This is the recommended way to verify Arweave signatures.
 *
 * @param message - Original message that was signed.
 * @param signature - Base64URL-encoded signature.
 * @param jwk - The JWK public key from the wallet.
 * @returns `true` if signature is valid.
 */
export async function verifyArweaveSignatureWithSdk(
  message: string,
  signature: string,
  jwk: ArweaveJWK
): Promise<boolean> {
  try {
    console.log('[Arweave] Using Arweave SDK for verification');
    
    // Convert message to Uint8Array
    const messageBytes = new TextEncoder().encode(message);
    
    // Convert base64url signature to Uint8Array
    const signatureBytes = Arweave.utils.b64UrlToBuffer(signature);
    
    console.log('[Arweave] SDK message bytes:', messageBytes.byteLength);
    console.log('[Arweave] SDK signature bytes:', signatureBytes.byteLength);
    
    // Use Arweave SDK to verify
    // Arweave.crypto.verify takes (publicModulus, data, signature)
    // publicModulus is just the 'n' value from JWK
    const isValid = await Arweave.crypto.verify(
      jwk.n,
      messageBytes,
      signatureBytes
    );
    
    console.log('[Arweave] SDK verification result:', isValid);
    return isValid;
  } catch (error) {
    console.error('[Arweave] SDK verification error:', error);
    return false;
  }
}

/**
 * Validates an Arweave wallet address format.
 *
 * Arweave addresses are Base64URL-encoded 256-bit values,
 * resulting in 43 characters.
 *
 * @param address - Candidate address string.
 * @returns `true` if the address matches Arweave format.
 */
export function isValidArweaveAddress(address: string): boolean {
  // Arweave addresses are Base64URL (A-Za-z0-9_-) and exactly 43 characters
  return /^[A-Za-z0-9_-]{43}$/.test(address);
}

/**
 * Validates an Ethereum wallet address format.
 *
 * @param address - Candidate address string.
 * @returns `true` if the address matches Ethereum format.
 */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Detects wallet type from address format.
 *
 * @param address - Wallet address to analyze.
 * @returns Detected wallet type or `null` if unrecognized.
 */
export function detectWalletType(address: string): WalletType | null {
  const trimmed = address.trim();

  if (isValidEthereumAddress(trimmed)) {
    return "ethereum";
  }

  if (isValidArweaveAddress(trimmed)) {
    return "arweave";
  }

  return null;
}

/**
 * Normalizes a wallet address based on type.
 *
 * @param address - Wallet address to normalize.
 * @returns Normalized address.
 * @throws {Error} If the address format is invalid.
 */
export function normalizeWalletAddress(address: string): string {
  const trimmed = address.trim();
  const walletType = detectWalletType(trimmed);

  if (!walletType) {
    throw new Error("Invalid wallet address format");
  }

  // Ethereum addresses are case-insensitive but typically lowercase
  if (walletType === "ethereum") {
    return trimmed.toLowerCase();
  }

  // Arweave addresses are case-sensitive and returned as-is
  return trimmed;
}

/**
 * Converts an Arweave JWK public key to PEM format.
 *
 * @param jwk - Arweave JWK containing n and e components.
 * @returns PEM-encoded public key.
 */
export function jwkToPem(jwk: ArweaveJWK): string {
  // Decode base64url-encoded modulus and exponent
  const modulus = Buffer.from(jwk.n, "base64url");
  const exponent = Buffer.from(jwk.e, "base64url");

  // Calculate required modulus buffer size (nearest multiple of 8)
  const modSize = modulus.length;
  const bufSize = Math.ceil(modSize / 8) * 8;

  // Build DER sequence for RSA public key
  // RSAPublicKey ::= SEQUENCE {
  //   modulus INTEGER,
  //   publicExponent INTEGER
  // }

  // Encode INTEGER with proper DER encoding
  const encodeInteger = (buffer: Buffer): Buffer => {
    // If high bit is set, prepend 0x00 for positive integer
    if (buffer[0] && buffer[0]! >= 0x80) {
      const withZero = Buffer.alloc(buffer.length + 1);
      withZero[0] = 0x00;
      buffer.copy(withZero, 1);
      return withZero;
    }
    return buffer;
  };

  const modEncoded = encodeInteger(modulus);
  const expEncoded = encodeInteger(exponent);

  // DER encode sequence
  const derEncode = (tag: number, content: Buffer): Buffer => {
    const len = content.length;
    let lenBytes: Buffer;

    if (len < 128) {
      lenBytes = Buffer.from([len]);
    } else if (len < 256) {
      lenBytes = Buffer.from([0x81, len]);
    } else {
      lenBytes = Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
    }

    return Buffer.concat([Buffer.from([tag]), lenBytes, content]);
  };

  const modSeq = derEncode(0x02, modEncoded); // INTEGER
  const expSeq = derEncode(0x02, expEncoded); // INTEGER
  const rsaKey = derEncode(0x30, Buffer.concat([modSeq, expSeq])); // SEQUENCE

  // Wrap in RSA public key OID
  const rsaOid = Buffer.from([
    0x30, 0x0d, // SEQUENCE length 13
    0x06, 0x09, // OID tag, length 9
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // RSA OID
    0x05, 0x00 // NULL
  ]);

  const bitString = derEncode(0x03, Buffer.concat([Buffer.from([0x00]), rsaKey]));
  const spki = derEncode(0x30, Buffer.concat([rsaOid, bitString]));

  // Convert to PEM
  const base64 = spki.toString("base64");
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

/**
 * Verifies an Arweave signature using RSA-PSS-SHA256.
 *
 * @param message - Original message that was signed.
 * @param signature - Base64URL-encoded signature.
 * @param publicKeyPem - PEM-encoded public key.
 * @returns `true` if signature is valid.
 */
export function verifyArweaveSignatureWithPem(
  message: string,
  signature: string,
  publicKeyPem: string
): boolean {
  try {
    console.log('[Arweave] Verifying signature with PEM');
    console.log('[Arweave] Message:', message);
    console.log('[Arweave] Message length:', message.length);
    console.log('[Arweave] Signature (first 50 chars):', signature.substring(0, 50));
    console.log('[Arweave] Signature length:', signature.length);
    console.log('[Arweave] PEM length:', publicKeyPem.length);
    
    const signatureBuffer = Buffer.from(signature, "base64url");
    const messageBuffer = Buffer.from(message, "utf8");

    console.log('[Arweave] Signature buffer length:', signatureBuffer.length);
    console.log('[Arweave] Message buffer length:', messageBuffer.length);
    
    // Try different padding options
    console.log('[Arweave] Trying RSA-PSS with SALTLEN_DIGEST...');
    let result = cryptoVerify(
      "sha256",
      messageBuffer,
      {
        key: publicKeyPem,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST
      },
      signatureBuffer
    );
    console.log('[Arweave] RSA-PSS SALTLEN_DIGEST result:', result);
    
    if (!result) {
      // Try with SALTLEN_MAX_SIGN
      console.log('[Arweave] Trying RSA-PSS with SALTLEN_MAX_SIGN...');
      result = cryptoVerify(
        "sha256",
        messageBuffer,
        {
          key: publicKeyPem,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_MAX_SIGN
        },
        signatureBuffer
      );
      console.log('[Arweave] RSA-PSS SALTLEN_MAX_SIGN result:', result);
    }
    
    if (!result) {
      // Try with PKCS1 padding (no PSS)
      console.log('[Arweave] Trying RSA PKCS1 padding...');
      result = cryptoVerify(
        "sha256",
        messageBuffer,
        {
          key: publicKeyPem,
          padding: constants.RSA_PKCS1_PADDING
        },
        signatureBuffer
      );
      console.log('[Arweave] RSA PKCS1 result:', result);
    }
    
    console.log('[Arweave] Final verify result:', result);
    return result;
  } catch (error) {
    console.error('[Arweave] Verification error:', error);
    return false;
  }
}

/**
 * Verifies an Arweave signature using JWK public key.
 *
 * @param message - Original message that was signed.
 * @param signature - Base64URL-encoded signature.
 * @param jwk - Arweave JWK containing public key components.
 * @returns `true` if signature is valid.
 */
export function verifyArweaveSignatureWithJwk(
  message: string,
  signature: string,
  jwk: ArweaveJWK
): boolean {
  try {
    const pem = jwkToPem(jwk);
    return verifyArweaveSignatureWithPem(message, signature, pem);
  } catch {
    return false;
  }
}

/**
 * Arweave gateway for key resolution.
 */
export interface ArweaveGateway {
  fetchTransactionData(address: string): Promise<ArweaveJWK | null>;
}

/**
 * Default Arweave gateway implementation.
 */
export class DefaultArweaveGateway implements ArweaveGateway {
  private readonly gatewayUrl: string;

  constructor(gatewayUrl: string = "https://arweave.net") {
    this.gatewayUrl = gatewayUrl;
  }

  /**
   * Fetches the public key for an Arweave address from the gateway.
   *
   * This works by finding the transaction that created the wallet.
   * The public key can be derived from the wallet creation transaction.
   *
   * @param address - Arweave wallet address.
   * @returns JWK public key or null if not found.
   */
  async fetchTransactionData(address: string): Promise<ArweaveJWK | null> {
    try {
      // Arweave addresses are hashes of public keys, not the keys themselves
      // We need to find a transaction from this wallet to get the owner (public key)
      
      // Method 1: Try GraphQL API to find transactions by this address
      const graphqlQuery = {
        query: `{ transactions(owners: ["${address}"], first: 1) { edges { node { owner { address key } } } } }`
      };
      
      console.log('[Arweave] Querying GraphQL for address:', address);
      const graphqlResponse = await fetch(`${this.gatewayUrl}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(graphqlQuery)
      });
      
      if (graphqlResponse.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await graphqlResponse.json() as any;
        const ownerKey = data?.data?.transactions?.edges?.[0]?.node?.owner?.key;
        
        if (ownerKey) {
          console.log('[Arweave] Found public key via GraphQL');
          const jwk: ArweaveJWK = {
            kty: "RSA",
            n: ownerKey,
            e: "AQAB"
          };
          return jwk;
        }
      }
      
      // Method 2: Try direct transaction lookup (legacy)
      const queryUrl = `${this.gatewayUrl}/tx/${address}`;
      console.log('[Arweave] Trying direct lookup:', queryUrl);
      const response = await fetch(queryUrl);

      if (response.ok) {
        const tx = await response.json() as { owner?: string };
        if (tx.owner) {
          console.log('[Arweave] Found owner in transaction');
          const jwk: ArweaveJWK = {
            kty: "RSA",
            n: tx.owner,
            e: "AQAB"
          };
          return jwk;
        }
      }

      console.log('[Arweave] Could not find public key for address:', address);
      return null;
    } catch (error) {
      console.error('[Arweave] Error fetching public key:', error);
      return null;
    }
  }
}

/**
 * Cache entry for Arweave public keys.
 */
interface KeyCacheEntry {
  jwk: ArweaveJWK;
  fetchedAt: number;
}

/**
 * In-memory cache for Arweave public keys.
 */
const keyCache = new Map<string, KeyCacheEntry>();
const KEY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolves the public key for an Arweave address.
 *
 * @param address - Arweave wallet address.
 * @param gateway - Optional gateway for key resolution.
 * @returns JWK public key or null if resolution fails.
 */
export async function resolveArweavePublicKey(
  address: string,
  gateway: ArweaveGateway = new DefaultArweaveGateway()
): Promise<ArweaveJWK | null> {
  // Check cache first
  const cached = keyCache.get(address);
  if (cached && Date.now() - cached.fetchedAt < KEY_CACHE_TTL_MS) {
    return cached.jwk;
  }

  // Fetch from gateway
  const jwk = await gateway.fetchTransactionData(address);

  if (jwk) {
    keyCache.set(address, { jwk, fetchedAt: Date.now() });
  }

  return jwk;
}

/**
 * Verifies an Arweave signature using address-based key resolution.
 *
 * This resolves the public key from the Arweave gateway and verifies
 * the signature.
 *
 * @param message - Original message that was signed.
 * @param signature - Base64URL-encoded signature.
 * @param address - Arweave wallet address.
 * @param gateway - Optional gateway for key resolution.
 * @returns `true` if signature is valid.
 */
export async function verifyArweaveSignature(
  message: string,
  signature: string,
  address: string,
  gateway?: ArweaveGateway
): Promise<boolean> {
  // Try to resolve public key from gateway
  const jwk = await resolveArweavePublicKey(address, gateway);

  if (!jwk) {
    return false;
  }

  return verifyArweaveSignatureWithJwk(message, signature, jwk);
}

/**
 * Clears the key cache (useful for testing).
 */
export function clearKeyCache(): void {
  keyCache.clear();
}