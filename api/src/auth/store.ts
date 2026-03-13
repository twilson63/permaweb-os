/**
 * @fileoverview In-memory wallet challenge/session store with optional GitHub token linkage.
 * Supports Ethereum and Arweave wallet authentication.
 * @author Web OS contributors
 * @exports AuthStore, SessionRecord, SessionIdentity, WalletType
 */

import { randomBytes } from "crypto";
import { utils } from "ethers";
import {
  WalletType,
  detectWalletType,
  isValidEthereumAddress,
  isValidArweaveAddress,
  verifyArweaveSignatureWithJwk,
  ArweaveJWK
} from "./arweave.js";

/**
 * One-time sign-in challenge tracked for a wallet address.
 */
interface ChallengeRecord {
  message: string;
  nonce: string;
  expiresAt: number;
  walletType: WalletType;
}

/**
 * Public session payload returned to clients after authentication.
 */
export interface SessionRecord {
  token: string;
  expiresAt: string;
}

/**
 * Session identity attached to authenticated requests.
 */
export interface SessionIdentity {
  token: string;
  address: string;
  expiresAt: string;
}

/**
 * Internal session representation stored by the in-memory auth store.
 */
interface StoredSession {
  address: string;
  expiresAtMs: number;
  githubToken?: string;
}

/**
 * Options for Arweave signature verification.
 */
interface ArweaveVerifyOptions {
  /** Pre-resolved JWK public key (avoids gateway lookup) */
  jwk?: ArweaveJWK;
}

/**
 * In-memory authentication store for wallet sign-in challenges and sessions.
 *
 * This class owns the complete challenge -> signature -> session lifecycle.
 * Supports both Ethereum and Arweave wallet authentication.
 */
export class AuthStore {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly challengeTtlMs: number;
  private readonly sessionTtlMs: number;

  /**
   * @param challengeTtlMs - How long signature challenges remain valid (ms).
   * @param sessionTtlMs - How long authenticated sessions remain valid (ms).
   */
  constructor({
    challengeTtlMs = 5 * 60 * 1000,
    sessionTtlMs = 24 * 60 * 60 * 1000,
  }: {
    challengeTtlMs?: number;
    sessionTtlMs?: number;
  } = {}) {
    this.challengeTtlMs = challengeTtlMs;
    this.sessionTtlMs = sessionTtlMs;
  }

  /**
   * Creates a new sign-in challenge for a wallet address.
   *
   * @param address - Wallet address expected to sign the challenge.
   * @returns Challenge payload containing message, nonce, and expiry.
   * @throws {Error} If the wallet address is not valid.
   */
  createChallenge(address: string): ChallengeRecord {
    const { normalizedAddress, walletType } = this.normalizeAddress(address);
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = new Date().toISOString();
    const expiresAt = Date.now() + this.challengeTtlMs;
    const message = [
      "Sign in to Web OS",
      "",
      `Address: ${normalizedAddress}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`
    ].join("\n");

    const challenge: ChallengeRecord = {
      message,
      nonce,
      expiresAt,
      walletType
    };

    this.challenges.set(this.getChallengeKey(normalizedAddress), challenge);
    return challenge;
  }

  /**
   * Validates a signed challenge and issues a session when valid.
   * Supports both Ethereum and Arweave wallet signatures.
   *
   * @param address - Claimed wallet address.
   * @param signature - Signature over the issued challenge message.
   * @param options - Optional verification options (e.g., pre-resolved JWK).
   * @returns Session record when valid; otherwise `null`.
   */
  async verifySignature(
    address: string,
    signature: string,
    options?: ArweaveVerifyOptions
  ): Promise<SessionRecord | null> {
    const { normalizedAddress, walletType } = this.normalizeAddress(address);
    const addressKey = this.getChallengeKey(normalizedAddress);
    const challenge = this.challenges.get(addressKey);

    if (!challenge) {
      return null;
    }

    if (challenge.expiresAt < Date.now()) {
      this.challenges.delete(addressKey);
      return null;
    }

    // Verify based on wallet type
    let isValid = false;

    if (walletType === "ethereum") {
      isValid = this.verifyEthereumSignature(challenge.message, signature, addressKey);
    } else if (walletType === "arweave") {
      isValid = await this.verifyArweaveSignature(
        challenge.message,
        signature,
        normalizedAddress,
        options
      );
    }

    if (!isValid) {
      return null;
    }

    this.challenges.delete(addressKey);
    return this.createSession(normalizedAddress);
  }

  /**
   * Synchronous version of verifySignature for Ethereum-only verification.
   * Maintains backward compatibility with existing code.
   *
   * @param address - Claimed wallet address.
   * @param signature - Signature over the issued challenge message.
   * @returns Session record when valid; otherwise `null`.
   */
  verifySignatureSync(address: string, signature: string): SessionRecord | null {
    const { normalizedAddress, walletType } = this.normalizeAddress(address);
    const addressKey = this.getChallengeKey(normalizedAddress);
    const challenge = this.challenges.get(addressKey);

    if (!challenge) {
      return null;
    }

    if (challenge.expiresAt < Date.now()) {
      this.challenges.delete(addressKey);
      return null;
    }

    // Only Ethereum supports sync verification
    if (walletType !== "ethereum") {
      return null;
    }

    const isValid = this.verifyEthereumSignature(challenge.message, signature, addressKey);

    if (!isValid) {
      return null;
    }

    this.challenges.delete(addressKey);
    return this.createSession(normalizedAddress);
  }

