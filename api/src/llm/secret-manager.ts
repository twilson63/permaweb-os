/**
 * @fileoverview Kubernetes secret management for wallet-scoped LLM keys.
 * @module secret-manager
 * 
 * Provides functions to create, update, and manage per-wallet Kubernetes secrets
 * that store LLM API keys in isolation from other wallets.
 */

import { KubeConfig, KubernetesObjectApi, CoreV1Api } from "@kubernetes/client-node";
import {
  getWalletSecretName,
  isValidWalletSecretName,
  normalizeWalletAddress,
  LlmProvider,
  isSupportedLlmProvider,
  DEFAULT_NAMESPACE,
  DEFAULT_GLOBAL_SECRET_NAME,
} from "../pods/secret-naming";

/**
 * Secret data structure returned by Kubernetes.
 * Keys are provider names, values are base64-encoded API keys.
 */
export interface SecretData {
  [provider: string]: string; // base64-encoded
}

/**
 * Result of a secret creation or update operation.
 */
export interface SecretOperationResult {
  success: boolean;
  secretName: string;
  namespace: string;
  created: boolean; // true if secret was newly created, false if updated
  error?: string;
}

/**
 * Options for the SecretManager constructor.
 */
export interface SecretManagerOptions {
  namespace?: string;
  kubeConfig?: KubeConfig;
  fallbackToGlobal?: boolean;
}

/**
 * Manages Kubernetes secrets for wallet-scoped LLM API keys.
 * 
 * Each wallet gets its own secret named `llm-keys-<hash(wallet)>`.
 * Secrets contain provider-specific API keys as base64-encoded values.
 * 
 * @example
 * ```typescript
 * const manager = new SecretManager();
 * 
 * // Register a new API key for a wallet
 * await manager.registerKey(
 *   "0x1234...",
 *   "openai",
 *   "sk-proj-abc123..."
 * );
 * 
 * // Get the secret name for a pod
 * const secretName = manager.getSecretNameForWallet("0x1234...");
 * ```
 */
export class SecretManager {
  private readonly namespace: string;
  private readonly kubeConfig: KubeConfig;
  private readonly k8sApi: KubernetesObjectApi;
  private readonly coreV1Api: CoreV1Api;
  private readonly fallbackToGlobal: boolean;

  /**
   * Cache of known wallet secrets (wallet hash -> secret name).
   * Used to avoid unnecessary API calls.
   */
  private readonly secretCache = new Map<string, string>();

  constructor(options: SecretManagerOptions = {}) {
    this.namespace = options.namespace || DEFAULT_NAMESPACE;
    this.kubeConfig = options.kubeConfig || new KubeConfig();
    
    // Only load from default if no config was provided
    if (!options.kubeConfig) {
      try {
        this.kubeConfig.loadFromDefault();
      } catch {
        // In test environments, kubeconfig may not be available
      }
    }
    
    this.k8sApi = KubernetesObjectApi.makeApiClient(this.kubeConfig);
    this.coreV1Api = this.kubeConfig.makeApiClient(CoreV1Api);
    this.fallbackToGlobal = options.fallbackToGlobal ?? false;
  }

