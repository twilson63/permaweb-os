export type PodStatus = "running";

export interface PodLlmConfig {
  model: string;
  provider: string;
  keyPath: string;
}

export interface Pod {
  id: string;
  name: string;
  status: PodStatus;
  subdomain: string;
  ownerWallet: string;
  createdAt: string;
  llm: PodLlmConfig;
}

export interface CreatePodInput {
  name?: string;
  model?: string;
}
