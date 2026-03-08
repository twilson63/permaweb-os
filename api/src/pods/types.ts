export type PodStatus = "running";

export interface Pod {
  id: string;
  name: string;
  status: PodStatus;
  subdomain: string;
  ownerWallet: string;
  createdAt: string;
}

export interface CreatePodInput {
  name?: string;
}
