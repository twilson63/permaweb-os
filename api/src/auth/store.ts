import { randomBytes } from "crypto";
import { utils } from "ethers";

interface ChallengeRecord {
  message: string;
  nonce: string;
  expiresAt: number;
}

export interface SessionRecord {
  token: string;
  expiresAt: string;
}

export interface SessionIdentity {
  token: string;
  address: string;
  expiresAt: string;
}

interface StoredSession {
  address: string;
  expiresAtMs: number;
  githubToken?: string;
}

export class AuthStore {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly challengeTtlMs: number;
  private readonly sessionTtlMs: number;

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

  getGitHubToken(token: string): string | null {
    const session = this.sessions.get(token);

    if (!session || session.expiresAtMs <= Date.now()) {
      return null;
    }

    return session.githubToken || null;
  }

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

  private normalizeAddress(address: string): string {
    const trimmedAddress = address.trim();

    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmedAddress)) {
      throw new Error("Invalid wallet address");
    }

    return trimmedAddress;
  }
}
