export type PodStatus = "running";

export interface Pod {
  id: string;
  name: string;
  status: PodStatus;
  subdomain: string;
  createdAt: string;
}

export interface CreatePodInput {
  name?: string;
}
