# Web OS - Architecture Design Document

## Executive Summary

**Web OS** is a Kubernetes-based platform where each user connects with their wallet (Arweave/RSA/ECDSA), spawns a personal OpenCode pod, and interacts via HTTPSig-signed JSON requests. Each pod runs a developer agent image with git, curl, brew, and standard development tools.

**Domain**: permaweb.live

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           permaweb.live                                   │
│                      (Kubernetes Cluster)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Ingress / DNS                                 │   │
│  │   *.permaweb.live → Pod subdomains                                 │   │
│  │   api.permaweb.live → Gateway (management API)                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                         Subdomain Routing                               │
│                                    │                                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │   Pod 1    │  │   Pod 2    │  │   Pod 3    │  │   Pod N    │        │
│  │            │  │            │  │            │  │            │        │
│  │ abc123.    │  │ xyz789.    │  │ def456.    │  │ pod-id.    │        │
│  │ permaweb.live│  │ permaweb.live│  │ permaweb.live│  │ permaweb.live│        │
│  │            │  │            │  │            │  │            │        │
│  │ ┌────────┐ │  │ ┌────────┐ │  │ ┌────────┐ │  │ ┌────────┐ │        │
│  │ │HTTPSig │ │  │ │HTTPSig │ │  │ │HTTPSig │ │  │ │HTTPSig │ │        │
│  │ │Verify  │ │  │ │Verify  │ │  │ │Verify  │ │  │ │Verify  │ │        │
│  │ └────────┘ │  │ └────────┘ │  │ └────────┘ │  │ └────────┘ │        │
│  │ ┌────────┐ │  │ ┌────────┐ │  │ ┌────────┐ │  │ ┌────────┐ │        │
│  │ │OpenCode│ │  │ │OpenCode│ │  │ │OpenCode│ │  │ │OpenCode│ │        │
│  │ │(Agent) │ │  │ │(Agent) │ │  │ │(Agent) │ │  │ │(Agent) │ │        │
│  │ └────────┘ │  │ └────────┘ │  │ └────────┘ │  │ └────────┘ │        │
│  │ ┌────────┐ │  │ ┌────────┐ │  │ ┌────────┐ │  │ ┌────────┐ │        │
│  │ │Dev Tools│ │  │ │Dev Tools│ │  │ │Dev Tools│ │  │ │Dev Tools│ │        │
│  │ │git,curl│ │  │ │git,curl│ │  │ │git,curl│ │  │ │git,curl│ │        │
│  │ │brew... │ │  │ │brew... │ │  │ │brew... │ │  │ │brew... │ │        │
│  │ └────────┘ │  │ └────────┘ │  │ └────────┘ │  │ └────────┘ │        │
│  │            │  │            │  │            │  │            │        │
│  │ Wallet: A  │  │ Wallet: B  │  │ Wallet: C  │  │ Wallet: N  │        │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘        │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Gateway Service                               │   │
│  │   - Wallet authentication (Arweave, RSA, ECDSA)                  │   │
│  │   - Pod lifecycle (create/delete/status) via api.permaweb.live     │   │
│  │   - Subdomain provisioning (pod-id.permaweb.live)                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Secret Store                                  │   │
│  │   - LLM API keys (per wallet, mounted securely)                  │   │
│  │   - Wallet → Pod subdomain mapping                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Persistent Storage                             │   │
│  │   - User workspaces (git repos, files)                           │   │
│  │   - Session data (OpenCode state)                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture Decision Records (ADRs)

### ADR-001: Wallet-Based Authentication

**Status**: Accepted

**Context**: Users need to securely access their personal OpenCode pods. We need an authentication mechanism that is decentralized and works with existing Web3 wallets.

**Decision**: Use Arweave wallets (and later RSA/ECDSA) with HTTPSig (RFC 9421) for authentication. The wallet address becomes the pod identifier.

**Consequences**:
- Users connect with their existing wallet
- Each wallet maps to exactly one pod
- All requests must be HTTPSig-signed
- No username/password system needed

---

### ADR-002: JSON In → JSONL Out API

**Status**: Accepted

**Context**: OpenCode processes tasks and returns responses. We need a simple, streamable API format.

