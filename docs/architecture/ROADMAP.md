# Web OS Incremental Roadmap

This roadmap expands `PLAN.md` into execution-ready steps with explicit dependencies and verification criteria.

## Phase Overview

| Phase | Goal | Estimated Duration |
|---|---|---|
| Phase 0: Foundation | Local platform baseline, developer agent image, HTTPSig direction, JSONL contract | 7-9 days |
| Phase 1: Core Pod Infrastructure | Pod runtime primitives, subdomain routing, and first usable UI | 11-14 days |
| Phase 2: Authentication | Pod identity, request signing, replay protection | 7-9 days |
| Phase 3: LLM Integration | Secure key management and model routing | 5-7 days |
| Phase 4: GitHub Integration | OAuth and end-to-end repository workflow | 8-10 days |
| Phase 5: Production | Internet-facing hardening and operational readiness | 8-12 days |

## Architecture Anchors (Accepted ADRs)

- **ADR-001 Wallet-Based Authentication**: wallet is identity and each wallet maps to exactly one pod.
- **ADR-002 JSON In -> JSONL Out API**: signed JSON request in, typed JSONL event stream out.
- **ADR-003 Developer Agent Image**: pod image includes OpenCode plus standard developer tools/languages.
- **ADR-004 Per-Pod HTTPSig Verification**: each pod enforces owner-only HTTPSig verification.
- **ADR-005 Secret Mount Pattern**: LLM keys are mounted as files at `/secrets/llm/`, never returned by API.
- **ADR-006 Per-Pod Subdomain Routing**: each pod is directly addressable at `{pod-id}.permaweb.live`; gateway handles lifecycle only.

## Phase 0 - Foundation

### P0-S1: Local Cluster Bootstrap (minikube/kind)
- **Description**: Implement a repeatable local Kubernetes setup that supports both `minikube` and `kind`, including namespace bootstrap and health validation scripts.
- **Dependencies**: None.
- **Success Criteria**: Running one command provisions a cluster, `web-os` namespace exists, ingress controller is ready, and teardown works.
- **Estimated Effort**: 1-2 days.

### P0-S2: Repository and Service Skeletons
- **Description**: Create baseline folder scaffolding from `PLAN.md` (`api/`, `frontend/`, `opencode-sidecar/`, `k8s/`, `scripts/`) with minimal buildable stubs.
- **Dependencies**: P0-S1.
- **Success Criteria**: All core services build locally and have placeholder health endpoints/pages.
- **Estimated Effort**: 0.5-1 day.

### P0-S3: Base OpenCode Runtime Image
- **Description**: Build and version a developer-agent Docker image wrapping `ghcr.io/anomalyco/opencode` with `git`, `curl`, `wget`, `brew`, and Node.js/Python/Rust/Go support, non-root execution, and startup contract.
- **Dependencies**: P0-S2.
- **Success Criteria**: Image builds in CI, runs locally, starts OpenCode with expected ports/entrypoint, and includes documented baseline dev tooling.
- **Estimated Effort**: 1-1.5 days.

### P0-S4: HTTPSig Library Selection and Per-Pod Spike
- **Description**: Evaluate HTTPSig implementations (RFC 9421 support, RSA/ECDSA support, maintenance status), pick one, and integrate a verification spike in a per-pod verification layer.
- **Dependencies**: P0-S2.
- **Success Criteria**: ADR recorded, passing tests verify owner-wallet signature validation plus rejection for unsigned/wrong-wallet requests.
- **Estimated Effort**: 1-2 days.

### P0-S5: JSON In -> JSONL Streaming Contract
- **Description**: Define and implement the initial transport contract: HTTPSig-signed JSON request envelope in, typed JSONL event stream out (`assistant_message`, `tool_use`, `tool_result`, `done`, and structured `error`).
- **Dependencies**: P0-S2, P0-S4.
- **Success Criteria**: Contract doc merged, conformance tests pass, and a local end-to-end demo streams multi-event JSONL output for one request ID.
- **Estimated Effort**: 1-1.5 days.

