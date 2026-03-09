# Permaweb OS Security Audit

Date: 2026-03-09  
Repository: `https://github.com/twilson63/permaweb-os`  
Method: autoresearch-style static review + local test execution + targeted exploit validation

## Scope

- API auth/session/GitHub OAuth: `api/src/index.ts`, `api/src/auth/*`
- HTTPSig sidecar verification and request handling: `opencode-sidecar/src/index.ts`, `opencode-sidecar/src/httpSig.ts`
- Pod isolation and secret mounting: `k8s/pod-template.yaml`, `k8s/api-deployment.yaml`
- Frontend auth/token handling: `frontend/src/*`

## Executive Summary

- The most significant risk is **command integrity and replay weakness** in the sidecar: signatures do not bind request body content and stale signatures are accepted.
- The second major risk is **secret exposure architecture**: all pod users can read mounted global LLM keys from `/secrets/llm` if they can execute file reads in their pod runtime.
- Kubernetes hardening is partially implemented (non-root, dropped capabilities, seccomp), but important controls are missing (read-only rootfs, NetworkPolicy, per-pod key identity).

## Findings

| Severity | Finding | Impact |
|---|---|---|
| Critical | Request body is not signed in `/verify` flow | Signed request can be replayed with tampered `content` payload |
| Critical | Global LLM keys mounted into user-executable pods | Key exfiltration/abuse risk across tenants |
| High | No signature freshness/replay window validation | Captured signed requests remain valid indefinitely |
| High | Static sidecar owner identity/key in pod template | Breaks per-user pod identity isolation model |
| Medium | No API/nonce/verify rate limiting | Brute-force and memory DoS amplification |
| Medium | Error message leakage from sidecar upstream failures | Internal stderr may leak runtime details |
| Medium | In-memory auth/session/challenge stores are unbounded | Memory pressure and eviction-free DoS risk |
| Low | Session token stored in `localStorage` | Token theft possible if XSS occurs |
| Low | No key rotation/audit logging flow for LLM/API secrets | Operational security gap |

---

### 1) Critical - Unsigned Request Body in HTTPSig Verification

**Evidence**

- Sidecar validates signatures before parsing request body, and signature components are only `@method`, `@path`, `host`, `date`: `opencode-sidecar/src/index.ts:166`, `opencode-sidecar/src/index.ts:188`, `frontend/src/api.ts:166`
- No `content-digest` verification path and body is not included in signed components.

**Why this matters**

- Any intermediary with request modification capability can alter JSON body content while preserving valid signature headers.
- This can change agent prompt/commands without invalidating auth.

**PoC (validated)**

Reuse same signed headers with two different bodies; both accepted (status 200):

```bash
OPENCODE_BIN="/usr/bin/true" node -e '/* reproduced locally */'
# output:
# { "firstStatus": 200, "secondStatus": 200 }
```

**Remediation**

- Require `Content-Digest` + include it in signature components.
- Optionally include `@query`/`@authority` for stronger request target binding.

**Fix sketch**

```ts
// Require and validate Content-Digest, then verify signature over it.
components: ["@method", "@path", "host", "date", "content-digest"]
```

---

### 2) Critical - Mounted Global LLM Secrets Are Readable by Pod User

**Evidence**

- Shared secret object contains provider keys: `k8s/llm-api-keys.secret.yaml:10`
- Mounted into pod filesystem as readable files: `k8s/pod-template.yaml:33`, `k8s/pod-template.yaml:35`
- Mounted read-only protects writes, not reads.

**Why this matters**

- Any actor with command/file access inside pod runtime can read `/secrets/llm/*` and exfiltrate provider keys.
- This is especially severe if keys are platform-wide and not per-user scoped.

**PoC**

Inside a running pod shell/tool execution:

```bash
ls /secrets/llm
cat /secrets/llm/openai
```

**Remediation**

- Use short-lived, per-user scoped broker tokens instead of static provider keys.
- If file mounting is required, mount only one pod-specific key with strict tenancy boundaries.
- Add egress controls + audit logging for key use.

