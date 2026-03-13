/**
 * @fileoverview Tests for wallet-scoped secret naming.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  normalizeWalletAddress,
  getWalletSecretName,
  isValidWalletSecretName,
  isSupportedLlmProvider,
  SUPPORTED_LLM_PROVIDERS,
  DEFAULT_NAMESPACE,
  DEFAULT_GLOBAL_SECRET_NAME,
} from "./secret-naming";

describe("normalizeWalletAddress", () => {
  it("should convert to lowercase", () => {
    assert.strictEqual(
      normalizeWalletAddress("0xABC123DEF456"),
      "0xabc123def456"
    );
  });

  it("should trim whitespace", () => {
    assert.strictEqual(
      normalizeWalletAddress("  0xabc123  "),
      "0xabc123"
    );
  });

  it("should handle Arweave addresses", () => {
    const arweaveAddr = "abcDEF123456_789xyz";
    assert.strictEqual(
      normalizeWalletAddress(arweaveAddr),
      arweaveAddr.toLowerCase()
    );
  });
});

describe("getWalletSecretName", () => {
  it("should generate secret name with 16-char hash", () => {
    const secretName = getWalletSecretName("0x1234567890abcdef");
    assert.match(secretName, /^llm-keys-[a-f0-9]{16}$/);
  });

  it("should generate consistent names for same address", () => {
    const addr = "0x1234567890abcdef";
    assert.strictEqual(
      getWalletSecretName(addr),
      getWalletSecretName(addr)
    );
  });

  it("should generate different names for different addresses", () => {
    const name1 = getWalletSecretName("0x1111111111111111");
    const name2 = getWalletSecretName("0x2222222222222222");
    assert.notStrictEqual(name1, name2);
  });

  it("should normalize before hashing", () => {
    assert.strictEqual(
      getWalletSecretName("0xABCDEF"),
      getWalletSecretName("0xabcdef")
    );
    assert.strictEqual(
      getWalletSecretName("  0xabcdef  "),
      getWalletSecretName("0xABCDEF")
    );
  });

  it("should handle Arweave addresses", () => {
    const secretName = getWalletSecretName("abc123DEF456_789XYZ");
    assert.match(secretName, /^llm-keys-[a-f0-9]{16}$/);
  });
});

describe("isValidWalletSecretName", () => {
  it("should accept valid secret names", () => {
    assert.strictEqual(isValidWalletSecretName("llm-keys-a1b2c3d4e5f67890"), true);
    assert.strictEqual(isValidWalletSecretName("llm-keys-0000000000000000"), true);
    assert.strictEqual(isValidWalletSecretName("llm-keys-ffffffffffffffff"), true);
  });

  it("should reject invalid secret names", () => {
    // Wrong prefix
    assert.strictEqual(isValidWalletSecretName("llm-api-keys"), false);
    assert.strictEqual(isValidWalletSecretName("llm-keys"), false);
    
    // Wrong length
    assert.strictEqual(isValidWalletSecretName("llm-keys-abc"), false);
    assert.strictEqual(isValidWalletSecretName("llm-keys-a1b2c3d4e5f678901"), false);
    
    // Non-hex characters
    assert.strictEqual(isValidWalletSecretName("llm-keys-ghijklmnop"), false);
    assert.strictEqual(isValidWalletSecretName("llm-keys-ABCDEFGHIJKLMNOP"), false);
    
    // Special characters
    assert.strictEqual(isValidWalletSecretName("llm-keys-a1b2c3d4!@#$%^&"), false);
  });
});

describe("isSupportedLlmProvider", () => {
  it("should accept supported providers", () => {
    assert.strictEqual(isSupportedLlmProvider("openai"), true);
    assert.strictEqual(isSupportedLlmProvider("anthropic"), true);
    assert.strictEqual(isSupportedLlmProvider("groq"), true);
  });

  it("should reject unsupported providers", () => {
    assert.strictEqual(isSupportedLlmProvider("google"), false);
    assert.strictEqual(isSupportedLlmProvider("mistral"), false);
    assert.strictEqual(isSupportedLlmProvider("OpenAI"), false); // case sensitive
    assert.strictEqual(isSupportedLlmProvider(""), false);
    assert.strictEqual(isSupportedLlmProvider("random-provider"), false);
  });
});

describe("constants", () => {
  it("should have correct default namespace", () => {
    assert.strictEqual(DEFAULT_NAMESPACE, "web-os");
  });

  it("should have correct global secret name", () => {
    assert.strictEqual(DEFAULT_GLOBAL_SECRET_NAME, "llm-api-keys");
  });

  it("should have correct supported providers", () => {
    assert.deepStrictEqual(SUPPORTED_LLM_PROVIDERS, ["openai", "anthropic", "groq"]);
  });
});