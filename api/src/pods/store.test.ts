import assert from "node:assert/strict";
import test from "node:test";
import { describe, beforeEach } from "node:test";
import { PodStore } from "./store";
import { getWalletSecretName, normalizeWalletAddress } from "./secret-naming";
import { getOwnerKeySecretName } from "./owner-keys";

const llm = {
  model: "openai/gpt-4o-mini",
  provider: "openai",
  keyPath: "/secrets/llm/openai"
};

describe("PodStore", () => {
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

  test("create fails when no secret exists and fallback disabled", () => {
    const store = new PodStore({
      secretExists: () => false,
      fallbackToGlobal: false
    });

    assert.throws(() => {
      store.create("0xABC123", { name: "alpha" }, llm);
    }, /No LLM secret available/);
  });

  test("walletSecretName generates consistent hashes", () => {
    const store = new PodStore();
    const wallet = "0xABC123DEF456";

    const expected = getWalletSecretName(wallet);
    const actual = store.walletSecretName(wallet);

    assert.equal(actual, expected);
    assert.match(actual, /^llm-keys-[a-f0-9]{16}$/);
  });

  test("walletSecretName normalizes addresses", () => {
    const store = new PodStore();

    assert.equal(
      store.walletSecretName("0xABC123"),
      store.walletSecretName("0xabc123")
    );
    assert.equal(
      store.walletSecretName("  0xabc123  "),
      store.walletSecretName("0xABC123")
    );
  });

  test("bindWalletSecret allows explicit secret binding", () => {
    const store = new PodStore();
    const wallet = "0xABC123";
    const customSecret = "custom-llm-keys-test";

    const bound = store.bindWalletSecret(wallet, customSecret);

    assert.equal(bound, customSecret);
    // After binding, create should use the bound secret (assuming it exists check passes)
    const storeWithCustom = new PodStore({
      secretExists: (name) => name === customSecret
    });
    storeWithCustom.bindWalletSecret(wallet, customSecret);
    const pod = storeWithCustom.create(wallet, {}, llm);
    assert.equal(pod.llmSecretName, customSecret);
  });

  test("bindWalletSecret uses default if no secret provided", () => {
    const store = new PodStore();
    const wallet = "0xABC123";

    const bound = store.bindWalletSecret(wallet);

    assert.equal(bound, getWalletSecretName(wallet));
  });

  test("different wallets get different secrets and owner keys", () => {
    const store = new PodStore({
      secretExists: () => true
    });

    const pod1 = store.create("0xAAA111", {}, llm);
    const pod2 = store.create("0xBBB222", {}, llm);

    assert.notEqual(pod1.llmSecretName, pod2.llmSecretName);
    assert.notEqual(pod1.ownerKeyId, pod2.ownerKeyId);
    assert.ok(pod1.ownerKeySecretName, "pod1 should have ownerKeySecretName");
    assert.ok(pod2.ownerKeySecretName, "pod2 should have ownerKeySecretName");
    assert.notEqual(pod1.ownerKeySecretName, pod2.ownerKeySecretName);
  });

  test("same wallet gets same secret and owner key", () => {
    const store = new PodStore({
      secretExists: () => true
    });

    const pod1 = store.create("0xABC123", {}, llm);
    const pod2 = store.create("0xABC123", {}, llm);

    assert.equal(pod1.llmSecretName, pod2.llmSecretName);
    assert.equal(pod1.ownerKeyId, pod2.ownerKeyId);
    assert.equal(pod1.ownerKeySecretName, pod2.ownerKeySecretName);
  });

  test("list returns only owner's pods", () => {
    const store = new PodStore({
      secretExists: () => true
    });

    const pod1 = store.create("0xAAA111", { name: "pod1" }, llm);
    const pod2 = store.create("0xBBB222", { name: "pod2" }, llm);
    const pod3 = store.create("0xAAA111", { name: "pod3" }, llm);

    const list1 = store.list("0xAAA111");
    const list2 = store.list("0xBBB222");

    assert.equal(list1.length, 2);
    assert.equal(list2.length, 1);
    assert.deepEqual(list1.map(p => p.name).sort(), ["pod1", "pod3"]);
    assert.deepEqual(list2.map(p => p.name), ["pod2"]);
  });

  test("get returns undefined for unknown pod", () => {
    const store = new PodStore();
    assert.equal(store.get("nonexistent"), undefined);
  });

  test("delete returns false for unknown pod", () => {
    const store = new PodStore();
    assert.equal(store.delete("nonexistent"), false);
  });

  test("clear removes all pods", () => {
    const store = new PodStore({
      secretExists: () => true
    });

    store.create("0xAAA", {}, llm);
    store.create("0xBBB", {}, llm);

    store.clear();

    assert.equal(store.list("0xAAA").length, 0);
    assert.equal(store.list("0xBBB").length, 0);
  });

  test("pod has correct fields including owner key", () => {
    const store = new PodStore({
      secretExists: () => true
    });

    const wallet = "0xABC123DEF456";
    const pod = store.create(wallet, { name: "test-pod" }, llm);

    assert.ok(pod.id);
    assert.equal(pod.name, "test-pod");
    assert.equal(pod.status, "running");
    assert.equal(pod.ownerWallet, wallet);
    assert.ok(pod.createdAt);
    assert.equal(pod.llm, llm);
    assert.equal(pod.llmSecretName, getWalletSecretName(wallet));
    // ownerKeyId should be a 16-char key ID, not wallet address
    assert.equal(pod.ownerKeyId.length, 16, "ownerKeyId should be 16 characters");
    assert.ok(pod.ownerKeySecretName, "pod should have ownerKeySecretName");
    assert.match(pod.ownerKeySecretName!, /^owner-key-[a-f0-9]{16}$/);
  });

  test("getOrCreateOwnerKey generates unique keys per wallet", () => {
    const store = new PodStore({
      secretExists: () => true
    });

    const wallet1 = "0xAAA1111111111111111111111111111111111111";
    const wallet2 = "0xBBB2222222222222222222222222222222222222";

    const key1First = store.getOrCreateOwnerKey(wallet1);
    const key2First = store.getOrCreateOwnerKey(wallet2);

    // Different wallets should get different keys
    assert.notEqual(key1First.keyId, key2First.keyId);
    assert.notEqual(key1First.publicKeyPem, key2First.publicKeyPem);
    assert.notEqual(key1First.secretName, key2First.secretName);

    // Same wallet should get same key on subsequent calls
    const key1Second = store.getOrCreateOwnerKey(wallet1);
    assert.equal(key1First.keyId, key1Second.keyId);
    assert.equal(key1First.publicKeyPem, key1Second.publicKeyPem);
    // Private key is only returned on first creation
    assert.equal(key1Second.privateKeyPem, "");
  });

  test("registerOwnerKey allows external key registration", () => {
    const store = new PodStore({
      secretExists: () => true
    });

    const wallet = "0xABC123DEF4567890123456789012345678901234";
    
    // Import a pre-generated key
    const { generateOwnerKeyPair, computeKeyId } = require("./owner-keys");
    const keyPair = generateOwnerKeyPair();
    
    const result = store.registerOwnerKey(wallet, keyPair.publicKeyPem);
    
    assert.equal(result.keyId, keyPair.keyId);
    assert.equal(result.secretName, getOwnerKeySecretName(keyPair.keyId));
    
    // Subsequent calls should return the registered key
    const stored = store.getOrCreateOwnerKey(wallet);
    assert.equal(stored.keyId, keyPair.keyId);
    assert.equal(stored.publicKeyPem, keyPair.publicKeyPem);
  });
});

