import { randomUUID } from "crypto";
import { CreatePodInput, Pod, PodLlmConfig } from "./types";

/**
 * In-memory pod store responsible for pod CRUD operations.
 */
export class PodStore {
  private readonly pods = new Map<string, Pod>();
  private readonly baseDomain: string;

  /**
   * @param baseDomain - Base domain appended to generated pod subdomains.
   */
  constructor(baseDomain: string = process.env.POD_BASE_DOMAIN || "pods.local") {
    this.baseDomain = baseDomain;
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
    const pod: Pod = {
      id,
      name: input.name?.trim() || `pod-${id.slice(0, 8)}`,
      status: "running",
      subdomain: `${id}.${this.baseDomain}`,
      ownerWallet,
      createdAt: new Date().toISOString(),
      llm
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
  }
}
