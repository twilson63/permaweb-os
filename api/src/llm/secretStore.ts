import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const PROVIDER_NAME_PATTERN = /^[a-z0-9._-]+$/i;

export class LlmSecretStore {
  private readonly secretsDir: string;

  constructor(secretsDir: string = process.env.LLM_SECRETS_DIR || "/secrets/llm") {
    this.secretsDir = secretsDir;
  }

  readProviderKey(provider: string): string | undefined {
    if (!PROVIDER_NAME_PATTERN.test(provider)) {
      return undefined;
    }

    try {
      const content = readFileSync(join(this.secretsDir, provider), "utf-8").trim();
      return content.length > 0 ? content : undefined;
    } catch {
      return undefined;
    }
  }

  listConfiguredProviders(): string[] {
    try {
      return readdirSync(this.secretsDir)
        .filter((provider) => PROVIDER_NAME_PATTERN.test(provider))
        .filter((provider) => this.readProviderKey(provider) !== undefined)
        .sort();
    } catch {
      return [];
    }
  }
}