  /**
   * Validates and resolves an existing session token.
   *
   * @param token - Bearer session token.
   * @returns Session identity for authorized requests, otherwise `null`.
   */
  validateSession(token: string): SessionIdentity | null {
    const session = this.sessions.get(token);

    if (!session) {
      return null;
    }

    if (session.expiresAtMs <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }

    return {
      token,
      address: session.address,
      expiresAt: new Date(session.expiresAtMs).toISOString()
    };
  }

  /**
   * Associates a GitHub access token with an active wallet session.
   *
   * @param token - Existing session token.
   * @param githubToken - OAuth token returned by GitHub.
   * @returns `true` when stored; `false` if session is missing or expired.
   */
  setGitHubToken(token: string, githubToken: string): boolean {
    const session = this.sessions.get(token);

    if (!session) {
      return false;
    }

    if (session.expiresAtMs <= Date.now()) {
      this.sessions.delete(token);
      return false;
    }

    this.sessions.set(token, {
      ...session,
      githubToken: githubToken.trim()
    });

    return true;
  }

  /**
   * Reads the GitHub access token linked to a session.
   *
   * @param token - Existing session token.
   * @returns Stored GitHub token or `null`.
   */
  getGitHubToken(token: string): string | null {
    const session = this.sessions.get(token);

    if (!session || session.expiresAtMs <= Date.now()) {
      return null;
    }

    return session.githubToken || null;
  }

  /**
   * Creates and stores a new session for an authenticated address.
   *
   * @param address - Normalized wallet address.
   * @returns Public session payload.
   */
  private createSession(address: string): SessionRecord {
    const token = randomBytes(32).toString("base64url");
    const expiresAtMs = Date.now() + this.sessionTtlMs;

    this.sessions.set(token, {
      address,
      expiresAtMs
    });

    return {
      token,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }

  /**
   * Normalizes and validates a wallet address.
   * Supports both Ethereum and Arweave address formats.
   *
   * @param address - Candidate wallet address.
   * @returns Object with normalized address and detected wallet type.
   * @throws {Error} If the format is invalid.
   */
  private normalizeAddress(address: string): { normalizedAddress: string; walletType: WalletType } {
    const trimmedAddress = address.trim();
    const walletType = detectWalletType(trimmedAddress);

    if (!walletType) {
      throw new Error("Invalid wallet address. Must be Ethereum (0x...) or Arweave (43-char base64url)");
    }

    // Ethereum addresses are case-insensitive, normalize to lowercase
    const normalizedAddress = walletType === "ethereum"
      ? trimmedAddress.toLowerCase()
      : trimmedAddress;

    return { normalizedAddress, walletType };
  }

  /**
   * Gets the challenge key for storing/retrieving challenges.
   * Uses lowercase for Ethereum, original case for Arweave.
   *
   * @param address - Normalized wallet address.
   * @returns Key for challenge storage.
   */
  private getChallengeKey(address: string): string {
    // For Ethereum, use lowercase; for Arweave, preserve case
    if (isValidEthereumAddress(address)) {
      return address.toLowerCase();
    }
    return address;
  }

  /**
   * Verifies an Ethereum signature using ethers.
   *
   * @param message - Challenge message that was signed.
   * @param signature - Hex-encoded signature.
   * @param expectedAddress - Expected signer address (lowercase).
   * @returns `true` if signature is valid.
   */
  private verifyEthereumSignature(
    message: string,
    signature: string,
    expectedAddress: string
  ): boolean {
    try {
      const recoveredAddress = utils.verifyMessage(message, signature);
      return recoveredAddress.toLowerCase() === expectedAddress;
    } catch {
      return false;
    }
  }

  /**
   * Verifies an Arweave signature.
   *
   * If JWK is provided in options, uses it directly.
   * Otherwise, resolves the public key from Arweave gateway.
   *
   * @param message - Challenge message that was signed.
   * @param signature - Base64URL-encoded signature.
   * @param address - Arweave wallet address.
   * @param options - Verification options.
   * @returns `true` if signature is valid.
   */
  private async verifyArweaveSignature(
    message: string,
    signature: string,
    address: string,
    options?: ArweaveVerifyOptions
  ): Promise<boolean> {
    try {
      // If JWK provided directly, use it
      if (options?.jwk) {
        return verifyArweaveSignatureWithJwk(message, signature, options.jwk);
      }

      // Otherwise, resolve from gateway
      const { verifyArweaveSignature: verify } = await import("./arweave.js");
      return await verify(message, signature, address);
    } catch {
      return false;
    }
  }
}
