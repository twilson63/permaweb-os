import { randomUUID } from "crypto";
import { CreatePodInput, Pod, PodLlmConfig } from "./types";

export class PodStore {
  private readonly pods = new Map<string, Pod>();
  private readonly baseDomain: string;

  constructor(baseDomain: string = process.env.POD_BASE_DOMAIN || "pods.local") {
    this.baseDomain = baseDomain;
  }

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

  list(ownerWallet: string): Pod[] {
    return Array.from(this.pods.values()).filter((pod) => pod.ownerWallet === ownerWallet);
  }

  get(id: string): Pod | undefined {
    return this.pods.get(id);
  }

  delete(id: string): boolean {
    return this.pods.delete(id);
  }

  clear(): void {
    this.pods.clear();
  }
}