**Decision**: 
- Input: Single JSON object with method and params
- Output: JSONL stream with typed events

**Consequences**:
- Simple to implement and debug
- Naturally supports streaming
- Works well with agent harness pattern
- Easy to add new event types

**Example**:

```json
// Request
{
  "id": "req_123",
  "method": "message",
  "params": {"content": "Create hello.ts"}
}

// Response (JSONL stream)
{"id":"req_123","type":"assistant_message","content":"Creating hello.ts..."}
{"id":"req_123","type":"tool_use","tool":"write","args":{"path":"hello.ts"}}
{"id":"req_123","type":"tool_result","result":"File created"}
{"id":"req_123","type":"done","status":"success"}
```

---

### ADR-003: Developer Agent Image

**Status**: Accepted

**Context**: Users need a complete development environment in their pod.

**Decision**: Base image includes:
- OpenCode (agent harness)
- git, curl, wget, common CLIs
- brew for additional package installation
- Node.js, Python, Rust, Go (pre-installed or installable)

**Consequences**:
- Larger image size (~629MB) but complete dev environment
- Users can install additional tools via brew
- No need for custom images per user
- Security: HTTPSig layer prevents unauthorized access

---

### ADR-004: Per-Pod HTTPSig Verification

**Status**: Accepted

**Context**: We need to secure each pod so only the owner wallet can interact with it.

**Decision**: Each pod runs an HTTPSig verification sidecar that:
- Validates incoming request signatures
- Extracts wallet address from signature
- Rejects requests not signed by owner wallet

**Consequences**:
- Security enforced at pod level
- Gateway can be simpler (just routing)
- Compromise of one pod doesn't affect others
- Clear audit trail per wallet

---

### ADR-005: Secret Mount Pattern

**Status**: Accepted

**Context**: LLM API keys need to be available to OpenCode but not exposed to users.

**Decision**: 
- LLM keys stored in K8s Secrets (per wallet)
- Mounted as files into pod at `/secrets/llm/`
- OpenCode reads from mounted files
- Never returned via API

**Consequences**:
- Keys never in environment variables
- Keys never in API responses
- Users can't exfiltrate keys
- OpenCode can use keys for LLM calls

---

### ADR-006: Per-Pod Subdomain

**Status**: Accepted

**Context**: Users need direct access to their pod's API without going through a central gateway for every request.

**Decision**: Each pod gets its own subdomain: `{pod-id}.permaweb.live`
- Pod ID is derived from wallet address (e.g., first 8 chars of address hash)
- DNS/Ingress routes subdomain to specific pod
- Gateway service only handles pod lifecycle (create/delete) at `api.permaweb.live`

**Consequences**:
- Direct pod access for lower latency
- Gateway doesn't need to proxy every request
- Each pod is independently addressable
- Simple SSL cert management with wildcard cert for `*.permaweb.live`
- Clear separation: management API vs pod API

**Example**:
- Wallet `ABC...XYZ` → Pod ID `abc123` → Subdomain `abc123.permaweb.live`
- User sends signed request directly to `abc123.permaweb.live`
- Pod's HTTPSig layer verifies the signature

---

## Component Architecture

### Gateway Service (`api/`)

```
api/
├── src/
│   ├── index.ts          # Express server with health endpoint
│   └── pods/
│       ├── types.ts       # Pod, PodStatus, CreatePodInput
│       └── store.ts       # In-memory PodStore with CRUD operations
├── package.json
├── tsconfig.json
└── Dockerfile
```

**Endpoints**:
- `POST /api/pods` - Create a new pod
- `GET /api/pods` - List all pods
- `GET /api/pods/:id` - Get pod status
- `DELETE /api/pods/:id` - Delete a pod
- `GET /health` - Health check

**Pod Response**:
```json
{
  "id": "abc123-def456-...",
  "name": "pod-abc123",
  "status": "running",
  "subdomain": "abc123.pods.local",
  "createdAt": "2026-03-07T19:00:00.000Z"
}
```

---

### Frontend (`frontend/`)

