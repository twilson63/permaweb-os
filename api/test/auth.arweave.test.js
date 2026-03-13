const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isValidArweaveAddress,
  isValidEthereumAddress,
  detectWalletType,
  normalizeWalletAddress,
  jwkToPem,
  verifyArweaveSignatureWithPem,
} = require("../dist/auth/arweave.js");
const { AuthStore } = require("../dist/auth/store.js");

// Test vectors
const VALID_ARWEAVE_ADDRESS = "vh-N1VH0rFF5FPKKp0D4VW9SaFmMRv0YcWGaZtNlNxA";
const INVALID_ARWEAVE_TOO_SHORT = "vh-N1VH0rFF5FPKKp0D4VW9SaFmMRv0YcWGaZtNlNx";
const INVALID_ARWEAVE_TOO_LONG = "vh-N1VH0rFF5FPKKp0D4VW9SaFmMRv0YcWGaZtNlNxABCD";
const INVALID_ARWEAVE_BAD_CHARS = "vh-N1VH0rFF5FPKKp0D4VW9SaFmMRv0YcWGaZtNlN+@#";

const VALID_ETHEREUM_ADDRESS = "0x1234567890123456789012345678901234567890";
const VALID_ETHEREUM_MIXED_CASE = "0xAbCdEF1234567890aBcDeF1234567890ABCDEF12";

// Mock JWK for testing (not a real key, just for format validation)
const MOCK_JWK = {
  kty: "RSA",
  n: "vh-N1VH0rFF5FPKKp0D4VW9SaFmMRv0YcWGaZtNlNxA", // Base64url modulus
  e: "AQAB" // Standard exponent
};

test("isValidArweaveAddress returns true for valid 43-char base64url address", () => {
  assert.equal(isValidArweaveAddress(VALID_ARWEAVE_ADDRESS), true);
});

test("isValidArweaveAddress returns false for too short address", () => {
  assert.equal(isValidArweaveAddress(INVALID_ARWEAVE_TOO_SHORT), false);
});

test("isValidArweaveAddress returns false for too long address", () => {
  assert.equal(isValidArweaveAddress(INVALID_ARWEAVE_TOO_LONG), false);
});

test("isValidArweaveAddress returns false for invalid characters", () => {
  assert.equal(isValidArweaveAddress(INVALID_ARWEAVE_BAD_CHARS), false);
});

test("isValidArweaveAddress returns false for empty string", () => {
  assert.equal(isValidArweaveAddress(""), false);
});

test("isValidEthereumAddress returns true for valid 0x-prefixed hex address", () => {
  assert.equal(isValidEthereumAddress(VALID_ETHEREUM_ADDRESS), true);
});

test("isValidEthereumAddress returns true for mixed case address", () => {
  assert.equal(isValidEthereumAddress(VALID_ETHEREUM_MIXED_CASE), true);
});

test("isValidEthereumAddress returns false for non-0x prefix", () => {
  assert.equal(isValidEthereumAddress("1234567890123456789012345678901234567890"), false);
});

test("isValidEthereumAddress returns false for wrong length", () => {
  assert.equal(isValidEthereumAddress("0x123456789"), false);
});

test("detectWalletType returns 'ethereum' for Ethereum addresses", () => {
  assert.equal(detectWalletType(VALID_ETHEREUM_ADDRESS), "ethereum");
});

test("detectWalletType returns 'arweave' for Arweave addresses", () => {
  assert.equal(detectWalletType(VALID_ARWEAVE_ADDRESS), "arweave");
});

test("detectWalletType returns null for invalid addresses", () => {
  assert.equal(detectWalletType("invalid-address"), null);
});

test("detectWalletType returns null for empty string", () => {
  assert.equal(detectWalletType(""), null);
});

test("normalizeWalletAddress returns lowercase for Ethereum", () => {
  const result = normalizeWalletAddress(VALID_ETHEREUM_MIXED_CASE);
  assert.equal(result, VALID_ETHEREUM_MIXED_CASE.toLowerCase());
});

test("normalizeWalletAddress preserves case for Arweave", () => {
  const result = normalizeWalletAddress(VALID_ARWEAVE_ADDRESS);
  assert.equal(result, VALID_ARWEAVE_ADDRESS);
});

test("normalizeWalletAddress throws for invalid address", () => {
  assert.throws(() => normalizeWalletAddress("invalid"), /Invalid wallet address/);
});

test("normalizeWalletAddress trims whitespace", () => {
  const result = normalizeWalletAddress(`  ${VALID_ARWEAVE_ADDRESS}  `);
  assert.equal(result, VALID_ARWEAVE_ADDRESS);
});

// AuthStore tests for Arweave
test("AuthStore.createChallenge accepts Arweave addresses", () => {
  const store = new AuthStore();
  const challenge = store.createChallenge(VALID_ARWEAVE_ADDRESS);
  
  assert.ok(challenge.message);
  assert.ok(challenge.nonce);
  assert.equal(challenge.walletType, "arweave");
  assert.ok(challenge.message.includes(VALID_ARWEAVE_ADDRESS));
});

test("AuthStore.createChallenge accepts Ethereum addresses", () => {
  const store = new AuthStore();
  const challenge = store.createChallenge(VALID_ETHEREUM_ADDRESS);
  
  assert.ok(challenge.message);
  assert.ok(challenge.nonce);
  assert.equal(challenge.walletType, "ethereum");
});

test("AuthStore.createChallenge rejects invalid addresses", () => {
  const store = new AuthStore();
  
  assert.throws(() => {
    store.createChallenge("invalid-address");
  }, /Invalid wallet address/);
});

test("AuthStore.createChallenge includes wallet type in challenge", () => {
  const store = new AuthStore();
  
  const ethChallenge = store.createChallenge(VALID_ETHEREUM_ADDRESS);
  assert.equal(ethChallenge.walletType, "ethereum");
  
  const arweaveChallenge = store.createChallenge(VALID_ARWEAVE_ADDRESS);
  assert.equal(arweaveChallenge.walletType, "arweave");
});

test("jwkToPem produces valid PEM format", () => {
  const pem = jwkToPem(MOCK_JWK);
  
  assert.ok(pem.startsWith("-----BEGIN PUBLIC KEY-----"));
  assert.ok(pem.endsWith("-----END PUBLIC KEY-----"));
});

test("verifyArweaveSignatureWithPem returns false for invalid signature", () => {
  // Without a real signature, this should fail validation
  const result = verifyArweaveSignatureWithPem(
    "test message",
    "invalid-signature",
    jwkToPem(MOCK_JWK)
  );
  
  assert.equal(result, false);
});

// Test backward compatibility - verifySignatureSync for Ethereum only
test("AuthStore.verifySignatureSync only works for Ethereum", async () => {
  const store = new AuthStore();
  
  // Create challenge for Arweave
  store.createChallenge(VALID_ARWEAVE_ADDRESS);
  
  // Sync verification should return null for Arweave (not supported)
  const result = store.verifySignatureSync(VALID_ARWEAVE_ADDRESS, "fake-signature");
  assert.equal(result, null);
});

test("AuthStore.verifySignature is async and handles both wallet types", async () => {
  const store = new AuthStore();
  
  // Create challenge
  const challenge = store.createChallenge(VALID_ARWEAVE_ADDRESS);
  assert.ok(challenge);
  
  // Verify should return null for invalid signature (but not throw)
  const result = await store.verifySignature(VALID_ARWEAVE_ADDRESS, "invalid-sig");
  assert.equal(result, null);
});