import { createHash, randomUUID } from "crypto";
import { CreatePodInput, Pod, PodLlmConfig } from "./types";
import { getPodSkillSummaries } from "./skills";
import { getWalletSecretName, normalizeWalletAddress } from "./secret-naming";
import { generateOwnerKeyPair, computeKeyId, getOwnerKeySecretName, OwnerKeyStore } from "./owner-keys";
import { getPodOrchestrator, PodOrchestrator } from "./orchestrator";
import { isKubernetesAvailable } from "../kubernetes/client";

const DEFAULT_GLOBAL_LLM_SECRET_NAME = "llm-api-keys";

type PodStoreOptions = {
  baseDomain?: string;
  globalLlmSecretName?: string;
  /** 
   * Function to check if a Kubernetes secret exists.
   * In production, this calls the Kubernetes API.
   * In tests, this can be mocked.
   */
  secretExists?: (secretName: string) => boolean | Promise<boolean>;
  /** Whether to fall back to global secret if wallet secret doesn't exist */
  fallbackToGlobal?: boolean;
  /** Pod orchestrator instance for Kubernetes operations */
  orchestrator?: PodOrchestrator;
  /** Whether to actually create Kubernetes resources (default: true when K8s available) */
  createKubernetesResources?: boolean;
};

/**
 * In-memory pod store responsible for pod CRUD operations.
 * 
 * Implements wallet-scoped secret isolation:
 * - Each wallet gets its own Kubernetes secret `llm-keys-<hash(wallet)>`
 * - Pods mount only their owner's secret
 * - Falls back to global secret if wallet has no registered keys
 * 
 * Owner key isolation:
 * - Each wallet gets a unique RSA key pair for HTTPSig verification
 * - Public key stored in Kubernetes secret `owner-key-<keyId>`
 * - Secret mounted ONLY in sidecar container (opencode has NO access)
 * 
 * Kubernetes integration:
 * - When Kubernetes is available, creates actual pods via orchestrator
 * - Falls back to in-memory only mode when Kubernetes is unavailable
 */
export class PodStore {
  private readonly pods = new Map<string, Pod>();
  private readonly walletSecretByOwner = new Map<string, string>();
  private readonly ownerKeyStore: OwnerKeyStore;
  private readonly baseDomain: string;
  private readonly globalLlmSecretName: string;
  private readonly secretExists: (secretName: string) => boolean | Promise<boolean>;
  private readonly fallbackToGlobal: boolean;
  private readonly orchestrator?: PodOrchestrator;
  private readonly createKubernetesResources: boolean;

  /**
   * @param options - Configuration options
   * @param options.baseDomain - Base domain for pod subdomains
   * @param options.globalLlmSecretName - Name of the global fallback secret
   * @param options.secretExists - Function to check if a secret exists
   * @param options.fallbackToGlobal - Whether to fall back to global secret
   * @param options.ownerKeyStore - Optional owner key store instance
   * @param options.orchestrator - Optional pod orchestrator instance
   * @param options.createKubernetesResources - Whether to create K8s resources (default: true when K8s available)
   */
  constructor(options: PodStoreOptions = {}) {
    this.baseDomain = options.baseDomain || process.env.POD_BASE_DOMAIN || "pods.local";
    this.globalLlmSecretName =
      options.globalLlmSecretName || process.env.LLM_GLOBAL_SECRET_NAME || DEFAULT_GLOBAL_LLM_SECRET_NAME;
    this.secretExists = options.secretExists || (() => false);
    this.fallbackToGlobal = options.fallbackToGlobal ?? true;
    this.ownerKeyStore = new OwnerKeyStore();
    this.orchestrator = options.orchestrator;
    this.createKubernetesResources = options.createKubernetesResources ?? true;
  }

  /**
   * Gets the wallet-scoped secret name for a wallet address.
   * Uses SHA256 hash truncated to 16 chars for Kubernetes compatibility.
   * 
   * @param ownerWallet - Wallet address
   * @returns Kubernetes secret name `llm-keys-<hash>`
   */
  walletSecretName(ownerWallet: string): string {
    return getWalletSecretName(ownerWallet);
  }