```
frontend/
├── src/
│   ├── App.tsx          # Pod list UI with create/delete
│   ├── api.ts           # API client for pod lifecycle
│   ├── main.tsx         # React entry point
│   └── styles.css       # Basic styling
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

**Features**:
- Pod list with auto-refresh
- Create Pod button
- Delete Pod button per pod
- Loading and error states
- Responsive grid layout

---

### OpenCode Sidecar (`opencode-sidecar/`)

```
opencode-sidecar/
├── src/
│   ├── index.ts          # HTTP server on port 3001
│   └── httpSig.ts        # Signature verification functions
├── package.json
├── tsconfig.json
└── Dockerfile
```

**Endpoints**:
- `GET /health` - Health check
- `POST /verify` - Verify HTTPSig signature

**HTTPSig Verification**:
```typescript
// Accepts valid RSA and ECDSA signatures
// Rejects invalid signatures
// Rejects signatures with unknown key IDs

export async function verifySignature(
  request: Request,
  publicKeyPem: string
): Promise<boolean>;
```

---

### Base OpenCode Image (`images/opencode-base/`)

```dockerfile
FROM ghcr.io/anomalyco/opencode

# Add dev tools
RUN apt-get update && apt-get install -y \
    git curl wget vim tmux \
    build-essential pkg-config libssl-dev

# Install brew
RUN /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Add non-root user
RUN addgroup -g 10001 -S app && \
    adduser -u 10001 -S appuser -G app

WORKDIR /home/opencode

USER 10001
EXPOSE 4096

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4096/health || exit 1

CMD ["opencode", "run"]
```

**Image Size**: ~629MB

---

## Kubernetes Resources

### Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: web-os
```

### Pod Template

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: user-pod
  namespace: web-os
  labels:
    app.kubernetes.io/name: web-os-user-pod
spec:
  containers:
    - name: opencode
      image: web-os-opencode:latest
      ports:
        - containerPort: 4096
      securityContext:
        runAsUser: 1000
        runAsGroup: 1000
        
    - name: httpsig-sidecar
      image: web-os-opencode-sidecar:latest
      ports:
        - containerPort: 3001
      securityContext:
        runAsUser: 1000
        runAsGroup: 1000
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: user-pod
  namespace: web-os
spec:
  selector:
    app.kubernetes.io/name: web-os-user-pod
  ports:
    - name: opencode-http
      port: 4096
    - name: httpsig-http
      port: 3001
```

### Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: user-pod
  namespace: web-os
spec:
  ingressClassName: nginx
  rules:
    - host: "*.pods.local"
      http:
        paths:
          - path: /health
            backend:
              service:
                name: user-pod
                port:
                  name: httpsig-http
          - path: /
            backend:
              service:
                name: user-pod
                port:
                  name: opencode-http
```

---

## Request Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         REQUEST FLOW                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User authenticates at api.permaweb.live                             │
│     └── Wallet signature → Gateway creates pod                         │
│     └── Pod ID: abc123 → Subdomain: abc123.permaweb.live                │
│                                                                         │
│  2. User sends signed JSON to abc123.permaweb.live                      │
│     └── Request: { "id": "req_1", "method": "message", ... }          │
│     └── Headers: Signature: keyId="owner", ...                         │
│                                                                         │
│  3. Ingress routes to pod's HTTPSig sidecar                           │
│     └── *.permaweb.live → user-pod service                               │
│                                                                         │
│  4. HTTPSig sidecar verifies signature                                 │
│     └── Extract keyId from signature                                   │
│     └── Compare with owner wallet address                              │
│     └── If valid → forward to OpenCode                                 │
│     └── If invalid → 401 Unauthorized                                  │
│                                                                         │
│  5. OpenCode processes request                                          │
│     └── Reads from /secrets/llm/ for LLM calls                        │
│     └── Executes in /home/opencode workspace                           │
│     └── Returns JSONL stream                                           │
│                                                                         │
│  6. Response streams back to user                                      │
│     └── {"type":"assistant_message", ...}                              │
│     └── {"type":"tool_use", ...}                                       │
│     └── {"type":"done"}                                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Security Model

### Request Signing

```typescript
// User signs request with wallet
const request = {
  id: "req_123",
  method: "message",
  params: { content: "Create hello.ts" }
};

const signature = await wallet.sign(JSON.stringify(request));

// Request includes signature headers
// Signature: keyId="owner", headers="(request-target)", signature="base64..."
```

