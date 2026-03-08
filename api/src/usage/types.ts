export interface CreateUsageInput {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface UsageRecord {
  id: string;
  ownerWallet: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  createdAt: string;
}

export interface UsageSummary {
  ownerWallet: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
}