  /**
   * Gets or creates an owner key for a wallet.
   * 
   * Security:
   * - Returns the keyId and publicKeyPem for Kubernetes secret creation
   * - The privateKeyPem should be returned to the wallet owner (NOT stored)
   * - The publicKey is mounted ONLY in the sidecar container
   * 
   * @param ownerWallet - Wallet address
   * @returns Key pair information including private key (for wallet owner)
   */
  getOrCreateOwnerKey(ownerWallet: string): {
    keyId: string;
    publicKeyPem: string;
    privateKeyPem: string;
    secretName: string;
  } {
    const normalized = normalizeWalletAddress(ownerWallet);
    
    // Check if wallet already has a key
    const existingKeyId = this.ownerKeyStore.getKeyId(normalized);
    if (existingKeyId) {
      const publicKeyPem = this.ownerKeyStore.getPublicKey(existingKeyId);
      if (publicKeyPem) {
        return {
          keyId: existingKeyId,
          publicKeyPem,
          privateKeyPem: "", // Private key not stored, only returned on creation
          secretName: getOwnerKeySecretName(existingKeyId),
        };
      }
    }
    
    // Generate new key pair
    const { keyId, publicKeyPem, privateKeyPem } = generateOwnerKeyPair();
    
    // Register the key
    this.ownerKeyStore.register(normalized, keyId, publicKeyPem);
    
    return {
      keyId,
      publicKeyPem,
      privateKeyPem,
      secretName: getOwnerKeySecretName(keyId),
    };
  }

  /**
   * Registers an existing owner key for a wallet.
   * Used when key is created externally (e.g., by wallet owner).
   * 
   * @param ownerWallet - Wallet address
   * @param publicKeyPem - Public key PEM
   * @returns Key ID and secret name
   */
  registerOwnerKey(ownerWallet: string, publicKeyPem: string): {
    keyId: string;
    secretName: string;
  } {
    const normalized = normalizeWalletAddress(ownerWallet);
    const keyId = computeKeyId(publicKeyPem);
    
    this.ownerKeyStore.register(normalized, keyId, publicKeyPem);
    
    return {
      keyId,
      secretName: getOwnerKeySecretName(keyId),
    };
  }

  /**
   * Binds a specific secret to a wallet, overriding the default derived name.
   * Used when a wallet owner explicitly registers a secret.
   * 
   * @param ownerWallet - Wallet address
   * @param secretName - Kubernetes secret name (optional, uses default if not provided)
   * @returns The bound secret name
   */
  bindWalletSecret(ownerWallet: string, secretName?: string): string {
    const normalized = normalizeWalletAddress(ownerWallet);
    const boundSecretName = secretName?.trim() || this.walletSecretName(normalized);
    this.walletSecretByOwner.set(normalized, boundSecretName);
    return boundSecretName;
  }

  /**
   * Resolves the LLM secret name for a wallet, with fallback to global secret.
   * 
   * Priority:
   * 1. Explicitly bound secret (via bindWalletSecret)
   * 2. Wallet-scoped secret (if exists — synchronous check only)
   * 3. Global secret (if fallback enabled)
   * 
   * IMPORTANT: This method only works correctly when `secretExists` returns
   * a synchronous boolean. If `secretExists` is async, use
   * `resolveLlmSecretNameAsync` (via `createAsync`) instead.
   * 
   * @param ownerWallet - Wallet address
   * @returns Kubernetes secret name
   * @throws Error if no secret is available
   */
  private resolveLlmSecretName(ownerWallet: string): string {
    const normalized = normalizeWalletAddress(ownerWallet);
    
    // Check for explicitly bound secret
    const mappedSecret = this.walletSecretByOwner.get(normalized);
    if (mappedSecret) {
      return mappedSecret;
    }
    
    // Check wallet-scoped secret (synchronous only)
    const walletSecret = this.walletSecretName(normalized);
    const walletExists = this.secretExists(walletSecret);

    // Guard against async secretExists being used with the sync path.
    // A Promise is truthy but does NOT mean the secret exists — it means
    // the check hasn't resolved yet. Treat it as "unknown" and fall through
    // to the global fallback rather than mounting a non-existent secret.
    if (walletExists === true) {
      return walletSecret;
    }

    if (
      walletExists !== false &&
      typeof (walletExists as Promise<boolean>)?.then === "function"
    ) {
      console.warn(
        `resolveLlmSecretName called with async secretExists for wallet ${normalized}. ` +
        `Use createAsync() instead. Falling back to global secret.`
      );
    }

    // Fall back to global secret if enabled
    // Note: We assume the global secret exists if fallbackToGlobal is true
    // since the admin should have created it during deployment
    if (this.fallbackToGlobal) {
      return this.globalLlmSecretName;
    }

    throw new Error(
      `No LLM secret available for wallet ${normalized}. ` +
      `Register an API key first using POST /api/llm/keys`
    );
  }