describe("PodStore async", () => {
  test("createAsync resolves with async secretExists", async () => {
    const store = new PodStore({
      secretExists: async (secretName) => {
        // Simulate async Kubernetes API call
        await new Promise(resolve => setTimeout(resolve, 10));
        return secretName.startsWith("llm-keys-");
      }
    });

    const pod = await store.createAsync("0xABC123", { name: "alpha" }, llm);
    assert.match(pod.llmSecretName, /^llm-keys-[a-f0-9]{16}$/);
  });

  test("createAsync falls back to global secret", async () => {
    const store = new PodStore({
      secretExists: async (secretName) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return secretName === "llm-api-keys";
      }
    });

    const pod = await store.createAsync("0xABC123", { name: "alpha" }, llm);
    assert.equal(pod.llmSecretName, "llm-api-keys");
  });

  test("createAsync rejects when no secret available", async () => {
    const store = new PodStore({
      secretExists: async () => false
    });

    await assert.rejects(
      async () => store.createAsync("0xABC123", {}, llm),
      /No LLM secret available/
    );
  });

  test("createAsync with fallback disabled", async () => {
    const store = new PodStore({
      secretExists: async () => false,
      fallbackToGlobal: false
    });

    await assert.rejects(
      async () => store.createAsync("0xABC123", {}, llm),
      /No LLM secret available/
    );
  });
});