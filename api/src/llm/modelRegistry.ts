const MODEL_PROVIDER_MAP: Record<string, string> = {
  "openai/gpt-4.1-mini": "openai",
  "openai/gpt-4o-mini": "openai",
  "anthropic/claude-3-5-haiku": "anthropic",
  "anthropic/claude-3-7-sonnet": "anthropic"
};

const FALLBACK_MODEL = "openai/gpt-4o-mini";

const getDefaultModel = (): string => {
  const configuredDefault = process.env.DEFAULT_LLM_MODEL?.trim().toLowerCase();

  if (configuredDefault && MODEL_PROVIDER_MAP[configuredDefault]) {
    return configuredDefault;
  }

  return FALLBACK_MODEL;
};

export interface ModelSelection {
  model: string;
  provider: string;
  keyPath: string;
}

export const listSupportedModels = (): string[] => Object.keys(MODEL_PROVIDER_MAP).sort();

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
