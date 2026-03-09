/**
 * @fileoverview In-memory wallet challenge/session store with optional GitHub token linkage.
 * @author Web OS contributors
 * @exports AuthStore, SessionRecord, SessionIdentity
 */

import { randomBytes } from "crypto";
import { utils } from "ethers";

/**
 * One-time sign-in challenge tracked for a wallet address.
 */
interface ChallengeRecord {
  message: string;
  nonce: string;
  expiresAt: number;
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
 * In-memory authentication store for wallet sign-in challenges and sessions.
 *
 * This class owns the complete challenge -> signature -> session lifecycle.
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
    const normalizedAddress = this.normalizeAddress(address);
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
      expiresAt
    };

    this.challenges.set(normalizedAddress.toLowerCase(), challenge);
    return challenge;
  }

  /**
   * Validates a signed challenge and issues a session when valid.
   *
   * @param address - Claimed wallet address.
   * @param signature - Signature over the issued challenge message.
   * @returns Session record when valid; otherwise `null`.
   */
  verifySignature(address: string, signature: string): SessionRecord | null {
    const normalizedAddress = this.normalizeAddress(address);
    const addressKey = normalizedAddress.toLowerCase();
    const challenge = this.challenges.get(addressKey);

    if (!challenge) {
      return null;
    }

    if (challenge.expiresAt < Date.now()) {
      this.challenges.delete(addressKey);
      return null;
    }

    const recoveredAddress = utils.verifyMessage(challenge.message, signature);

    if (recoveredAddress.toLowerCase() !== addressKey) {
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
   * Validates that an address is a 20-byte hex Ethereum address.
   *
   * @param address - Candidate wallet address.
   * @returns Trimmed address when valid.
   * @throws {Error} If the format is invalid.
   */
  private normalizeAddress(address: string): string {
    const trimmedAddress = address.trim();

    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmedAddress)) {
      throw new Error("Invalid wallet address");
    }

    return trimmedAddress;
  }
}
