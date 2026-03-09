import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import { calculateModelCostUsd, resolveModelSelection } from "../llm/modelRegistry";
import { CreateUsageInput, UsageRecord, UsageSummary } from "./types";

/**
 * On-disk store shape for usage persistence.
 */
interface UsageStoreState {
  records: UsageRecord[];
}

/**
 * Default JSON file used when no explicit usage store path is provided.
 */
const DEFAULT_USAGE_STORE_PATH = process.env.USAGE_STORE_PATH || "./data/usage-store.json";

/**
 * Validates token counts accepted by usage accounting.
 *
 * @param value - Candidate token count.
 * @returns `true` when value is a non-negative integer.
 */
const isValidTokenCount = (value: unknown): value is number => {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
};

/**
 * Persistent usage store for token/cost accounting by wallet owner.
 */
export class UsageStore {
  private readonly records: UsageRecord[];
  private readonly filePath: string;

  /**
   * @param filePath - JSON file path used to persist usage state.
   */
  constructor(filePath: string = DEFAULT_USAGE_STORE_PATH) {
    this.filePath = filePath;
    this.records = this.readState().records;
  }

  /**
   * Creates and persists a usage record for one request.
   *
   * @param ownerWallet - Wallet address that owns this usage.
   * @param input - Token counts and model submitted by caller.
   * @returns Stored usage record.
   * @throws {Error} For invalid token counts, unknown models, or missing pricing.
   */
  create(ownerWallet: string, input: CreateUsageInput): UsageRecord {
    if (!isValidTokenCount(input.promptTokens) || !isValidTokenCount(input.completionTokens)) {
      throw new Error("Usage tokens must be non-negative integers");
    }

    const modelSelection = resolveModelSelection(input.model);

    if (!modelSelection) {
      throw new Error("Unsupported model selection");
    }

    const costUsd = calculateModelCostUsd(modelSelection.model, input.promptTokens, input.completionTokens);

    if (costUsd === undefined) {
      throw new Error("Missing model pricing");
    }

    const record: UsageRecord = {
      id: randomUUID(),
      ownerWallet,
      model: modelSelection.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens: input.promptTokens + input.completionTokens,
      costUsd,
      createdAt: new Date().toISOString()
    };

    this.records.push(record);
    this.writeState();
    return record;
  }

  /**
   * Lists all usage records for an owner wallet.
   *
   * @param ownerWallet - Wallet address filter.
   * @returns Matching usage records.
   */
  list(ownerWallet: string): UsageRecord[] {
    return this.records.filter((record) => record.ownerWallet === ownerWallet);
  }

  /**
   * Builds a token and cost summary for an owner wallet.
   *
   * @param ownerWallet - Wallet address filter.
   * @returns Aggregated usage totals.
   */
  summarize(ownerWallet: string): UsageSummary {
    const records = this.list(ownerWallet);
    const promptTokens = records.reduce((sum, record) => sum + record.promptTokens, 0);
    const completionTokens = records.reduce((sum, record) => sum + record.completionTokens, 0);
    const totalTokens = records.reduce((sum, record) => sum + record.totalTokens, 0);
    const totalCostUsd = Number(records.reduce((sum, record) => sum + record.costUsd, 0).toFixed(8));

    return {
      ownerWallet,
      requestCount: records.length,
      promptTokens,
      completionTokens,
      totalTokens,
      totalCostUsd
    };
  }

  /**
   * Reads usage state from disk and sanitizes unknown content.
   *
   * Any malformed file content gracefully falls back to an empty record set.
   *
   * @returns Parsed and validated usage state.
   */
  private readState(): UsageStoreState {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;

      if (typeof parsed !== "object" || parsed === null) {
        return { records: [] };
      }

      const state = parsed as { records?: unknown };

      if (!Array.isArray(state.records)) {
        return { records: [] };
      }

      return {
        records: state.records.filter((record): record is UsageRecord => {
          if (typeof record !== "object" || record === null) {
            return false;
          }

          const value = record as Record<string, unknown>;
          return (
            typeof value.id === "string" &&
            typeof value.ownerWallet === "string" &&
            typeof value.model === "string" &&
            isValidTokenCount(value.promptTokens) &&
            isValidTokenCount(value.completionTokens) &&
            isValidTokenCount(value.totalTokens) &&
            typeof value.costUsd === "number" &&
            typeof value.createdAt === "string"
          );
        })
      };
    } catch {
      return { records: [] };
    }
  }

  /**
   * Persists the current in-memory usage state to disk.
   */
  private writeState(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify({ records: this.records }, null, 2), "utf-8");
  }
}
