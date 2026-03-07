import { createHmac, randomBytes } from "crypto";
import { utils } from "ethers";

interface ChallengeRecord {
  message: string;
  nonce: string;
  expiresAt: number;
}

interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

export interface SessionRecord {
  token: string;
  address: string;
  expiresAt: string;
}

export class AuthStore {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly challengeTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly sessionSecret: string;

  constructor({
    challengeTtlMs = 5 * 60 * 1000,
    sessionTtlMs = 24 * 60 * 60 * 1000,
    sessionSecret = process.env.AUTH_SESSION_SECRET || "dev-session-secret"
  }: {
    challengeTtlMs?: number;
    sessionTtlMs?: number;
    sessionSecret?: string;
  } = {}) {
    this.challengeTtlMs = challengeTtlMs;
    this.sessionTtlMs = sessionTtlMs;
    this.sessionSecret = sessionSecret;
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
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAtSeconds + Math.floor(this.sessionTtlMs / 1000);
    const payload: SessionPayload = {
      sub: normalizedAddress,
      iat: issuedAtSeconds,
      exp: expiresAtSeconds
    };

    const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signaturePart = createHmac("sha256", this.sessionSecret).update(payloadPart).digest("base64url");

    return {
      token: `${payloadPart}.${signaturePart}`,
      address: normalizedAddress,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
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