### Pod Isolation

- Each pod runs in its own Kubernetes namespace
- Non-root user (UID 1000)
- Resource limits (CPU/memory quotas)
- No privileged containers
- Network policies restrict pod-to-pod communication

### Secret Management

- LLM API keys stored in K8s Secrets (per wallet)
- Mounted as files into `/secrets/llm/`
- Read-only mount
- Never exposed via API

---

## Current Status (March 2026)

### Completed

| Phase | Step | Status | Commit |
|-------|------|--------|--------|
| P0-S1 | Local Cluster Bootstrap | ✅ | 29e6e71 |
| P0-S2 | Service Skeletons | ✅ | b6e223e |
| P0-S3 | Base OpenCode Image | ✅ | d3a2670 |
| P0-S4 | HTTPSig Library | ✅ | e3c6c67 |
| P0-S5 | CI + ADRs | ✅ | 9591469 |
| P1-S1 | Pod Manifest + K8s | ✅ | 7502f85 |
| P1-S2 | Pod Lifecycle API | ✅ | 688e13f |
| P1-S3 | Basic Frontend | ✅ | adc0f16 |
| P1-S4 | Wildcard Ingress | ✅ | 3f9c760 |

### In Progress

| Phase | Step | Status |
|-------|------|--------|
| P1-S5 | Ingress Subdomain Routing | ⏳ |

### Upcoming

| Phase | Duration |
|-------|----------|
| Phase 2: Authentication | 7-9 days |
| Phase 3: LLM Integration | 5-7 days |
| Phase 4: GitHub Integration | 8-10 days |
| Phase 5: Production | 8-12 days |

---

## Roadmap

### Phase 2: Authentication (7-9 days)
- Wallet authentication (Arweave, RSA, ECDSA)
- HTTPSig request signing
- Session management
- Per-pod identity

### Phase 3: LLM Integration (5-7 days)
- Secret storage for API keys
- Key injection into pods
- Model selection

### Phase 4: GitHub Integration (8-10 days)
- OAuth flow
- Repository browser
- Clone/edit/push workflow

### Phase 5: Production (8-12 days)
- DNS (permaweb.live)
- TLS certificates
- Monitoring/logging
- Rate limiting

---

## File Structure

```
web-os/
├── api/                        # Gateway API service
│   ├── src/
│   │   ├── index.ts            # Express server
│   │   └── pods/
│   │       ├── types.ts        # Pod types
│   │       └── store.ts        # In-memory store
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── frontend/                   # Vite frontend
│   ├── src/
│   │   ├── App.tsx             # Pod list UI
│   │   ├── api.ts              # API client
│   │   ├── main.tsx            # Entry point
│   │   └── styles.css          # Styles
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── opencode-sidecar/           # HTTPSig verification
│   ├── src/
│   │   ├── index.ts            # HTTP server
│   │   └── httpSig.ts         # Verification
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── images/
│   └── opencode-base/         # Developer agent image
│       ├── Dockerfile
│       └── entrypoint.sh
│
├── k8s/                        # Kubernetes manifests
│   ├── namespace.yaml
│   ├── pod-template.yaml
│   ├── pod-service.yaml
│   └── pod-ingress.template.yaml
│
├── scripts/
│   ├── setup.sh
│   ├── teardown.sh
│   ├── bootstrap-kind.sh
│   └── health-check.sh
│
├── docs/
│   ├── adr.md                  # Architecture Decision Records
│   ├── adr-http-sig.md         # HTTPSig library selection
│   ├── adr-sidecar-pattern.md  # Sidecar pattern
│   └── adr-key-storage.md     # Key storage pattern
│
├── .github/workflows/
│   └── ci.yml                  # CI workflow
│
├── PLAN.md                    # Architecture overview
├── ROADMAP.md                 # Detailed step-by-step
└── README.md                  # Quick start
```

---

## References

- [HTTPSig RFC 9421](https://datatracker.ietf.org/doc/html/rfc9421)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Kind - Kubernetes in Docker](https://kind.sigs.k8s.io/)

---

## License

MIT

---

**Last Updated**: 2026-03-07
**Authors**: OpenClaw Team
**Version**: 1.0.0