---

### 3) High - No Signature Freshness / Replay Window

**Evidence**

- `date` header is signed but never checked against allowed skew or expiry: `opencode-sidecar/src/index.ts:166`, `opencode-sidecar/src/httpSig.ts:152`
- No nonce/jti store for one-time request IDs.

**PoC (validated)**

Signature dated ~24h in past still accepted:

```bash
OPENCODE_BIN="/usr/bin/true" node -e '/* reproduced locally */'
# output:
# { "status": 200 }
```

**Remediation**

- Enforce max clock skew (for example +/- 5 minutes).
- Add replay cache keyed by `(keyId, signature-input digest)` with short TTL.

---

### 4) High - Static Owner Key Identity in Pod Template

**Evidence**

- `OWNER_KEY_ID` hardcoded to `owner`: `k8s/pod-template.yaml:70`
- `OWNER_PUBLIC_KEY_PEM` embedded static value: `k8s/pod-template.yaml:72`

**Why this matters**

- Conflicts with per-wallet ownership model; encourages shared signer identity across pods.
- If corresponding private key leaks, all pods using this template are exposed.

**Remediation**

- Generate and inject per-pod owner key material at pod creation.
- Bind key id to authenticated wallet identity in control plane metadata.

---

### 5) Medium - Missing Rate Limiting and Abuse Controls

**Evidence**

- No limiter middleware in API path (`api/src/index.ts` has none).
- No throttling for expensive auth and sidecar verify endpoints.

**Impact**

- `/api/auth/nonce`, `/api/auth/verify`, `/verify` can be hammered for CPU/memory DoS.

**Remediation**

- Add token/IP-based rate limiting and burst controls at API and ingress.
- Add per-wallet quotas.

---

### 6) Medium - Sidecar Error Message Leakage

**Evidence**

- Sidecar returns upstream error message directly to client: `opencode-sidecar/src/index.ts:222`

**Impact**

- OpenCode stderr/internal details may leak (paths, runtime state, diagnostics).

**Remediation**

- Return opaque error IDs externally; log detailed failure server-side only.

---

### 7) Medium - Unbounded In-Memory Security State

**Evidence**

- Challenge/session maps are in memory without max-size/eviction: `api/src/auth/store.ts:51`, `api/src/auth/store.ts:52`
- OAuth state map also in-memory and only cleaned on callback: `api/src/index.ts:60`, `api/src/index.ts:175`

**Impact**

- Memory growth under abuse or callback drop-off.

**Remediation**

- Add bounded cache (LRU + TTL), periodic sweeper, and external session store for production.

---

### 8) Low - Session Token in Local Storage

**Evidence**

- Token persisted in browser localStorage: `frontend/src/auth/store.ts:37`

**Impact**

- XSS => token theft.

**Remediation**

- Move to secure, HTTP-only, same-site cookies for browser sessions.

---

### 9) Low - LLM Key Rotation / Audit Logging Not Implemented

**Evidence**

- Secret store only reads files, no rotation or access audit path: `api/src/llm/secretStore.ts:28`

**Remediation**

- Integrate with secrets manager rotation cadence and centralized access logs.

## RFC 9421 Compliance Notes (HTTPSig)

- Positive: library-based verification (`http-message-sig`) and strict algorithm allow-list: `opencode-sidecar/src/httpSig.ts:50`
- Gaps:
  - Missing freshness policy (`created`/`expires` or date skew enforcement)
  - Missing signed body integrity (`content-digest` not enforced)
  - Replay prevention cache absent

## Priority Remediation Plan

1. **Immediate (0-2 days)**: enforce content digest + signed body + replay window checks.
2. **Short-term (2-7 days)**: per-pod/per-user key identity injection, remove static owner key from template.
3. **Short-term (2-7 days)**: implement API + ingress rate limiting.
4. **Medium-term (1-2 sprints)**: move security state to bounded external store + add audit logs + key rotation workflow.
