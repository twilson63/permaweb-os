import { createHash, randomUUID } from "crypto";
import { CreatePodInput, Pod, PodLlmConfig } from "./types";

const DEFAULT_GLOBAL_LLM_SECRET_NAME = "llm-api-keys";
const DEFAULT_WALLET_SECRET_PREFIX = "llm-keys";

type PodStoreOptions = {
  baseDomain?: string;
  globalLlmSecretName?: string;
  walletSecretPrefix?: string;
  secretExists?: (secretName: string) => boolean;
};

const normalizeWalletAddress = (walletAddress: string): string => {
  return walletAddress.trim().toLowerCase();
};

const walletHash = (walletAddress: string): string => {
  return createHash("sha256").update(normalizeWalletAddress(walletAddress)).digest("hex").slice(0, 16);
};

/**
 * In-memory pod store responsible for pod CRUD operations.
 */
export class PodStore {
  private readonly pods = new Map<string, Pod>();
  private readonly walletSecretByOwner = new Map<string, string>();
  private readonly baseDomain: string;
  private readonly globalLlmSecretName: string;
  private readonly walletSecretPrefix: string;
  private readonly secretExists: (secretName: string) => boolean;

  /**
   * @param baseDomain - Base domain appended to generated pod subdomains.
   */
  constructor(options: PodStoreOptions = {}) {
    this.baseDomain = options.baseDomain || process.env.POD_BASE_DOMAIN || "pods.local";
    this.globalLlmSecretName =
      options.globalLlmSecretName || process.env.LLM_GLOBAL_SECRET_NAME || DEFAULT_GLOBAL_LLM_SECRET_NAME;
    this.walletSecretPrefix =
      options.walletSecretPrefix || process.env.LLM_WALLET_SECRET_PREFIX || DEFAULT_WALLET_SECRET_PREFIX;
    this.secretExists = options.secretExists || (() => true);
  }

  walletSecretName(ownerWallet: string): string {
    return `${this.walletSecretPrefix}-${walletHash(ownerWallet)}`;
  }

  bindWalletSecret(ownerWallet: string, secretName?: string): string {
    const normalized = normalizeWalletAddress(ownerWallet);
    const boundSecretName = secretName?.trim() || this.walletSecretName(normalized);
    this.walletSecretByOwner.set(normalized, boundSecretName);
    return boundSecretName;
  }

  private resolveLlmSecretName(ownerWallet: string): string {
    const normalized = normalizeWalletAddress(ownerWallet);
    const mappedSecret = this.walletSecretByOwner.get(normalized);
    const walletSecret = mappedSecret || this.walletSecretName(normalized);

    if (this.secretExists(walletSecret)) {
      return walletSecret;
    }

    if (this.secretExists(this.globalLlmSecretName)) {
      return this.globalLlmSecretName;
    }

    throw new Error(`No LLM secret available for wallet ${normalized}`);
  }

  /**
   * Creates and stores a new pod record for the given wallet owner.
   *
   * @param ownerWallet - Wallet address that owns the pod.
   * @param input - Optional creation input (name/model hints).
   * @param llm - Resolved LLM config used by the pod runtime.
   * @returns Newly created pod.
   */
  create(ownerWallet: string, input: CreatePodInput = {}, llm: PodLlmConfig): Pod {
    const id = randomUUID();
    const llmSecretName = this.resolveLlmSecretName(ownerWallet);
    const ownerKeyId = normalizeWalletAddress(ownerWallet);
    const pod: Pod = {
      id,
      name: input.name?.trim() || `pod-${id.slice(0, 8)}`,
      status: "running",
      subdomain: `${id}.${this.baseDomain}`,
      ownerWallet,
      createdAt: new Date().toISOString(),
      llm,
      llmSecretName,
      ownerKeyId
    };

    this.pods.set(id, pod);
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
   * Deletes a pod by identifier.
   *
   * @param id - Pod identifier.
   * @returns `true` when deleted.
   */
  delete(id: string): boolean {
    return this.pods.delete(id);
  }

  /**
   * Removes all stored pods.
   */
  clear(): void {
    this.pods.clear();
    this.walletSecretByOwner.clear();
  }
}
