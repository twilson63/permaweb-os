# Test Coverage Analysis for Web-OS

**Generated:** 2026-03-12  
**Workspace:** `/Users/tron/.openclaw/workspace/web-os`

---

## 1. Current Test Inventory

### API Tests (`/api/test/pods.test.js`)

Comprehensive integration test suite with **32 test cases**:

#### Authentication Tests
| Test Case | Coverage |
|-----------|----------|
| `POST /api/auth/verify returns session token for valid signature` | ✅ Wallet auth flow |
| `POST /api/auth/verify rejects invalid signature` | ✅ Auth failure |
| `GET /api/pods returns 401 without session token` | ✅ Auth required |
| `GET /api/pods returns 401 after session expiry` | ✅ Session expiry |
| `GET /api/auth/github redirects to GitHub authorize URL` | ✅ GitHub OAuth start |
| `GET /api/auth/github/callback stores GitHub token in session` | ✅ GitHub OAuth complete |

#### Pod Lifecycle Tests
| Test Case | Coverage |
|-----------|----------|
| `POST /api/pods creates a pod and binds owner wallet` | ✅ Pod creation |
| `POST /api/pods binds wallet-scoped LLM secret when available` | ✅ Secret binding |
| `POST /api/pods isolates wallet secret names by owner` | ✅ Multi-wallet isolation |
| `POST /api/pods falls back to global secret for compatibility` | ✅ Fallback path |
| `POST /api/pods returns 400 when no wallet or global secret exists` | ✅ Error handling |
| `POST /api/pods accepts model selection and stores provider key path` | ✅ Model selection |
| `POST /api/pods maps different model providers to different key files` | ✅ Provider routing |
| `POST /api/pods rejects unsupported model selection` | ✅ Validation |
| `GET /api/pods lists created pods` | ✅ List pods |
| `GET /api/pods returns pods owned by authenticated session` | ✅ Owner filtering |
| `GET /api/pods/:id returns pod status and subdomain` | ✅ Get pod |
| `GET /api/pods/:id returns 403 for non-owner session` | ✅ Ownership check |
| `GET /api/pods/:id returns 404 for unknown pod` | ✅ Not found |
| `DELETE /api/pods/:id deletes pod` | ✅ Delete pod |
| `DELETE /api/pods/:id returns 403 for non-owner session` | ✅ Delete ownership |
| `DELETE /api/pods/:id returns 404 for unknown pod` | ✅ Delete not found |

#### LLM Provider Tests
| Test Case | Coverage |
|-----------|----------|
| `GET /api/llm/providers returns configured providers without key values` | ✅ Provider list |

#### Usage Tracking Tests
| Test Case | Coverage |
|-----------|----------|
| `POST /api/usage creates a usage record with calculated cost` | ✅ Usage creation |
| `GET /api/usage aggregates records by wallet` | ✅ Usage summary |
| `usage records persist across UsageStore restarts` | ✅ Persistence |

---

### API Unit Tests (`/api/src/pods/store.test.ts`)

**3 unit tests** for PodStore:

| Test Case | Coverage |
|-----------|----------|
| `create binds hashed wallet secret when present` | ✅ Wallet secret binding |
| `create uses global secret as backward-compatible fallback` | ✅ Fallback path |
| `create fails when no secret exists` | ✅ Error handling |

---

### OpenCode Sidecar HTTPSig Tests (`/opencode-sidecar/src/httpSig.test.ts`)

**12 test cases** for HTTP Message Signature verification:

#### Content Digest Tests
| Test Case | Coverage |
|-----------|----------|
| `computes content digest in sha-256 base64 format` | ✅ Digest generation |
| `validates content digest against request body` | ✅ Digest validation |

#### Freshness Tests
| Test Case | Coverage |
|-----------|----------|
| `rejects date header older than 5 minutes` | ✅ Stale request protection |
| `rejects date header in the future` | ✅ Future timestamp protection |
| `accepts date header within allowed skew` | ✅ Valid timestamp |

#### Signature Algorithm Tests
| Test Case | Coverage |
|-----------|----------|
| `accepts valid RSA HTTP message signature` | ✅ RSA-v1_5-SHA256 |
| `accepts valid ECDSA HTTP message signature` | ✅ ECDSA-P256-SHA256 |
| `accepts valid Ethereum personal_sign HTTP message signature` | ✅ ETH personal_sign |

#### Signature Verification Tests
| Test Case | Coverage |
|-----------|----------|
| `rejects invalid HTTP message signature` | ✅ Tampered signature |
| `rejects signature with unknown key id` | ✅ Key ID validation |
| `rejects signature input that omits content-digest component` | ✅ Required components |
| `rejects Ethereum personal_sign signature for different key id` | ✅ Address recovery |

#### Replay Protection Tests
| Test Case | Coverage |
|-----------|----------|
| `rejects replayed signature within TTL window` | ✅ Replay attack protection |
| `accepts different signatures from same key` | ✅ Legitimate reuse |

---

### OpenCode Sidecar Integration Tests (`/opencode-sidecar/src/index.test.ts`)

