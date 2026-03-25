# Permaweb OS Performance Analysis

Date: 2026-03-09  
Repository: `https://github.com/twilson63/permaweb-os`  
Method: local baseline tests + targeted micro-benchmarks + code-path profiling by inspection

## Baseline Results

### Test/Build Baseline

- API tests: 22/22 pass, total ~1301 ms (`api` test run)
- Sidecar tests: 11/11 pass, total ~4468 ms (`opencode-sidecar` test run)
- Frontend build: success in ~604 ms; main JS bundle `201.50 kB` (`63.08 kB` gzip)

### Micro-benchmarks (local)

| Area | Benchmark | Result |
|---|---|---|
| API | `GET /health` (n=200) | avg `0.448 ms`, p95 `0.531 ms` |
| API | `GET /api/pods` with auth (n=200) | avg `0.185 ms`, p95 `0.347 ms` |
| Sidecar | `verifyHttpMessageSignature` only (n=1000) | avg `1.01 ms` per verify |
| Sidecar | `POST /verify` + process spawn (`/usr/bin/true`) (n=80) | avg `3.57 ms`, p95 `3.95 ms`, p99 `42.44 ms` |
| Usage store | `UsageStore.create` full rewrite growth | avg/op rose `0.08 ms` (0-100) -> `0.49 ms` (1000-2000) |
| Integration | sidecar + real OpenCode path | ~`4207 ms` test case duration |

Note: These are single-node local figures; production latency includes network, ingress, TLS, and model runtime.

## Bottlenecks and Findings

## 1) Sidecar request path buffers and spawns per request (High)

**Evidence**

- `runOpenCode` spawns a new process for every `/verify` call: `opencode-sidecar/src/index.ts:108`
- Response is fully buffered before returning (`stdout += ...`, then `res.end(output)`): `opencode-sidecar/src/index.ts:115`, `opencode-sidecar/src/index.ts:219`

**Impact**

- Adds process creation overhead every request.
- Prevents true token streaming and increases time-to-first-byte under long outputs.
- Increases memory pressure for large outputs.

**Recommendation**

- Keep a warm OpenCode process/session pool per pod.
- Stream child stdout directly to HTTP response (chunked NDJSON passthrough).

---

## 2) Usage persistence is O(n) per write (High)

**Evidence**

- Entire record array rewritten synchronously on each create: `api/src/usage/store.ts:169`
- Data is held in memory and full JSON is emitted each write.

**Measured growth**

- Avg create latency increased from ~0.08 ms (early) to ~0.49 ms (records 1000-2000) in local runs.

**Impact**

- Throughput drops as usage history grows.
- Event loop blocking from sync I/O.

**Recommendation**

- Move to append-only storage (JSONL) or SQLite/Postgres.
- Use async batched writes and periodic compaction.

---

## 3) In-memory stores limit horizontal scaling (Medium)

**Evidence**

- Pod/session/challenge state kept in memory maps: `api/src/pods/store.ts:8`, `api/src/auth/store.ts:51`

**Impact**

- Multi-replica API causes state inconsistency without sticky sessions/shared store.
- Restart clears active sessions/pods metadata.

**Recommendation**

- Externalize to Redis/Postgres.
- Keep API stateless to support HPA safely.

---

## 4) Kubernetes startup and autoscaling readiness gaps (Medium)

**Evidence**

- API replicas are `1`: `k8s/api-deployment.yaml:10`
- No HPA manifests in active `k8s/` set.
- OpenCode base image includes Homebrew/toolchain bootstrap (heavy image): `images/opencode-base/Dockerfile:22`

**Impact**

- Slow cold starts and limited burst handling.
- Single replica creates reliability/performance bottleneck.

**Recommendation**

- Set API min replicas >=2.
- Add HPA on CPU + request rate + queue depth.
- Pre-build slimmer runtime image variants for faster startup.

---

## 5) Frontend is currently single main chunk (Low/Medium)

**Evidence**

- Build output: one main JS chunk at `201.50 kB` (63.08 kB gzip).

**Impact**

- Acceptable now, but growth risk as GitHub and richer features ship.

**Recommendation**

- Add route-based code splitting before Phase 4 feature expansion.
- Defer heavy wallet/GitHub integrations with dynamic imports.

---

## 6) API security controls also affect performance under abuse (Medium)

**Evidence**

- No rate limiting middleware in API path (`api/src/index.ts`).

**Impact**

- Burst traffic can saturate auth/verify endpoints and degrade latency for valid users.

**Recommendation**

- Add ingress + app-level rate limits and backpressure controls.

## Optimization Recommendations

1. **Sidecar hot path**
   - Stream NDJSON directly from child process.
   - Reuse long-lived OpenCode worker(s) to remove per-request spawn overhead.
2. **Data layer**
   - Replace sync JSON file store with SQLite/Postgres.
   - Add indexed usage queries by wallet + date.
3. **Scaling architecture**
   - Stateless API with Redis-backed sessions/challenges.
   - HPA with min=2, max tuned by p95 latency SLO.
4. **Kubernetes tuning**
   - Right-size requests/limits from observed CPU/memory histograms.
   - Add pod disruption budgets and startup probes for heavy pods.
5. **Frontend**
   - Introduce lazy-loaded routes and cache headers for static assets.

## Capacity Planning Guidelines

- **API throughput model**
  - Baseline local authz/read path is sub-ms; production bottleneck is external dependencies and ingress.
  - Plan on p95 SLO target (e.g., 150 ms) and scale on concurrency, not just CPU.
- **Sidecar sizing**
  - If each real OpenCode request can consume seconds, concurrency should be controlled by queue depth.
  - Prefer fixed worker pool per pod to avoid fork storms.
- **Storage growth**
  - Current `UsageStore` rewrite model degrades superlinearly with record growth; migrate before >10k records/wallet.
- **Autoscaling trigger suggestions**
  - API: CPU >70% OR p95 latency >150 ms for 3-5 min.
  - Sidecar: queue length >N per pod OR in-flight verifies > worker pool size.

## Suggested Implementation Snippets

```ts
// Sidecar: stream process output directly
proc.stdout.pipe(res);
```

```ts
// API: async append instead of full rewrite each request
await appendFile(usageLogPath, JSON.stringify(record) + "\n");
```

```yaml
# HPA starter profile
minReplicas: 2
maxReplicas: 10
targetCPUUtilizationPercentage: 70
```
