/**
 * @fileoverview Wallet-scoped Kubernetes secret naming for LLM API keys.
 * @module secret-naming
 * 
 * Provides deterministic secret name derivation for multi-tenant isolation.
 * Each wallet gets its own Kubernetes Secret containing only its LLM keys.
 */

import { createHash } from "crypto";

/**
 * Normalizes a wallet address to a consistent format.
 * Converts to lowercase and trims whitespace.
 * 
 * @param walletAddress - Raw wallet address (Ethereum 0x... or Arweave base64url)
 * @returns Normalized wallet address
 */
export function normalizeWalletAddress(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

/**
 * Derives a Kubernetes secret name for a wallet's LLM keys.
 * Uses a truncated SHA256 hash to ensure valid Kubernetes name format.
 * 
 * @param ownerWallet - Wallet address that owns the secret
 * @returns Kubernetes secret name in format `llm-keys-<16-char-hash>`
 * 
 * @example
 * ```typescript
 * const secretName = getWalletSecretName("0x1234567890abcdef");
 * // Returns: "llm-keys-a1b2c3d4e5f67890"
 * ```
 */
export function getWalletSecretName(ownerWallet: string): string {
  const normalizedAddress = normalizeWalletAddress(ownerWallet);
  const hash = createHash("sha256")
    .update(normalizedAddress)
    .digest("hex")
    .slice(0, 16);
  return `llm-keys-${hash}`;
}

/**
 * Validates that a secret name follows the expected wallet-scoped format.
 * 
 * @param name - Secret name to validate
 * @returns `true` if the name matches `llm-keys-<16-hex-chars>`
 * 
 * @example
 * ```typescript
 * isValidWalletSecretName("llm-keys-a1b2c3d4e5f67890"); // true
 * isValidWalletSecretName("llm-api-keys"); // false
 * isValidWalletSecretName("llm-keys-xyz"); // false
 * ```
 */
export function isValidWalletSecretName(name: string): boolean {
  return /^llm-keys-[a-f0-9]{16}$/.test(name);
}

/**
 * List of supported LLM providers that can have API keys stored.
 */
export const SUPPORTED_LLM_PROVIDERS = ["openai", "anthropic", "groq"] as const;
export type LlmProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

/**
 * Type guard to check if a string is a valid LLM provider.
 * 
 * @param provider - Provider name to check
 * @returns `true` if provider is supported
 */
export function isSupportedLlmProvider(provider: string): provider is LlmProvider {
  return SUPPORTED_LLM_PROVIDERS.includes(provider as LlmProvider);
}

/**
 * Default namespace for Web OS secrets.
 */
export const DEFAULT_NAMESPACE = "web-os";

/**
 * Default global secret name (deprecated, used for fallback).
 */
export const DEFAULT_GLOBAL_SECRET_NAME = "llm-api-keys";