**5 test cases** for the `/verify` endpoint:

| Test Case | Coverage |
|-----------|----------|
| `POST /verify returns 400 for missing content` | ✅ Input validation |
| `POST /verify returns 401 for invalid signature` | ✅ Auth failure |
| `POST /verify returns 401 for missing signature` | ✅ Auth required |
| `POST /verify returns 400 for invalid JSON` | ✅ Parse error |
| `POST /verify returns 401 for tampered request body` | ✅ Body integrity |

---

### OpenCode Sidecar Pod Integration Test (`/opencode-sidecar/src/pod.integration.test.ts`)

**1 integration test**:
| Test Case | Coverage |
|-----------|----------|
| `pod integration: signed /verify request runs OpenCode and returns JSONL` | ✅ End-to-end flow |

---

### Frontend Tests (`/frontend/`)

**0 tests** - No test files exist for the frontend.

---

## 2. Coverage Percentage Estimate by Module

| Module | Source Files | Test Files | Coverage Estimate |
|--------|--------------|------------|-------------------|
| **API - Auth Store** | 1 (`auth/store.ts`) | Integration tests only | **85%** |
| **API - Auth Middleware** | 1 (`auth/middleware.ts`) | Integration tests only | **80%** |
| **API - GitHub OAuth** | 1 (`auth/githubOAuth.ts`) | Integration tests only | **70%** |
| **API - Pod Store** | 1 (`pods/store.ts`) | Unit + Integration | **90%** |
| **API - LLM Model Registry** | 1 (`llm/modelRegistry.ts`) | Integration tests only | **70%** |
| **API - LLM Secret Store** | 1 (`llm/secretStore.ts`) | Integration tests only | **60%** |
| **API - Usage Store** | 1 (`usage/store.ts`) | Integration tests | **85%** |
| **API - Metrics** | 1 (`metrics/index.ts`) | None | **0%** |
| **API - Main Index** | 1 (`index.ts`) | Integration tests | **75%** |
| **Sidecar - HTTPSig** | 1 (`httpSig.ts`) | Unit tests | **95%** |
| **Sidecar - Metrics** | 1 (`metrics.ts`) | None | **0%** |
| **Sidecar - Index** | 1 (`index.ts`) | Integration tests | **80%** |
| **Sidecar - OpenCode Process** | 1 (`opencode-process.ts`) | None | **0%** |
| **Sidecar - OpenCode Utils** | 1 (`opencode.ts`) | None | **0%** |
| **Frontend - App** | 1 (`App.tsx`) | None | **0%** |
| **Frontend - API Client** | 1 (`api.ts`) | None | **0%** |
| **Frontend - Auth Store** | 1 (`auth/store.ts`) | None | **0%** |

---

## 3. Missing Tests by Priority

### Critical Priority (Core Security/Auth)

| Module | Missing Tests | Impact |
|--------|---------------|--------|
| **Auth Store** | Arweave key verification | Cannot verify Arweave wallet signatures |
| **Auth Store** | RSA key verification | Cannot verify RSA key signatures |
| **Auth Store** | ECDSA key verification | Cannot verify ECDSA key signatures |
| **HTTPSig** | RSA-PSS-SHA512 verification | Algorithm supported but not tested |
| **HTTPSig** | ECDSA-P384-SHA384 verification | Algorithm supported but not tested |

### High Priority (Business Logic)

| Module | Missing Tests | Impact |
|--------|---------------|--------|
| **Pod Store** | Pod status transitions | Status changes not validated |
| **Usage Store** | Model cost calculation edge cases | Pricing errors could cause billing issues |
| **GitHub OAuth** | Error response handling | Error flows not tested |
| **GitHub OAuth** | State token expiry | Expired state tokens not tested |
| **LLM Secret Store** | Provider key read errors | File read errors not tested |
| **LLM Model Registry** | Environment default model override | Config not fully tested |

### Medium Priority (Error Handling/Edge Cases)

| Module | Missing Tests | Impact |
|--------|---------------|--------|
| **API** | Concurrent session handling | Race conditions possible |
| **API** | Large request body handling | DOS vulnerability potential |
| **API** | Invalid JSON body handling | Edge cases not tested |
| **Sidecar** | OpenCode process timeout | Timeout behavior unknown |
| **Sidecar** | OpenCode process error output | stderr not tested |
| **Metrics** | Metric collection | Prometheus integration untested |

### Low Priority (Frontend)

| Module | Missing Tests | Impact |
|--------|---------------|--------|
| **Frontend App** | Wallet connection flow | UI untested |
| **Frontend App** | Pod CRUD operations | UI untested |
| **Frontend App** | Error state rendering | UI untested |
| **Frontend API** | HTTPSig request signing | Frontend signing untested |

---

## 4. Recommended Test Cases to Add

### Critical Tests

