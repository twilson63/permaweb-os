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
 * Workspace-local OpenCode skill materialized into the pod filesystem.
 */
export interface WorkspaceSkill {
  name: string;
  description: string;
  markdown: string;
  path: string;
}

/**
 * Public skill summary returned with pod records.
 */
export interface PodSkill {
  name: string;
  description: string;
  path: string;
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
  /** Key ID for HTTPSig verification (public identifier, not the key itself) */
  ownerKeyId: string;
  /** Kubernetes secret name containing the owner's public key (mounted only in sidecar) */
  ownerKeySecretName?: string;
  /** Workspace-local skills available to OpenCode in this pod */
  skills?: PodSkill[];
}

/**
 * Request payload accepted when creating a pod.
 */
export interface CreatePodInput {
  name?: string;
  model?: string;
  skills?: WorkspaceSkill[];
}
