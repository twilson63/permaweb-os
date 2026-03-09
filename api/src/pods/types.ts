/**
 * Shared pod domain types used by API handlers and stores.
 */

/**
 * Current lifecycle states for pods.
 */
export type PodStatus = "running";

/**
 * LLM runtime configuration assigned to a pod.
 */
export interface PodLlmConfig {
  model: string;
  provider: string;
  keyPath: string;
}

/**
 * Pod record returned by the API.
 */
export interface Pod {
  id: string;
  name: string;
  status: PodStatus;
  subdomain: string;
  ownerWallet: string;
  createdAt: string;
  llm: PodLlmConfig;
  llmSecretName: string;
  ownerKeyId: string;
}

/**
 * Request payload accepted when creating a pod.
 */
export interface CreatePodInput {
  name?: string;
  model?: string;
}
