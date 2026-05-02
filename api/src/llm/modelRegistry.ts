/**
 * Registry of supported LLM models and pricing metadata.
 */

/**
 * Mapping from full model IDs to provider slugs.
 */
const MODEL_PROVIDER_MAP: Record<string, string> = {
  // OpenCode
  "opencode/big-pickle": "opencode",
  // OpenAI
  "openai/gpt-4.1-mini": "openai",
  "openai/gpt-4o-mini": "openai",
  "openai/gpt-4o": "openai",
  "openai/gpt-4-turbo": "openai",
  // Anthropic
  "anthropic/claude-3-5-haiku": "anthropic",
  "anthropic/claude-3-7-sonnet": "anthropic",
  "anthropic/claude-3-opus": "anthropic",
  // Groq
  "groq/llama-3.1-70b-versatile": "groq",
  "groq/llama-3.1-8b-instant": "groq",
  "groq/mixtral-8x7b-32768": "groq",
  // OpenRouter (OpenAI-compatible)
  "openrouter/auto": "openrouter",
  "openrouter/openai/gpt-4o": "openrouter",
  "openrouter/anthropic/claude-3.5-sonnet": "openrouter",
  "openrouter/anthropic/claude-3-opus": "openrouter",
  "openrouter/anthropic/claude-opus-4.7": "openrouter",
  "openrouter/meta-llama/llama-3.1-70b-instruct": "openrouter",
  "openrouter/mistralai/mistral-large": "openrouter",
};

/**
 * Cost map in USD per 1K tokens, split by input/output token classes.
 */
const MODEL_TOKEN_COST_USD: Record<string, { inputPer1K: number; outputPer1K: number }> = {
  // OpenCode
  "opencode/big-pickle": { inputPer1K: 0, outputPer1K: 0 },
  // OpenAI
  "openai/gpt-4.1-mini": { inputPer1K: 0.0004, outputPer1K: 0.0016 },
  "openai/gpt-4o-mini": { inputPer1K: 0.00015, outputPer1K: 0.0006 },
  "openai/gpt-4o": { inputPer1K: 0.0025, outputPer1K: 0.01 },
  "openai/gpt-4-turbo": { inputPer1K: 0.01, outputPer1K: 0.03 },
  // Anthropic
  "anthropic/claude-3-5-haiku": { inputPer1K: 0.0008, outputPer1K: 0.004 },
  "anthropic/claude-3-7-sonnet": { inputPer1K: 0.003, outputPer1K: 0.015 },
  "anthropic/claude-3-opus": { inputPer1K: 0.015, outputPer1K: 0.075 },
  // Groq (free tier available)
  "groq/llama-3.1-70b-versatile": { inputPer1K: 0.00059, outputPer1K: 0.00079 },
  "groq/llama-3.1-8b-instant": { inputPer1K: 0.00002, outputPer1K: 0.00002 },
  "groq/mixtral-8x7b-32768": { inputPer1K: 0.00027, outputPer1K: 0.00027 },
  // OpenRouter (varies by model, using averages)
  "openrouter/auto": { inputPer1K: 0.001, outputPer1K: 0.002 },
  "openrouter/openai/gpt-4o": { inputPer1K: 0.0025, outputPer1K: 0.01 },
  "openrouter/anthropic/claude-3.5-sonnet": { inputPer1K: 0.003, outputPer1K: 0.015 },
  "openrouter/anthropic/claude-3-opus": { inputPer1K: 0.015, outputPer1K: 0.075 },
  "openrouter/anthropic/claude-opus-4.7": { inputPer1K: 0.015, outputPer1K: 0.075 },
  "openrouter/meta-llama/llama-3.1-70b-instruct": { inputPer1K: 0.00088, outputPer1K: 0.00088 },
  "openrouter/mistralai/mistral-large": { inputPer1K: 0.002, outputPer1K: 0.006 },
};

/**
 * Safe fallback when no valid default model is configured.
 */
const FALLBACK_MODEL = "opencode/big-pickle";

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