### P0-S6: Foundation CI + ADR Alignment
- **Description**: Add lint/test/build CI baseline and ensure ADR-001..ADR-006 are reflected in acceptance checks and docs.
- **Dependencies**: P0-S3, P0-S4, P0-S5.
- **Success Criteria**: CI pipeline runs on pull requests, ADR docs are merged, and architecture checklist validates wallet identity, HTTPSig-only access, JSONL streaming, and secret-mount constraints.
- **Estimated Effort**: 1-1.5 days.

## Phase 1 - Core Pod Infrastructure

### P1-S1: Pod Template Contract
- **Description**: Define pod template YAML with OpenCode container, sidecar hook, probes, resource limits, and workspace volume mounts.
- **Dependencies**: P0-S3, P0-S6.
- **Success Criteria**: Template validates and deploys one pod successfully in local cluster.
- **Estimated Effort**: 1 day.

### P1-S2: Pod Orchestrator Service Skeleton
- **Description**: Implement API service structure for pod orchestration with Kubernetes client wiring, config loading, and error handling conventions.
- **Dependencies**: P1-S1.
- **Success Criteria**: Service starts and can query cluster state using in-cluster/out-of-cluster config.
- **Estimated Effort**: 1-1.5 days.

### P1-S3: Pod Lifecycle API (create/delete/status)
- **Description**: Build endpoints for pod create, delete, list, and status; include ownership labels, idempotency handling, and deterministic subdomain assignment (`{pod-id}.permaweb.live`) derived from wallet-hash pod identity.
- **Dependencies**: P1-S2.
- **Success Criteria**: API tests and manual checks show pods can be created, inspected, and removed reliably, and each pod response includes its assigned subdomain.
- **Estimated Effort**: 2-3 days.

### P1-S4: Wildcard DNS Configuration
- **Description**: Configure wildcard DNS for pod addressing (`*.permaweb.live`) plus explicit gateway host (`api.permaweb.live`) for management API.
- **Dependencies**: P1-S3.
- **Success Criteria**: DNS records resolve correctly for both wildcard pod hosts and `api.permaweb.live` in target environment(s).
- **Estimated Effort**: 0.5-1 day.

### P1-S5: Ingress Subdomain Routing
- **Description**: Implement ingress host-based routing rules (Traefik/NGINX) to route `{pod-id}.permaweb.live` directly to pod services while routing `api.permaweb.live` to gateway.
- **Dependencies**: P1-S3, P1-S4.
- **Success Criteria**: Signed requests sent to pod subdomains reach the correct pod without gateway proxying; management calls remain on `api.permaweb.live`.
- **Estimated Effort**: 1-1.5 days.

### P1-S6: Basic Frontend Pod Console
- **Description**: Create frontend screen to list pods, create pod, delete pod, show assigned pod subdomain, and open status details with polling.
- **Dependencies**: P1-S3, P1-S5.
- **Success Criteria**: User can complete create/delete flow from browser and can see/copy the assigned pod subdomain.
- **Estimated Effort**: 2-3 days.

### P1-S7: Pod Infra E2E and Reliability Guardrails
- **Description**: Add integration tests, retry/backoff policies, and cleanup jobs for orphaned pods.
- **Dependencies**: P1-S3, P1-S5, P1-S6.
- **Success Criteria**: E2E suite covers lifecycle, subdomain assignment/routing, and cleanup runs without manual intervention.
- **Estimated Effort**: 1.5-2 days.

## Phase 2 - Authentication

### P2-S1: HTTPSig Verification Middleware
- **Description**: Implement request verification path in gateway or sidecar using selected library and canonicalization strategy.
- **Dependencies**: P0-S4, P1-S3.
- **Success Criteria**: Unsigned and invalidly signed requests are rejected; valid signed requests succeed.
- **Estimated Effort**: 2 days.

