# Web OS - Kubernetes Cluster for OpenCode Pods

## Overview

**permaweb.live** - A platform where users connect with their wallet (Arweave or other), launch a personal OpenCode pod, and interact via signed JSON messages. Each pod is a developer environment with OpenCode as the agent harness.

## Core Concept

```
User Wallet → Gateway → Pod (OpenCode + Dev Tools) → Response Stream
     │           │                    │                    │
     │           │                    │                    │
   Signs      Verifies          Executes            JSONL Stream
  Message    Signature          Tasks               Output
```

**Key insight**: The pod image is a "developer's agent image" - OpenCode + git + curl + brew + standard dev tools. The **only** way to interact with the pod is through HTTPSig-signed JSON requests.

## Architecture

Each pod gets its own subdomain: `{pod-id}.permaweb.live`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           permaweb.live                                   │
│                      (Kubernetes Cluster)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Ingress / DNS                                 │   │
│  │   *.permaweb.live → pod subdomains                                 │   │
│  │   abc123.permaweb.live → Pod abc123                                 │   │
│  │   xyz789.permaweb.live → Pod xyz789                                 │   │
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
│  │                    Gateway Service (Management API)              │   │
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

### Subdomain Flow

```
1. User authenticates at api.permaweb.live with wallet signature
2. Gateway creates pod, assigns subdomain: abc123.permaweb.live
3. DNS/Ingress routes abc123.permaweb.live → Pod abc123
4. User sends signed JSON to abc123.permaweb.live
5. Pod's HTTPSig layer verifies signature from owner wallet
6. OpenCode processes, streams JSONL response
```

## API Contract (JSON In → JSONL Out)

### Request Format
```json
{
  "id": "req_123",
  "method": "message",
  "params": {
    "content": "Create a new file called hello.ts with a simple hello world function"
  },
  "timestamp": 1772887000000
}
```

### Response Format (JSONL Stream)
```jsonl
{"id":"req_123","type":"assistant_message","content":"I'll create hello.ts..."}
{"id":"req_123","type":"tool_use","tool":"write","args":{"path":"hello.ts"}}
{"id":"req_123","type":"tool_result","tool":"write","result":"File created"}
{"id":"req_123","type":"done","status":"success"}
```

## Key Components

### 1. Gateway Service
- **Wallet Auth**: Connect with Arweave wallet (or RSA/ECDSA)
- **HTTPSig Verification**: RFC 9421 signature validation on every request
- **Pod Routing**: Route signed requests to user's pod
- **Pod Lifecycle**: Create/delete pods on demand

### 2. Pod Image (Developer Agent)
- **Base**: `ghcr.io/anomalyco/opencode` (agent harness)
- **Dev Tools**: git, curl, wget, brew, common CLIs
- **Languages**: Node.js, Python, Rust, Go (or installable via brew)
- **Security**: Only accepts HTTPSig-signed requests from owner wallet

### 3. HTTPSig Layer (per-pod)
- Verifies every incoming request
- Extracts wallet address from signature
- Rejects unsigned or incorrectly signed requests
- Maps wallet → pod ownership

### 4. Secret Management
- LLM API keys stored per-wallet
- Mounted into pod at runtime
- Never exposed to users directly
- OpenCode uses them internally

### 5. Streaming API
- JSON input → OpenCode processes → JSONL output
- Streamable responses for long-running tasks
- Request/response correlation via IDs

## Tech Stack

| Component | Technology |
|------------|-------------|
| Orchestration | Kubernetes (k3s or EKS) |
| Container Runtime | containerd |
| Ingress | Traefik or NGINX |
| Frontend | xterm.js + WebSocket |
| Auth | HTTPSig (RFC 9421) |
| Secrets | K8s Secrets + Vault |
| Storage | PVC + Git repositories |
| Database | PostgreSQL (pod metadata) |

## Phases

### Phase 1: Core Infrastructure
- [ ] Kubernetes cluster setup (local minikube or cloud)
- [ ] Base pod template with OpenCode
- [ ] HTTPSig authentication middleware
- [ ] Basic pod lifecycle API

### Phase 2: Frontend & UX
- [ ] Streamable terminal frontend
- [ ] Wallet registration flow
- [ ] Pod dashboard UI

### Phase 3: GitHub Integration
- [ ] OAuth flow for GitHub
- [ ] Repository browser
- [ ] Clone/edit/push workflow

### Phase 4: LLM Integration
- [ ] Secret injection for LLM keys
- [ ] Per-user API key management
- [ ] Model selection UI

### Phase 5: Production
- [ ] DNS setup (permaweb.live)
- [ ] TLS certificates
- [ ] Monitoring & logging
- [ ] Rate limiting & quotas

## Security Model

1. **One Wallet Per Pod**: Each pod has exactly one RSA/ECDSA keypair
2. **HTTPSig Verification**: All requests to pod must be signed
3. **Secret Isolation**: LLM keys mounted as K8s Secrets, not env vars
4. **Network Isolation**: Pods communicate only through API gateway
5. **Resource Quotas**: CPU/Memory limits prevent runaway pods

## API Endpoints (Planned)

```
POST   /api/pods                    # Create new pod
GET    /api/pods                    # List user's pods
GET    /api/pods/:id                 # Get pod status
DELETE /api/pods/:id                 # Delete pod
POST   /api/pods/:id/start           # Start pod
POST   /api/pods/:id/stop            # Stop pod
POST   /api/wallets/register         # Register wallet
GET    /api/github/repos             # List GitHub repos
POST   /api/github/clone              # Clone repo to pod
POST   /api/github/push               # Push changes to GitHub
POST   /api/secrets/llm               # Store LLM API key
```

## Repository Structure

```
web-os/
├── k8s/                    # Kubernetes manifests
│   ├── namespace.yaml
│   ├── pod-template.yaml
│   ├── secrets.yaml
│   ├── ingress.yaml
│   └── configmap.yaml
├── api/                    # API server
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── frontend/               # Web frontend
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── opencode-sidecar/       # HTTPSig verification sidecar
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── scripts/                # Deployment scripts
├── docs/                   # Documentation
├── PLAN.md                 # This file
└── README.md               # Project overview
```

## Next Steps

1. Set up local Kubernetes cluster (minikube)
2. Create base pod template with OpenCode
3. Implement HTTPSig middleware
4. Build minimal API for pod lifecycle