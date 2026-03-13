import assert from "node:assert/strict";
import test from "node:test";
import { generateOwnerKeyPair, computeKeyId, getOwnerKeySecretName, OwnerKeyStore } from "./owner-keys";
import { createHash } from "crypto";

test("generateOwnerKeyPair creates valid RSA key pair", () => {
  const result = generateOwnerKeyPair();
  
  assert.ok(result.keyId, "keyId should be defined");
  assert.ok(result.publicKeyPem, "publicKeyPem should be defined");
  assert.ok(result.privateKeyPem, "privateKeyPem should be defined");
  
  // Key ID should be 16 characters (truncated SHA-256)
  assert.equal(result.keyId.length, 16, "keyId should be 16 characters");
  
  // Public key should be PEM format
  assert.ok(result.publicKeyPem.includes("-----BEGIN PUBLIC KEY-----"), "publicKeyPem should be PEM format");
  assert.ok(result.publicKeyPem.includes("-----END PUBLIC KEY-----"), "publicKeyPem should be PEM format");
  
  // Private key should be PEM format
  assert.ok(result.privateKeyPem.includes("-----BEGIN PRIVATE KEY-----"), "privateKeyPem should be PEM format");
  assert.ok(result.privateKeyPem.includes("-----END PRIVATE KEY-----"), "privateKeyPem should be PEM format");
});

test("generateOwnerKeyPair creates unique keys", () => {
  const result1 = generateOwnerKeyPair();
  const result2 = generateOwnerKeyPair();
  
  assert.notEqual(result1.keyId, result2.keyId, "each key pair should have unique keyId");
  assert.notEqual(result1.publicKeyPem, result2.publicKeyPem, "each key pair should have unique public key");
  assert.notEqual(result1.privateKeyPem, result2.privateKeyPem, "each key pair should have unique private key");
});

test("computeKeyId generates consistent key ID from public key", () => {
  const { publicKeyPem, keyId } = generateOwnerKeyPair();
  
  const computedKeyId = computeKeyId(publicKeyPem);
  
  assert.equal(computedKeyId, keyId, "computed keyId should match generated keyId");
  assert.equal(computedKeyId.length, 16, "keyId should be 16 characters");
  
  // Verify it's the truncated SHA-256 hash
  const expectedHash = createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
  assert.equal(computedKeyId, expectedHash, "keyId should be truncated SHA-256 of public key");
});

test("getOwnerKeySecretName formats secret name correctly", () => {
  const keyId = "abc123def456";
  const secretName = getOwnerKeySecretName(keyId);
  
  assert.equal(secretName, "owner-key-abc123def456", "secret name should be owner-key-<keyId>");
});

test("OwnerKeyStore stores and retrieves keys correctly", () => {
  const store = new OwnerKeyStore();
  const { keyId, publicKeyPem } = generateOwnerKeyPair();
  const walletAddress = "0x1234567890abcdef1234567890abcdef12345678";
  
  // Initially should not have key
  assert.equal(store.hasKey(walletAddress), false, "should not have key initially");
  assert.equal(store.getKeyId(walletAddress), undefined, "keyId should be undefined initially");
  
  // Register key
  store.register(walletAddress, keyId, publicKeyPem);
  
  // Should now have key
  assert.equal(store.hasKey(walletAddress), true, "should have key after registration");
  assert.equal(store.getKeyId(walletAddress), keyId, "keyId should match");
  assert.equal(store.getPublicKey(keyId), publicKeyPem, "publicKey should match");
});

test("OwnerKeyStore allows key replacement", () => {
  const store = new OwnerKeyStore();
  const walletAddress = "0x1234567890abcdef1234567890abcdef12345678";
  
  // Generate and register first key
  const key1 = generateOwnerKeyPair();
  store.register(walletAddress, key1.keyId, key1.publicKeyPem);
  assert.equal(store.getKeyId(walletAddress), key1.keyId, "first key should be registered");
  
  // Generate and register second key
  const key2 = generateOwnerKeyPair();
  store.register(walletAddress, key2.keyId, key2.publicKeyPem);
  assert.equal(store.getKeyId(walletAddress), key2.keyId, "second key should replace first");
  assert.equal(store.getPublicKey(key2.keyId), key2.publicKeyPem, "second public key should be stored");
});

test("OwnerKeyStore clear removes all keys", () => {
  const store = new OwnerKeyStore();
  const wallet1 = "0x1111111111111111111111111111111111111111";
  const wallet2 = "0x2222222222222222222222222222222222222222";
  
  const key1 = generateOwnerKeyPair();
  const key2 = generateOwnerKeyPair();
  
  store.register(wallet1, key1.keyId, key1.publicKeyPem);
  store.register(wallet2, key2.keyId, key2.publicKeyPem);
  
  assert.equal(store.hasKey(wallet1), true, "wallet1 should have key");
  assert.equal(store.hasKey(wallet2), true, "wallet2 should have key");
  
  store.clear();
  
  assert.equal(store.hasKey(wallet1), false, "wallet1 should not have key after clear");
  assert.equal(store.hasKey(wallet2), false, "wallet2 should not have key after clear");
  assert.equal(store.getPublicKey(key1.keyId), undefined, "key1 should be removed");
  assert.equal(store.getPublicKey(key2.keyId), undefined, "key2 should be removed");
});

test("OwnerKeyStore handles multiple wallets with different keys", () => {
  const store = new OwnerKeyStore();
  
  const wallets = [
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "0xcccccccccccccccccccccccccccccccccccccccc",
  ];
  
  const keys = wallets.map(() => generateOwnerKeyPair());
  
  // Register all keys
  wallets.forEach((wallet, i) => {
    store.register(wallet, keys[i].keyId, keys[i].publicKeyPem);
  });
  
  // Verify all keys are stored correctly
  wallets.forEach((wallet, i) => {
    assert.equal(store.getKeyId(wallet), keys[i].keyId, `wallet ${i} should have correct keyId`);
    assert.equal(store.getPublicKey(keys[i].keyId), keys[i].publicKeyPem, `key ${i} should have correct public key`);
  });
  
  // Verify keyIds are all unique
  const keyIds = keys.map((k) => k.keyId);
  const uniqueKeyIds = new Set(keyIds);
  assert.equal(uniqueKeyIds.size, keyIds.length, "all keyIds should be unique");
});