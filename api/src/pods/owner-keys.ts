/**
 * @fileoverview Owner key generation and management for HTTPSig verification.
 * 
 * Security model:
 * - Each wallet gets a unique RSA key pair for request signing
 * - The private key is returned to the wallet owner (never stored by API)
 * - The public key is stored in a Kubernetes Secret for sidecar verification
 * - The public key is mounted ONLY in the sidecar container (not opencode)
 * - The opencode container has NO access to the owner key
 */

import { createHash, generateKeyPairSync } from "crypto";

/**
 * SHA-256 fingerprint of a public key, truncated for Kubernetes name compatibility.
 */
export function computeKeyId(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
}

/**
 * Generates an RSA key pair for HTTPSig signing/verification.
 * 
 * The private key is used by the wallet owner to sign requests.
 * The public key is used by the sidecar to verify signatures.
 * 
 * @returns Key pair with keyId (SHA-256 fingerprint), public key PEM, and optionally private key PEM
 */
export function generateOwnerKeyPair(): {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const keyId = computeKeyId(publicKey);

  return {
    keyId,
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  };
}

/**
 * Kubernetes secret name for a wallet's owner public key.
 * Format: owner-key-<keyId>
 * 
 * @param keyId - The key identifier (SHA-256 fingerprint)
 * @returns Kubernetes secret name
 */
export function getOwnerKeySecretName(keyId: string): string {
  return `owner-key-${keyId}`;
}

/**
 * In-memory store for owner key metadata.
 * 
 * The actual keys are stored in Kubernetes secrets.
 * This store tracks which key ID is associated with which wallet.
 */
export class OwnerKeyStore {
  private readonly keyIdByWallet = new Map<string, string>();
  private readonly publicKeyByKeyId = new Map<string, string>();

  /**
   * Registers an owner key for a wallet.
   * 
   * @param walletAddress - The wallet address
   * @param keyId - The key identifier
   * @param publicKeyPem - The public key PEM
   */
  register(walletAddress: string, keyId: string, publicKeyPem: string): void {
    this.keyIdByWallet.set(walletAddress, keyId);
    this.publicKeyByKeyId.set(keyId, publicKeyPem);
  }

  /**
   * Gets the key ID for a wallet.
   * 
   * @param walletAddress - The wallet address
   * @returns The key ID or undefined if not registered
   */
  getKeyId(walletAddress: string): string | undefined {
    return this.keyIdByWallet.get(walletAddress);
  }

  /**
   * Gets the public key for a key ID.
   * 
   * @param keyId - The key identifier
   * @returns The public key PEM or undefined if not found
   */
  getPublicKey(keyId: string): string | undefined {
    return this.publicKeyByKeyId.get(keyId);
  }

  /**
   * Checks if a wallet has a registered owner key.
   * 
   * @param walletAddress - The wallet address
   * @returns True if the wallet has a registered key
   */
  hasKey(walletAddress: string): boolean {
    return this.keyIdByWallet.has(walletAddress);
  }

  /**
   * Clears all stored keys.
   */
  clear(): void {
    this.keyIdByWallet.clear();
    this.publicKeyByKeyId.clear();
  }
}