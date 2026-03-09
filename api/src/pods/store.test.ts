import assert from "node:assert/strict";
import test from "node:test";
import { PodStore } from "./store";

const llm = {
  model: "openai/gpt-4o-mini",
  provider: "openai",
  keyPath: "/secrets/llm/openai"
};

test("create binds hashed wallet secret when present", () => {
  const store = new PodStore({
    secretExists: (secretName) => secretName.startsWith("llm-keys-")
  });

  const pod = store.create("0xABC123", { name: "alpha" }, llm);
  assert.match(pod.llmSecretName, /^llm-keys-[a-f0-9]{16}$/);
});

test("create uses global secret as backward-compatible fallback", () => {
  const store = new PodStore({
    secretExists: (secretName) => secretName === "llm-api-keys"
  });

  const pod = store.create("0xABC123", { name: "alpha" }, llm);
  assert.equal(pod.llmSecretName, "llm-api-keys");
});

test("create fails when no secret exists", () => {
  const store = new PodStore({ secretExists: () => false });

  assert.throws(() => {
    store.create("0xABC123", { name: "alpha" }, llm);
  }, /No LLM secret available/);
});