### P2-S2: Wallet Registration API
- **Description**: Add endpoint to register one Arweave/RSA/ECDSA public key per pod identity with schema validation and rotation policy.
- **Dependencies**: P2-S1.
- **Success Criteria**: API enforces one active wallet per pod and persists metadata for verification lookups.
- **Estimated Effort**: 1.5-2 days.

### P2-S3: Request Freshness and Replay Protection
- **Description**: Implement nonce/timestamp verification, skew windows, and replay cache bound to wallet identity for every signed request.
- **Dependencies**: P2-S2.
- **Success Criteria**: Replayed and stale requests are denied, valid fresh signed requests are accepted, and failure reasons are explicit.
- **Estimated Effort**: 1.5-2 days.

### P2-S4: Frontend Wallet Signing Flow
- **Description**: Add wallet connect/sign UX and request-signing pipeline with clear error states for signature and freshness failures.
- **Dependencies**: P2-S3, P1-S6.
- **Success Criteria**: User can register wallet, sign requests, and successfully execute pod operations without session-token fallback.
- **Estimated Effort**: 1-2 days.

### P2-S5: Auth Hardening Tests
- **Description**: Add replay protection tests, skew/clock handling tests, and rate-limited failure paths for HTTPSig-only auth.
- **Dependencies**: P2-S1, P2-S3.
- **Success Criteria**: Security regression suite passes and key abuse scenarios are covered.
- **Estimated Effort**: 1 day.

## Phase 3 - LLM Integration

### P3-S1: Secret Storage API
- **Description**: Build backend API to store encrypted per-wallet LLM keys and map them to wallet-owned pods.
- **Dependencies**: P2-S2.
- **Success Criteria**: Keys are write/readable only by authorized owner context and never returned in plaintext responses.
- **Estimated Effort**: 1-1.5 days.

### P3-S2: Pod Key Injection Mechanism
- **Description**: Mount or project secrets into pods securely at runtime at `/secrets/llm/` with rotation-safe update path.
- **Dependencies**: P3-S1, P1-S1.
- **Success Criteria**: Pod can access required key material from `/secrets/llm/`, while keys are not exposed in logs, UI, or API responses.
- **Estimated Effort**: 1-1.5 days.

### P3-S3: Model Registry and Selection API
- **Description**: Define supported model catalog and API to select model/provider per pod session.
- **Dependencies**: P3-S1.
- **Success Criteria**: Selected model is persisted and visible in runtime configuration for pod requests.
- **Estimated Effort**: 1 day.

### P3-S4: Frontend Model and Key Management
- **Description**: Add UI for key entry/update, provider selection, and model switching with validation states.
- **Dependencies**: P3-S3, P1-S6.
- **Success Criteria**: User can configure keys and model from UI and see settings applied in pod behavior.
- **Estimated Effort**: 1-2 days.

### P3-S5: LLM Integration Validation
- **Description**: Add integration tests for missing keys, invalid keys, and provider fallback behavior.
- **Dependencies**: P3-S2, P3-S3.
- **Success Criteria**: Test matrix covers successful and failure paths for at least two model providers.
- **Estimated Effort**: 1 day.

## Phase 4 - GitHub Integration

### P4-S1: GitHub OAuth Foundation
- **Description**: Configure GitHub OAuth app, callback handling, CSRF protection, and token persistence.
- **Dependencies**: P2-S3.
- **Success Criteria**: User can connect GitHub account and token is stored securely.
- **Estimated Effort**: 1.5-2 days.

### P4-S2: Repository Browser API + UI
- **Description**: Implement repo listing endpoints and frontend browser with org/repo selection and pagination.
- **Dependencies**: P4-S1.
- **Success Criteria**: Connected users can browse accessible repositories from UI.
- **Estimated Effort**: 1.5-2 days.