  /**
   * Registers or updates an API key for a specific provider and wallet.
   * Creates the wallet-scoped secret if it doesn't exist.
   * 
   * @param ownerWallet - Wallet address that owns this key
   * @param provider - LLM provider (openai, anthropic, groq)
   * @param apiKey - The API key value (will be base64-encoded)
   * @returns Result of the operation
   */
  async registerKey(
    ownerWallet: string,
    provider: LlmProvider,
    apiKey: string
  ): Promise<SecretOperationResult> {
    if (!isSupportedLlmProvider(provider)) {
      return {
        success: false,
        secretName: "",
        namespace: this.namespace,
        created: false,
        error: `Unsupported provider: ${provider}`,
      };
    }

    const secretName = getWalletSecretName(ownerWallet);
    const normalizedWallet = normalizeWalletAddress(ownerWallet);

    try {
      // Try to get existing secret
      const existing = await this.getSecret(secretName);

      if (existing) {
        // Update existing secret
        const updatedData: SecretData = { ...existing };
        updatedData[provider] = Buffer.from(apiKey).toString("base64");

        await this.k8sApi.patch({
          apiVersion: "v1",
          kind: "Secret",
          metadata: { name: secretName, namespace: this.namespace },
          type: "Opaque",
          data: updatedData,
        });

        this.secretCache.set(normalizedWallet, secretName);

        return {
          success: true,
          secretName,
          namespace: this.namespace,
          created: false,
        };
      } else {
        // Create new secret
        await this.k8sApi.create({
          apiVersion: "v1",
          kind: "Secret",
          metadata: {
            name: secretName,
            namespace: this.namespace,
            labels: {
              "app.kubernetes.io/name": "web-os-llm-keys",
              "app.kubernetes.io/part-of": "web-os",
              "web-os.io/wallet-hash": secretName.replace("llm-keys-", ""),
            },
            annotations: {
              "web-os.io/owner-wallet": normalizedWallet,
            },
          },
          type: "Opaque",
          data: {
            [provider]: Buffer.from(apiKey).toString("base64"),
          },
        });

        this.secretCache.set(normalizedWallet, secretName);

        return {
          success: true,
          secretName,
          namespace: this.namespace,
          created: true,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        secretName,
        namespace: this.namespace,
        created: false,
        error: `Failed to create/update secret: ${message}`,
      };
    }
  }

  /**
   * Gets the secret name for a wallet, creating an empty secret if needed.
   * 
   * @param ownerWallet - Wallet address
   * @param createIfMissing - Whether to create an empty secret if it doesn't exist
   * @returns The secret name, or null if no secret exists and createIfMissing is false
   */
  async getSecretNameForWallet(
    ownerWallet: string,
    createIfMissing: boolean = false
  ): Promise<string | null> {
    const secretName = getWalletSecretName(ownerWallet);
    const normalizedWallet = normalizeWalletAddress(ownerWallet);

    // Check cache first
    const cached = this.secretCache.get(normalizedWallet);
    if (cached) {
      return cached;
    }

    // Check if secret exists
    const existing = await this.getSecret(secretName);

    if (existing) {
      this.secretCache.set(normalizedWallet, secretName);
      return secretName;
    }

    // Check global fallback if enabled
    if (this.fallbackToGlobal) {
      const globalExists = await this.secretExists(DEFAULT_GLOBAL_SECRET_NAME);
      if (globalExists) {
        return DEFAULT_GLOBAL_SECRET_NAME;
      }
    }

    // Create empty secret if requested
    if (createIfMissing) {
      await this.createEmptySecret(ownerWallet);
      this.secretCache.set(normalizedWallet, secretName);
      return secretName;
    }

    return null;
  }

  /**
   * Gets the Kubernetes secret data for a secret name.
   * 
   * @param secretName - Name of the secret
   * @returns Secret data (base64-encoded values) or null if not found
   */
  async getSecret(secretName: string): Promise<SecretData | null> {
    try {
      // Use KubernetesObjectApi for reading
      const response = await this.k8sApi.read({
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: secretName, namespace: this.namespace },
      });
      
      // Extract data from the response
      const secret = response as unknown as { data?: SecretData };
      return secret?.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Checks if a secret exists.
   * 
   * @param secretName - Name of the secret
   * @returns True if secret exists
   */
  async secretExists(secretName: string): Promise<boolean> {
    try {
      await this.k8sApi.read({
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: secretName, namespace: this.namespace },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates an empty secret for a wallet (no keys yet).
   * 
   * @param ownerWallet - Wallet address
   */
  async createEmptySecret(ownerWallet: string): Promise<void> {
    const secretName = getWalletSecretName(ownerWallet);
    const normalizedWallet = normalizeWalletAddress(ownerWallet);

    await this.k8sApi.create({
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: secretName,
        namespace: this.namespace,
        labels: {
          "app.kubernetes.io/name": "web-os-llm-keys",
          "app.kubernetes.io/part-of": "web-os",
          "web-os.io/wallet-hash": secretName.replace("llm-keys-", ""),
        },
        annotations: {
          "web-os.io/owner-wallet": normalizedWallet,
        },
      },
      type: "Opaque",
      data: {},
    });
  }

  /**
   * Lists all provider keys configured for a wallet.
   * 
   * @param ownerWallet - Wallet address
   * @returns Array of provider names that have keys configured
   */
  async listConfiguredProviders(ownerWallet: string): Promise<string[]> {
    const secretName = getWalletSecretName(ownerWallet);
    const secret = await this.getSecret(secretName);

    if (!secret) {
      // Check global fallback
      if (this.fallbackToGlobal) {
        const globalSecret = await this.getSecret(DEFAULT_GLOBAL_SECRET_NAME);
        if (globalSecret) {
          return Object.keys(globalSecret).filter(isSupportedLlmProvider);
        }
      }
      return [];
    }

    return Object.keys(secret).filter(isSupportedLlmProvider);
  }

  /**
   * Removes a provider key from a wallet's secret.
   * 
   * @param ownerWallet - Wallet address
   * @param provider - Provider to remove
   * @returns True if key was removed
   */
  async removeKey(ownerWallet: string, provider: LlmProvider): Promise<boolean> {
    const secretName = getWalletSecretName(ownerWallet);
    const existing = await this.getSecret(secretName);

    if (!existing || !existing[provider]) {
      return false;
    }

    const updatedData = { ...existing };
    delete updatedData[provider];

    // If no keys left, delete the whole secret
    if (Object.keys(updatedData).length === 0) {
      await this.k8sApi.delete({
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: secretName, namespace: this.namespace },
      });
      const normalizedWallet = normalizeWalletAddress(ownerWallet);
      this.secretCache.delete(normalizedWallet);
    } else {
      await this.k8sApi.patch({
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: secretName, namespace: this.namespace },
        type: "Opaque",
        data: updatedData,
      });
    }

    return true;
  }

  /**
   * Deletes the entire secret for a wallet.
   * 
   * @param ownerWallet - Wallet address
   * @returns True if secret was deleted
   */
  async deleteSecret(ownerWallet: string): Promise<boolean> {
    const secretName = getWalletSecretName(ownerWallet);

    try {
      await this.k8sApi.delete({
        apiVersion: "v1",
        kind: "Secret",
        metadata: { name: secretName, namespace: this.namespace },
      });
      const normalizedWallet = normalizeWalletAddress(ownerWallet);
      this.secretCache.delete(normalizedWallet);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clears the internal cache.
   */
  clearCache(): void {
    this.secretCache.clear();
  }
}

/**
 * Default export - singleton instance for convenience.
 * Only use when Kubernetes is available.
 */
let defaultManager: SecretManager | null = null;

/**
 * Gets the default secret manager instance.
 * Creates one if needed.
 */
export function getSecretManager(options?: SecretManagerOptions): SecretManager {
  if (!defaultManager) {
    defaultManager = new SecretManager(options);
  }
  return defaultManager;
}

/**
 * Checks if a secret name is a wallet-scoped secret or the global fallback.
 * 
 * @param secretName - Secret name to check
 * @returns True if it's a wallet-scoped or global LLM secret
 */
export function isLlmSecret(secretName: string): boolean {
  return (
    isValidWalletSecretName(secretName) || secretName === DEFAULT_GLOBAL_SECRET_NAME
  );
}