  /**
   * Async version of resolveLlmSecretName for use with async secretExists.
   * 
   * @param ownerWallet - Wallet address
   * @returns Kubernetes secret name
   * @throws Error if no secret is available
   */
  async resolveLlmSecretNameAsync(ownerWallet: string): Promise<string> {
    const normalized = normalizeWalletAddress(ownerWallet);
    
    // Check for explicitly bound secret
    const mappedSecret = this.walletSecretByOwner.get(normalized);
    if (mappedSecret) {
      return mappedSecret;
    }
    
    // Check wallet-scoped secret (async)
    const walletSecret = this.walletSecretName(normalized);
    try {
      const walletExists = await Promise.resolve(this.secretExists(walletSecret));
      if (walletExists) {
        return walletSecret;
      }
    } catch {
      // Secret check failed, continue to fallback
    }

    // Fall back to global secret if enabled
    // Note: We assume the global secret exists if fallbackToGlobal is true
    // since the admin should have created it during deployment
    if (this.fallbackToGlobal) {
      return this.globalLlmSecretName;
    }

    throw new Error(
      `No LLM secret available for wallet ${normalized}. ` +
      `Register an API key first using POST /api/llm/keys`
    );
  }

  /**
   * Creates and stores a new pod record for the given wallet owner.
   * 
   * When Kubernetes is available and createKubernetesResources is true,
   * also creates the actual Kubernetes pod, service, and ingress.
   *
   * @param ownerWallet - Wallet address that owns the pod.
   * @param input - Optional creation input (name/model hints).
   * @param llm - Resolved LLM config used by the pod runtime.
   * @returns Newly created pod.
   */
  create(ownerWallet: string, input: CreatePodInput = {}, llm: PodLlmConfig): Pod {
    const id = randomUUID();
    const llmSecretName = this.resolveLlmSecretName(ownerWallet);
    const workspaceSkills = input.skills || [];
    const skillSummaries = getPodSkillSummaries(workspaceSkills);
    
    // Get or create owner key for HTTPSig verification
    const { keyId, publicKeyPem, secretName: ownerKeySecretName } = this.getOrCreateOwnerKey(ownerWallet);
    
    const pod: Pod = {
      id,
      name: input.name?.trim() || `pod-${id.slice(0, 8)}`,
      status: "running",
      subdomain: `${id}.${this.baseDomain}`,
      ownerWallet,
      createdAt: new Date().toISOString(),
      llm,
      llmSecretName,
      ownerKeyId: keyId,
      ownerKeySecretName,
      ...(skillSummaries.length > 0 && { skills: skillSummaries }),
    };

    this.pods.set(id, pod);

    // Create Kubernetes resources if orchestrator is available
    if (this.createKubernetesResources && (this.orchestrator || isKubernetesAvailable())) {
      const orchestrator = this.orchestrator || getPodOrchestrator();
      
      // Async creation - don't block on it
      orchestrator.createAll({
        podId: id,
        ownerWallet,
        llm,
        llmSecretName,
        ownerKeyId: keyId,
        ownerKeySecretName,
        ownerPublicKey: publicKeyPem,
        model: llm.model,
        skills: workspaceSkills
      }).then(result => {
        if (result.status === 'failed') {
          console.error('Failed to create Kubernetes pod:', result.message);
        }
      }).catch(error => {
        console.error('Error creating Kubernetes pod:', error);
      });
    }

    return pod;
  }

