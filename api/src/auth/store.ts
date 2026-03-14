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
  /** Transaction owner (public key modulus) for transaction signature verification */
  owner?: string;
  /** Transaction signature for transaction-based auth */
  txSignature?: string;
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

    console.log(`[Auth] Verifying signature for ${walletType} address: ${normalizedAddress}`);
    console.log(`[Auth] Challenge found:`, challenge ? 'yes' : 'no');

    if (!challenge) {
      console.log(`[Auth] No challenge found for address: ${addressKey}`);
      return null;
    }

    if (challenge.expiresAt < Date.now()) {
      console.log(`[Auth] Challenge expired for address: ${addressKey}`);
      this.challenges.delete(addressKey);
      return null;
    }

    // Verify based on wallet type
    let isValid = false;

    if (walletType === "ethereum") {
      isValid = this.verifyEthereumSignature(challenge.message, signature, addressKey);
      console.log(`[Auth] Ethereum signature valid:`, isValid);
    } else if (walletType === "arweave") {
      console.log(`[Auth] Verifying Arweave signature...`);
      console.log(`[Auth] Message:`, challenge.message.substring(0, 100));
      console.log(`[Auth] Signature length:`, signature.length);
      isValid = await this.verifyArweaveSignature(
        challenge.message,
        signature,
        normalizedAddress,
        options
      );
      console.log(`[Auth] Arweave signature valid:`, isValid);
    }

    if (!isValid) {
      console.log(`[Auth] Signature verification failed for ${walletType} address: ${normalizedAddress}`);
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
   * Verifies an Arweave transaction signature for wallet authentication.
   * 
   * This method implements Arweave wallet authentication using transaction signing,
   * which is the standard approach supported by Wander/ArConnect wallets.
   * 
   * ## Why Transaction Signing?
   * 
   * The traditional `signMessage()` API in Wander/ArConnect uses an undocumented signing
   * algorithm that doesn't match any standard RSA verification method (PSS, PKCS1, etc).
   * 
   * The solution is to use `arweave.createTransaction({ data: message })` + `wallet.sign(tx)`
   * which produces a standard ANS-104 transaction signature that can be verified using
   * `Arweave.crypto.verify(owner, deepHash, signature)`.
   * 
   * ## ANS-104 Transaction Signature Format
   * 
   * For format 2 (ANS-104), the signature is computed over:
   * ```
   * deepHash([
   *   "2",              // format version
   *   owner,            // public key modulus (decoded from base64url)
   *   target,           // empty for data transactions
   *   quantity,         // "0" for data transactions
   *   reward,           // network fee (from Arweave network)
   *   last_tx,          // network anchor (from Arweave network)
   *   tags,             // array of [name, value] pairs
   *   data_size,        // size of the message in bytes
   *   data_root         // merkle root of the data (SHA-256 for small data)
   * ])
   * ```
   * 
   * ## Critical: Exact Values Required
   * 
   * The server MUST use the exact same values that were present when the client
   * signed the transaction. This includes:
   * - `reward`: Network fee fetched from Arweave gateway
   * - `last_tx`: Network anchor fetched from Arweave gateway
   * - `data_root`: Merkle root computed by ArweaveJS
   * - `data_size`: Size of the message
   * 
   * If any of these values differ between client and server, verification will fail.
   * 
   * ## Client Flow
   * 
   * 1. Client calls `arweave.createTransaction({ data: message })` - fetches network values
   * 2. Client calls `wallet.sign(tx)` - Wander signs the transaction
   * 3. Client extracts `signature`, `owner`, `reward`, `last_tx`, `data_size`, `data_root`, `tags`
   * 4. Client sends all values to server for verification
   * 
   * @param message - The auth message that was signed (e.g., "Sign in to Web OS\n\nAddress: ...")
   * @param signature - Base64URL-encoded transaction signature
   * @param owner - Base64URL-encoded public key modulus (owner field from transaction)
   * @param address - Arweave wallet address (SHA-256 hash of owner modulus)
   * @param txData - Additional transaction data from the signed transaction
   * @returns `true` if signature is valid and address matches owner
   * 
   * @example
   * ```typescript
   * const isValid = await authStore.verifyArweaveTransactionSignature(
   *   "Sign in to Web OS\n\nAddress: Z1COjLRwKht...\nNonce: abc123",
   *   "signature-base64url-string",
   *   "public-key-modulus-base64url",
   *   "Z1COjLRwKht...",
   *   {
   *     reward: "1000746638",
   *     lastTx: "network-anchor-hash",
   *     dataSize: "147",
   *     dataRoot: "merkle-root-base64url",
   *     tags: []
   *   }
   * );
   * ```
   */
  async verifyArweaveTransactionSignature(
    message: string,
    signature: string,
    owner: string,
    address: string,
    txData?: {
      reward?: string;
      lastTx?: string;
      dataSize?: string;
      dataRoot?: string;
      tags?: Array<{ name: string; value: string }>;
    }
  ): Promise<boolean> {
    try {
      // Import Arweave and deepHash dynamically
      const Arweave = (await import("arweave")).default;
      const deepHash = (await import("arweave/node/lib/deepHash")).default;
      
      console.log('[ArweaveTx] Verifying transaction signature');
      console.log('[ArweaveTx] Message length:', message.length);
      console.log('[ArweaveTx] Owner length:', owner.length);
      console.log('[ArweaveTx] Signature length:', signature.length);
      console.log('[ArweaveTx] Address:', address);
      console.log('[ArweaveTx] TX Data:', txData);
      
      // Verify owner matches address
      // Arweave address = SHA-256(owner modulus)
      const ownerBuffer = Arweave.utils.b64UrlToBuffer(owner);
      const ownerHash = await Arweave.crypto.hash(ownerBuffer, "SHA-256");
      const derivedAddress = Arweave.utils.bufferTob64Url(ownerHash);
      
      console.log('[ArweaveTx] Derived address:', derivedAddress);
      
      if (derivedAddress !== address) {
        console.log('[ArweaveTx] Address mismatch');
        return false;
      }
      
      // Use the exact values from the client's transaction
      // These are required for the signature to verify correctly
      const reward = txData?.reward || "0";
      const lastTx = txData?.lastTx || "";
      const dataSize = txData?.dataSize || message.length.toString();
      const dataRoot = txData?.dataRoot;
      const tags = txData?.tags || [];
      
      // If no data_root provided, compute it from the message
      let dataRootBuffer: Uint8Array;
      if (dataRoot) {
        dataRootBuffer = Arweave.utils.b64UrlToBuffer(dataRoot);
      } else {
        // Compute merkle root for the data
        // For small data (< 2.5MB), this is just SHA-256
        const dataBuffer = Arweave.utils.stringToBuffer(message);
        dataRootBuffer = await Arweave.crypto.hash(dataBuffer, "SHA-256");
      }
      
      // Convert tags to the format expected by deepHash
      // Tags is an array of [name, value] pairs, where name and value are base64url encoded
      const tagList = tags.map(tag => [
        Arweave.utils.b64UrlToBuffer(tag.name),
        Arweave.utils.b64UrlToBuffer(tag.value)
      ]);
      
      // Build deep hash input for format 2 (ANS-104)
      // The signature is over deepHash([
      //   format (as string),
      //   owner (decoded),
      //   target (decoded),
      //   quantity (as string),
      //   reward (as string),
      //   last_tx (decoded),
      //   tags (as list of [name, value] pairs),
      //   data_size (as string),
      //   data_root (decoded)
      // ])
      const deepHashInput = [
        Arweave.utils.stringToBuffer("2"), // format
        Arweave.utils.b64UrlToBuffer(owner), // owner
        new Uint8Array(0), // target (empty for data tx)
        Arweave.utils.stringToBuffer("0"), // quantity
        Arweave.utils.stringToBuffer(reward), // reward (from client)
        lastTx ? Arweave.utils.b64UrlToBuffer(lastTx) : new Uint8Array(0), // last_tx (from client)
        tagList, // tags (from client)
        Arweave.utils.stringToBuffer(dataSize), // data_size (from client)
        dataRootBuffer, // data_root (from client or computed)
      ];
      
      // Compute deep hash
      const hash = await deepHash(deepHashInput);
      const signatureBuffer = Arweave.utils.b64UrlToBuffer(signature);
      
      console.log('[ArweaveTx] Deep hash computed');
      console.log('[ArweaveTx] Signature buffer length:', signatureBuffer.length);
      
      // Verify signature
      const isValid = await Arweave.crypto.verify(owner, hash, signatureBuffer);
      
      console.log('[ArweaveTx] Verification result:', isValid);
      return isValid;
    } catch (error) {
      console.error('[ArweaveTx] Verification error:', error);
      return false;
    }
  }

  /**
   * Gets the challenge for a given address (for transaction verification).
   *
   * @param address - Wallet address.
   * @returns Challenge record or undefined.
   */
  getChallenge(address: string): ChallengeRecord | undefined {
    const key = this.getChallengeKey(address);
    return this.challenges.get(key);
  }

  /**
   * Deletes a challenge after successful verification.
   *
   * @param address - Wallet address.
   */
  deleteChallenge(address: string): void {
    const key = this.getChallengeKey(address);
    this.challenges.delete(key);
  }

  /**
   * Creates and stores a new session for an authenticated address.
   * Synchronous version for transaction verification.
   *
   * @param address - Normalized wallet address.
   * @returns Public session payload.
   */
  createSessionSync(address: string): SessionRecord {
    return this.createSession(address);
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
      // Parse JWK if it's a string
      let jwk = options?.jwk;
      if (typeof jwk === 'string') {
        console.log('[Auth] JWK is string, parsing...');
        try {
          jwk = JSON.parse(jwk);
          console.log('[Auth] JWK parsed successfully');
        } catch (parseError) {
          console.error('[Auth] Failed to parse JWK:', parseError);
          return false;
        }
      }
      
      // If JWK provided, use Arweave SDK for verification
      if (jwk) {
        const jwkObj = jwk as unknown as Record<string, unknown>;
        console.log('[Auth] JWK kty:', jwkObj.kty);
        console.log('[Auth] JWK n length:', jwkObj.n ? String(jwkObj.n).length : 'missing');
        console.log('[Auth] JWK e:', jwkObj.e);
        
        // Use Arweave SDK for verification (recommended)
        const { verifyArweaveSignatureWithSdk } = await import("./arweave.js");
        const isValid = await verifyArweaveSignatureWithSdk(message, signature, jwk as ArweaveJWK);
        console.log('[Auth] Arweave SDK verification result:', isValid);
        return isValid;
      }

      // Otherwise, resolve from gateway
      console.log('[Auth] Resolving public key from Arweave gateway for:', address);
      const { resolveArweavePublicKey } = await import("./arweave.js");
      const resolvedJwk = await resolveArweavePublicKey(address);
      
      if (!resolvedJwk) {
        console.log('[Auth] Failed to resolve public key from gateway');
        return false;
      }
      
      console.log('[Auth] Got JWK from gateway, verifying...');
      const { verifyArweaveSignatureWithSdk } = await import("./arweave.js");
      const result = await verifyArweaveSignatureWithSdk(message, signature, resolvedJwk);
      console.log('[Auth] Verification result:', result);
      return result;
    } catch (error) {
      console.error('[Auth] Arweave verification error:', error);
      return false;
    }
  }
}
