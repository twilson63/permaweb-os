import { readdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Restricts provider names used as filenames in the secrets directory.
 */
const PROVIDER_NAME_PATTERN = /^[a-z0-9._-]+$/i;

/**
 * File-system backed store for LLM provider API keys.
 */
export class LlmSecretStore {
  private readonly secretsDir: string;

  /**
   * @param secretsDir - Directory containing one file per provider secret.
   */
  constructor(secretsDir: string = process.env.LLM_SECRETS_DIR || "/secrets/llm") {
    this.secretsDir = secretsDir;
  }

  /**
   * Reads an API key for the given provider.
   *
   * @param provider - Provider slug (for example `openai`).
   * @returns Key contents when available; otherwise `undefined`.
   */
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

  /**
   * Lists providers that currently have non-empty configured keys.
   *
   * @returns Sorted provider list.
   */
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