  /**
   * Creates a pod with async secret resolution.
   * Use this when secret existence must be checked against Kubernetes.
   * 
   * When Kubernetes is available and createKubernetesResources is true,
   * also creates the actual Kubernetes pod, service, and ingress.
   *
   * @param ownerWallet - Wallet address that owns the pod.
   * @param input - Optional creation input.
   * @param llm - Resolved LLM config.
   * @returns Newly created pod.
   */
  async createAsync(ownerWallet: string, input: CreatePodInput = {}, llm: PodLlmConfig): Promise<Pod> {
    const id = randomUUID();
    const llmSecretName = await this.resolveLlmSecretNameAsync(ownerWallet);
    const workspaceSkills = input.skills || [];
    const skillSummaries = getPodSkillSummaries(workspaceSkills);
    
    // Get or create owner key for HTTPSig verification
    const { keyId, publicKeyPem, secretName: ownerKeySecretName } = this.getOrCreateOwnerKey(ownerWallet);
    
    const pod: Pod = {
      id,
      name: input.name?.trim() || `pod-${id.slice(0, 8)}`,
      status: "running",
      subdomain: `${id}.${this.baseDomain}`,
      ownerWallet,
      createdAt: new Date().toISOString(),
      llm,
      llmSecretName,
      ownerKeyId: keyId,
      ownerKeySecretName,
      ...(skillSummaries.length > 0 && { skills: skillSummaries }),
    };

    this.pods.set(id, pod);

    // Create Kubernetes resources if orchestrator is available
    if (this.createKubernetesResources && (this.orchestrator || isKubernetesAvailable())) {
      const orchestrator = this.orchestrator || getPodOrchestrator();
      
      try {
        const result = await orchestrator.createAll({
          podId: id,
          ownerWallet,
          llm,
          llmSecretName,
          ownerKeyId: keyId,
          ownerKeySecretName,
          ownerPublicKey: publicKeyPem,
          model: llm.model,
          skills: workspaceSkills
        });

        if (result.status === 'failed') {
          console.error('Failed to create Kubernetes pod:', result.message);
        }
      } catch (error) {
        console.error('Error creating Kubernetes pod:', error);
      }
    }

    return pod;
  }

  /**
   * Lists pods owned by a specific wallet address.
   *
   * @param ownerWallet - Wallet owner to filter by.
   * @returns Matching pod records.
   */
  list(ownerWallet: string): Pod[] {
    return Array.from(this.pods.values()).filter((pod) => pod.ownerWallet === ownerWallet);
  }

  /**
   * Retrieves a pod by its unique identifier.
   *
   * @param id - Pod identifier.
   * @returns Pod when found.
   */
  get(id: string): Pod | undefined {
    return this.pods.get(id);
  }

  /**
   * Retrieves a pod with live status from Kubernetes.
   *
   * @param id - Pod identifier.
   * @returns Pod with live status when found.
   */
  async getWithStatus(id: string): Promise<Pod | undefined> {
    const pod = this.pods.get(id);
    
    if (!pod) {
      return undefined;
    }

    // Get live status from Kubernetes if available
    if (this.createKubernetesResources && (this.orchestrator || isKubernetesAvailable())) {
      const orchestrator = this.orchestrator || getPodOrchestrator();
      
      try {
        const status = await orchestrator.getPodStatus(id);
        
        if (status) {
          return {
            ...pod,
            status: status.status as Pod['status']
          };
        }
      } catch (error) {
        console.error('Error getting pod status:', error);
      }
    }

    return pod;
  }

  /**
   * Deletes a pod by identifier.
   * Also deletes Kubernetes resources if orchestrator is available.
   *
   * @param id - Pod identifier.
   * @returns `true` when deleted.
   */
  delete(id: string): boolean {
    const pod = this.pods.get(id);
    
    if (!pod) {
      return false;
    }

    // Delete Kubernetes resources if orchestrator is available
    if (this.createKubernetesResources && (this.orchestrator || isKubernetesAvailable())) {
      const orchestrator = this.orchestrator || getPodOrchestrator();
      
      // Async deletion - don't block on it
      orchestrator.deletePod(id).catch(error => {
        console.error('Error deleting Kubernetes pod:', error);
      });
    }

    return this.pods.delete(id);
  }

  /**
   * Removes all stored pods.
   */
  clear(): void {
    this.pods.clear();
    this.walletSecretByOwner.clear();
    this.ownerKeyStore.clear();
  }
}
