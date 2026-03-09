/**
 * Registry of supported LLM models and pricing metadata.
 */

/**
 * Mapping from full model IDs to provider slugs.
 */
const MODEL_PROVIDER_MAP: Record<string, string> = {
  "openai/gpt-4.1-mini": "openai",
  "openai/gpt-4o-mini": "openai",
  "anthropic/claude-3-5-haiku": "anthropic",
  "anthropic/claude-3-7-sonnet": "anthropic"
};

/**
 * Cost map in USD per 1K tokens, split by input/output token classes.
 */
const MODEL_TOKEN_COST_USD: Record<string, { inputPer1K: number; outputPer1K: number }> = {
  "openai/gpt-4.1-mini": { inputPer1K: 0.0004, outputPer1K: 0.0016 },
  "openai/gpt-4o-mini": { inputPer1K: 0.00015, outputPer1K: 0.0006 },
  "anthropic/claude-3-5-haiku": { inputPer1K: 0.0008, outputPer1K: 0.004 },
  "anthropic/claude-3-7-sonnet": { inputPer1K: 0.003, outputPer1K: 0.015 }
};

/**
 * Safe fallback when no valid default model is configured.
 */
const FALLBACK_MODEL = "openai/gpt-4o-mini";

/**
 * Resolves the default model from environment configuration.
 *
 * @returns Configured default model when supported, else fallback model.
 */
const getDefaultModel = (): string => {
  const configuredDefault = process.env.DEFAULT_LLM_MODEL?.trim().toLowerCase();

  if (configuredDefault && MODEL_PROVIDER_MAP[configuredDefault]) {
    return configuredDefault;
  }

  return FALLBACK_MODEL;
};

/**
 * Normalized model selection returned by the registry.
 */
export interface ModelSelection {
  model: string;
  provider: string;
  keyPath: string;
}

/**
 * Lists all supported model IDs sorted alphabetically.
 *
 * @returns Supported models.
 */
export const listSupportedModels = (): string[] => Object.keys(MODEL_PROVIDER_MAP).sort();

/**
 * Resolves user input into a normalized model selection.
 *
 * @param model - Optional model selection input from request payload.
 * @returns Model selection when supported, otherwise `undefined`.
 */
export const resolveModelSelection = (model: unknown): ModelSelection | undefined => {
  const selectedModel = typeof model === "string" && model.trim().length > 0 ? model.trim().toLowerCase() : getDefaultModel();
  const provider = MODEL_PROVIDER_MAP[selectedModel];

  if (!provider) {
    return undefined;
  }

  return {
    model: selectedModel,
    provider,
    keyPath: `/secrets/llm/${provider}`
  };
};

/**
 * Calculates request cost for a model using prompt/completion token counts.
 *
 * @param model - Full model ID.
 * @param promptTokens - Number of prompt/input tokens.
 * @param completionTokens - Number of completion/output tokens.
 * @returns Total USD cost rounded to 8 decimals, or `undefined` when unknown.
 */
export const calculateModelCostUsd = (
  model: string,
  promptTokens: number,
  completionTokens: number
): number | undefined => {
  const pricing = MODEL_TOKEN_COST_USD[model];

  if (!pricing) {
    return undefined;
  }

  const inputCost = (promptTokens / 1000) * pricing.inputPer1K;
  const outputCost = (completionTokens / 1000) * pricing.outputPer1K;
  return Number((inputCost + outputCost).toFixed(8));
};