### P4-S3: Clone Workflow to Pod Workspace
- **Description**: Add backend workflow to clone selected repo into pod workspace with proper ownership and cleanup.
- **Dependencies**: P4-S2, P1-S3.
- **Success Criteria**: Selecting a repo clones it into pod and files are visible/editable from OpenCode session.
- **Estimated Effort**: 2 days.

### P4-S4: Commit and Push Workflow
- **Description**: Implement commit/push API bridge with branch checks, auth errors, and conflict reporting.
- **Dependencies**: P4-S3.
- **Success Criteria**: User can commit and push branch changes from pod with clear status feedback.
- **Estimated Effort**: 1.5-2 days.

### P4-S5: PR and Audit Trail Enhancements
- **Description**: Add pull request initiation support and an audit log of clone/push actions.
- **Dependencies**: P4-S4.
- **Success Criteria**: User can open PR link from workflow and admins can inspect action history.
- **Estimated Effort**: 1-2 days.

## Phase 5 - Production

### P5-S1: Environment Promotion and IaC
- **Description**: Define staging/production environments with infrastructure as code and deployment pipelines.
- **Dependencies**: P1-S7, P2-S5, P3-S5, P4-S5.
- **Success Criteria**: One-command or pipeline-based promotion from staging to production is documented and reproducible.
- **Estimated Effort**: 2 days.

### P5-S2: DNS and Ingress for permaweb.live
- **Description**: Configure DNS records, ingress rules, and host routing for API/frontend domains.
- **Dependencies**: P5-S1.
- **Success Criteria**: `permaweb.live` resolves to production ingress and routes traffic correctly.
- **Estimated Effort**: 1 day.

### P5-S3: TLS Automation
- **Description**: Integrate certificate issuance/renewal (e.g., cert-manager + ACME) and enforce HTTPS-only traffic.
- **Dependencies**: P5-S2.
- **Success Criteria**: Valid certificates are auto-issued and renewed; HTTP redirects to HTTPS.
- **Estimated Effort**: 1 day.

### P5-S4: Monitoring and Centralized Logging
- **Description**: Add metrics, dashboards, alerts, and log aggregation for API, pods, and cluster health.
- **Dependencies**: P5-S1.
- **Success Criteria**: Operational dashboards exist and critical alerts fire in controlled failure drills.
- **Estimated Effort**: 2-3 days.

### P5-S5: Rate Limiting, Quotas, and Final Readiness Review
- **Description**: Enforce per-user and per-pod limits, abuse protections, and run a production readiness checklist.
- **Dependencies**: P5-S3, P5-S4.
- **Success Criteria**: Load test confirms limits work, and launch checklist is signed off.
- **Estimated Effort**: 2-3 days.

## Dependency Graph (High-Level)

- Foundation chain: `P0-S1 -> P0-S2 -> (P0-S3 + P0-S4) -> P0-S5 -> P0-S6`
- Pod infrastructure: `P0-S3/P0-S6 -> P1-S1 -> P1-S2 -> P1-S3 -> P1-S4 -> P1-S5 -> P1-S6 -> P1-S7`
- Auth: `P0-S4 + P1-S3 -> P2-S1 -> P2-S2 -> P2-S3 -> P2-S4`, with hardening at `P2-S5`
- LLM: `P2-S2 -> P3-S1 -> (P3-S2 + P3-S3) -> P3-S4 -> P3-S5`
- GitHub: `P2-S3 -> P4-S1 -> P4-S2 -> P4-S3 -> P4-S4 -> P4-S5`
- Production: `P1-S7 + P2-S5 + P3-S5 + P4-S5 -> P5-S1 -> P5-S2 -> P5-S3`, plus ops hardening at `P5-S4/P5-S5`

## Total Time Estimate

- **Execution time (single focused engineer)**: ~45-61 working days (9-12 weeks).
- **With parallelization across 2-3 engineers**: ~25-36 working days (5-7.5 weeks), assuming clear ownership boundaries by phase.

## Current Execution State

- **Started**: Phase 0 Step 1 (`P0-S1`) - local cluster bootstrap improvements are now in progress.