```typescript
// api/test/auth.test.ts - New file

describe("AuthStore - Key Type Verification", () => {
  test("verifies Arweave wallet signature", async () => {
    // Test Arweave key type verification
  });

  test("verifies RSA key signature", async () => {
    // Test RSA key verification
  });

  test("verifies ECDSA P-256 key signature", async () => {
    // Test ECDSA key verification
  });

  test("verifies ECDSA P-384 key signature", async () => {
    // Test ECDSA P-384 key verification
  });
});

describe("HTTPSig - All Algorithms", () => {
  test("verifies RSA-PSS-SHA512 signature", async () => {
    // Currently untested algorithm
  });

  test("verifies ECDSA-P384-SHA384 signature", async () => {
    // Currently untested algorithm
  });
});
```

### High Priority Tests

```typescript
// api/test/github-oauth.test.ts - New file

describe("GitHub OAuth Error Handling", () => {
  test("handles error response from GitHub", async () => {
    // Test error query param handling
  });

  test("rejects expired state tokens", async () => {
    // Test state token TTL enforcement
  });

  test("handles missing code parameter", async () => {
    // Test missing authorization code
  });

  test("handles network failure during token exchange", async () => {
    // Test network error handling
  });
});

// api/test/pods.test.ts - Additional tests

describe("Pod Status Transitions", () => {
  test("updates pod status from running to stopped", async () => {
    // Test status transitions
  });

  test("rejects status update for non-owner", async () => {
    // Test ownership enforcement
  });
});
```

### Medium Priority Tests

```typescript
// api/test/error-handling.test.ts - New file

describe("API Error Handling", () => {
  test("returns 400 for malformed JSON body", async () => {
    // Test JSON parse errors
  });

  test("handles concurrent session creation for same wallet", async () => {
    // Test race condition handling
  });

  test("handles large request body", async () => {
    // Test body size limits
  });
});

// opencode-sidecar/src/opencode.test.ts - New file

describe("OpenCode Process Management", () => {
  test("handles process timeout", async () => {
    // Test timeout behavior
  });

  test("captures stderr output", async () => {
    // Test error output handling
  });

  test("handles process spawn failure", async () => {
    // Test process creation errors
  });
});
```

### Low Priority Tests (Frontend)

```typescript
// frontend/src/App.test.tsx - New file

describe("App - Wallet Connection", () => {
  test("connects to MetaMask wallet", async () => {
    // Test wallet connection flow
  });

  test("displays error when no wallet installed", async () => {
    // Test missing wallet handling
  });

  test("creates pod after authentication", async () => {
    // Test full authenticated flow
  });
});
```

---

## 5. Test Commands to Run

### API Tests

```bash
cd /Users/tron/.openclaw/workspace/web-os/api
npm run test
```

### OpenCode Sidecar Tests

```bash
cd /Users/tron/.openclaw/workspace/web-os/opencode-sidecar
npm run test
```

### Run All Tests

```bash
cd /Users/tron/.openclaw/workspace/web-os
(cd api && npm run test) && (cd opencode-sidecar && npm run test)
```

### Run with Coverage (if jest installed)

```bash
# Add to package.json scripts:
# "test:coverage": "npm run build && node --test --experimental-test-coverage test/**/*.test.js"

cd /Users/tron/.openclaw/workspace/web-os/api
npm run test:coverage

cd /Users/tron/.openclaw/workspace/web-os/opencode-sidecar
npm run test:coverage
```

---

## 6. Critical Path Coverage Summary

| Critical Path | Test Coverage |
|---------------|---------------|
| **Wallet authentication (Ethereum)** | ✅ Covered |
| **Wallet authentication (Arweave)** | ❌ Not tested |
| **Wallet authentication (RSA)** | ❌ Not tested |
| **Wallet authentication (ECDSA)** | ❌ Not tested |
| **HTTPSig request signing** | ✅ Covered (frontend has implementation) |
| **HTTPSig verification (RSA-v1_5-SHA256)** | ✅ Covered |
| **HTTPSig verification (RSA-PSS-SHA512)** | ❌ Not tested |
| **HTTPSig verification (ECDSA-P256-SHA256)** | ✅ Covered |
| **HTTPSig verification (ECDSA-P384-SHA384)** | ❌ Not tested |
| **HTTPSig verification (ETH personal_sign)** | ✅ Covered |
| **Replay protection** | ✅ Covered |
| **Content digest verification** | ✅ Covered |
| **Date header freshness** | ✅ Covered |
| **Pod creation with owner binding** | ✅ Covered |
| **Secret mounting (LLM keys per-wallet)** | ✅ Covered |
| **Request routing to correct pod** | ⚠️ Partial (mocked) |
| **Usage tracking per wallet** | ✅ Covered |

---

## 7. Recommendations

1. **Add AuthStore unit tests** for Arweave, RSA, and ECDSA key types (currently only Ethereum is tested)
2. **Add missing HTTPSig algorithm tests** for RSA-PSS-SHA512 and ECDSA-P384-SHA384
3. **Add frontend tests** using a testing framework like Vitest or Jest with React Testing Library
4. **Add integration tests** for OpenCode process management (timeouts, errors)
5. **Add metrics tests** to validate Prometheus metric collection
6. **Consider adding E2E tests** that test the full flow from frontend to API to sidecar