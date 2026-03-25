# Web OS - Architecture Design Document

> A platform where developers connect with their wallet, spawn a personal OpenCode pod, and interact through signed JSON messages. Each pod is a complete development environment, secured by HTTPSig, and directly addressable via subdomain.

---

## The Problem

Developers want AI-powered development environments that they own and control. Current solutions require trusting centralized services with code, credentials, and API keys. We need a model where:

1. **Identity** is owned by the developer (their wallet)
2. **Code** lives in environments they control
3. **Secrets** (API keys) are never exposed
4. **Access** is cryptographically verified

## The Solution

**Web OS** is a Kubernetes platform where each user gets a personal pod containing:

- **OpenCode** - An AI agent harness that can read, write, and execute code
- **Dev Tools** - git, curl, brew, Node.js, Python, Rust, Go
- **HTTPSig Sidecar** - Verifies every request is signed by the owner's wallet

Each pod has its own subdomain: `{pod-id}.permaweb.live`

Users interact by signing JSON messages with their wallet. The HTTPSig sidecar verifies the signature and only allows requests from the owner's wallet. OpenCode processes the request and streams JSONL responses.

```
User's Wallet → Signs JSON → Pod Subdomain → HTTPSig Sidecar → OpenCode → JSONL Stream
                    │                              │
                    └───── Signature Verification ─┘
```

---

## Architecture

### Mental Model

Think of each pod as a personal development server in the cloud. But unlike a traditional VPS:

1. **You don't SSH in** - You send signed JSON requests
2. **You don't manage it** - Kubernetes handles lifecycle
3. **You don't share it** - One wallet, one pod
4. **You can't exfiltrate from it** - Secrets are mounted, not accessible

The gateway (`api.permaweb.live`) handles pod lifecycle (create, delete, status). But all pod interactions go directly to the pod's subdomain, bypassing the gateway. This is intentional - the gateway should never see request payloads.

### Core Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER JOURNEY                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   1. CONNECT WALLET                                                         │
│      ┌────────────────────────────────────────────────────────────────┐     │
│      │  User clicks "Connect Wallet"                                  │     │
│      │  Frontend requests signature of challenge                       │     │
│      │  Wallet signs: "I am requesting a pod on permaweb.live"          │     │
│      │  Gateway verifies signature, creates pod                        │     │
│      │  Returns: { podId: "abc123", subdomain: "abc123.permaweb.live" } │     │
│      └────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│   2. INTERACT WITH POD                                                       │
│      ┌────────────────────────────────────────────────────────────────┐     │
│      │  User sends request to abc123.permaweb.live                      │     │
│      │  Request: { method: "message", content: "Create hello.ts" }   │     │
│      │  Headers: Signature: keyId="owner", ...                        │     │
│      │                                                                 │     │
│      │  Pod's HTTPSig sidecar:                                         │     │
│      │    - Extracts keyId from signature                               │     │
│      │    - Compares with owner wallet address                         │     │
│      │    - If match: forward to OpenCode                              │     │
│      │    - If mismatch: 401 Unauthorized                              │     │
│      │                                                                 │     │
│      │  OpenCode:                                                      │     │
│      │    - Reads /secrets/llm/ for API key                            │     │
│      │    - Processes request                                           │     │
│      │    - Returns JSONL stream                                        │     │
│      └────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│   3. STREAM RESPONSE                                                          │
│      ┌────────────────────────────────────────────────────────────────┐     │
│      │  { type: "assistant_message", content: "Creating hello.ts..." } │     │
│      │  { type: "tool_use", tool: "write", path: "hello.ts" }        │     │
│      │  { type: "tool_result", result: "File created" }               │     │
│      │  { type: "done", status: "success" }                          │     │
│      └────────────────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Request Signing (HTTPSig)

Every request to a pod must be signed. We use HTTPSig (RFC 9421) because it's a standard, it works over HTTP, and it supports both RSA and ECDSA.

```typescript
// User creates request
const request = {
  id: "req_abc123",
  method: "message",
  params: { content: "Create hello.ts" }
};

// User signs with wallet
const signature = await wallet.sign(JSON.stringify(request));

// Request headers include:
// Signature: keyId="owner", headers="(request-target)", signature="base64..."
// The keyId is derived from the wallet address
```

The sidecar verifies:
1. The signature is valid
2. The keyId matches the pod owner's wallet
3. The request hasn't been replayed (nonce + timestamp)

### Subdomain Routing

Each pod gets its own subdomain: `{pod-id}.permaweb.live`

```
api.permaweb.live          → Gateway (pod lifecycle)
abc123.permaweb.live       → Pod abc123 (direct access)
xyz789.permaweb.live       → Pod xyz789 (direct access)
```

Why subdomains instead of path-based routing (`permaweb.live/pod/abc123`)?

1. **Direct access** - No gateway in the path means lower latency
2. **Isolation** - Each pod is independently addressable
3. **SSL** - Wildcard cert for `*.permaweb.live` covers all pods
4. **DNS** - Can route pods to different regions/clusters

The gateway only handles:
- Wallet authentication
- Pod creation/deletion
- Pod status queries

All actual pod interactions go directly to the pod's subdomain.

---

## Components

### Gateway Service (`api/`)

A thin Express service that handles pod lifecycle:

```typescript
POST /api/pods              → Create pod, return subdomain
GET  /api/pods              → List pods for wallet
GET  /api/pods/:id          → Get pod status
DELETE /api/pods/:id        → Delete pod
GET  /health                → Health check
```

The gateway never sees request payloads. It only knows:
- Which wallet owns which pod
- Pod status (creating, running, stopped, error)
- Pod subdomain

### Frontend (`frontend/`)

React + Vite application that:
- Connects wallet (Arweave, MetaMask, etc.)
- Signs challenges with wallet
- Displays pod list
- Creates/deletes pods
- Streams JSONL responses

### OpenCode Sidecar (`opencode-sidecar/`)

Node.js service (port 3001) that:
- Verifies HTTPSig signatures
- Rejects unauthorized requests
- Forwards valid requests to OpenCode
- Returns JSONL stream

```typescript
// Sidecar verifies signature
export async function verifySignature(request: Request): Promise<boolean> {
  const signature = request.headers.get('signature');
  const keyId = extractKeyId(signature);
  const publicKey = await getPublicKey(keyId);
  return validateSignature(request, publicKey);
}
```

### OpenCode Container (`images/opencode-base/`)

Docker image (629MB) containing:
- OpenCode (agent harness)
- git, curl, wget
- brew (package manager)
- Node.js, Python, Rust, Go
- Standard dev tools

```dockerfile
FROM ghcr.io/anomalyco/opencode
RUN apt-get update && apt-get install -y git curl wget vim tmux build-essential
RUN /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
USER 10001
EXPOSE 4096
CMD ["opencode", "run"]
```

### Kubernetes Resources

```yaml
# Pod: 2 containers
- opencode (port 4096)
- httpsig-sidecar (port 3001)

# Service: ClusterIP
- Routes to both containers

# Ingress: Wildcard
- *.web-os.local → pod service (local dev)
- api.web-os.local → gateway service
```

---

## Security Model

### Request Flow Security

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SECURITY BOUNDARIES                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────┐                                                        │
│   │   User's Wallet   │  ← Identity lives here                               │
│   │   (private key)   │  ← Never shared, never leaves device                 │
│   └──────────────────┘                                                        │
│            │                                                                  │
│            │ Signs request                                                    │
│            ▼                                                                  │
│   ┌──────────────────┐                                                        │
│   │   HTTP Request    │  ← Signed payload                                     │
│   │   + Signature     │  ← Includes keyId (wallet address)                    │
│   └──────────────────┘                                                        │
│            │                                                                  │
│            ▼                                                                  │
│   ┌──────────────────┐                                                        │
│   │  Pod Subdomain    │  ← {pod-id}.permaweb.live                               │
│   │                   │  ← Direct access, no gateway                          │
│   └──────────────────┘                                                        │
│            │                                                                  │
│            ▼                                                                  │
│   ┌──────────────────┐                                                        │
│   │  HTTPSig Sidecar  │  ← Verifies signature                                 │
│   │                   │  ← Checks keyId == pod owner                           │
│   │                   │  ← Rejects if mismatch (401)                           │
│   └──────────────────┘                                                        │
│            │                                                                  │
│            │ Only if valid                                                     │
│            ▼                                                                  │
│   ┌──────────────────┐                                                        │
│   │    OpenCode       │  ← Processes request                                  │
│   │                   │  ← Reads /secrets/llm/ for API key                    │
│   │                   │  ← Never exposes secrets to user                      │
│   └──────────────────┘                                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### What's Protected

| Asset | Where | Who Can Access |
|-------|-------|----------------|
| Wallet private key | User's device | Only user |
| LLM API keys | K8s Secret → `/secrets/llm/` | Only OpenCode container |
| Pod subdomain | DNS | Public (but requests must be signed) |
| Request signatures | In-flight | Sidecar validates, then discards |
| OpenCode state | Pod filesystem | Only that pod's OpenCode |

### What's NOT Protected

| Asset | Why |
|-------|-----|
| Pod subdomain | Public by design - anyone can see a pod exists |
| Pod count | Public - anyone can see how many pods exist |
| Request timing | Metadata - not critical |

### Secret Management

LLM API keys are stored in Kubernetes Secrets, mounted as files:

```yaml
volumes:
  - name: llm-secrets
    secret:
      secretName: llm-api-keys-{wallet-address}
      
volumeMounts:
  - name: llm-secrets
    mountPath: /secrets/llm
    readOnly: true  # Read-only!
```

OpenCode reads from `/secrets/llm/anthropic`, `/secrets/llm/openai`, etc. The user never sees these values - they're mounted into the pod, used by OpenCode, and never returned via API.

---

## Implementation Status

### What's Built

**Phase 0: Foundation (Complete)**
- Kind cluster with `web-os` namespace
- Service skeletons (api, frontend, opencode-sidecar)
- Base OpenCode image (629MB)
- HTTPSig library integration (`http-message-sig`)
- CI workflow and ADRs

**Phase 1: Core Pod Infrastructure (Complete)**
- Pod template (opencode + sidecar containers)
- Pod lifecycle API (create, list, get, delete)
- Basic frontend (pod list, create button)
- Wildcard ingress (`*.web-os.local`)
- Subdomain routing

### What's Next

**Phase 2: Authentication (In Progress)**
- Wallet connection UI
- HTTPSig request signing
- Session management
- Per-pod identity

**Phase 3: LLM Integration**
- Secret storage for API keys
- Key injection into pods
- Model selection

**Phase 4: GitHub Integration**
- OAuth flow
- Repository browser
- Clone/edit/push workflow

**Phase 5: Production**
- DNS (`permaweb.live`)
- TLS certificates
- Monitoring/logging
- Rate limiting

---

## Design Rationale

### Why HTTPSig instead of JWT?

JWT requires a shared secret or centralized identity provider. HTTPSig uses asymmetric cryptography - the user signs with their private key, anyone can verify with the public key. No shared secret, no central authority needed.

### Why subdomains instead of paths?

Subdomains isolate pods at the DNS level. Each pod can be routed independently, scaled independently, and moved between clusters without changing user code. Paths require the gateway to be in the request path.

### Why JSONL streaming instead of WebSocket?

JSONL is simpler. Each line is a complete JSON object. The client can start processing immediately, without buffering. WebSocket requires connection management, and OpenCode is primarily request-response, not bidirectional.

### Why Kubernetes instead of functions?

Functions (Lambda, Cloudflare Workers) have:
- Short execution times (OpenCode sessions can be hours)
- No persistent filesystem (need workspace for code)
- Limited container customization (need dev tools)

Kubernetes gives us:
- Long-running containers
- Persistent storage
- Full container customization
- Per-pod isolation

### Why one pod per wallet?

Each developer gets their own isolated environment. If one pod is compromised, others are unaffected. Secrets are mounted per-pod, so compromising one pod doesn't leak another's API keys.

---

## Future Considerations

### Multi-Region Deployment

Pods can be scheduled in different regions. The gateway can route `{pod-id}.permaweb.live` to the nearest cluster. This requires:
- Global DNS (Route 53, Cloudflare)
- Inter-cluster pod replication
- State synchronization

### Pod Snapshotting

Pods should be snapshotable - save state, restore later. This requires:
- Persistent volume snapshots
- Container state serialization
- Session state storage

### Collaborative Pods

Currently one wallet per pod. Future: invite other wallets to access your pod. Requires:
- Access control list
- Permission levels (read, write, admin)
- Audit logging

---

## References

- HTTPSig RFC 9421: https://datatracker.ietf.org/doc/html/rfc9421
- OpenCode: https://github.com/anomalyco/opencode
- Kubernetes: https://kubernetes.io/docs/
- Kind: https://kind.sigs.k8s.io/

---

**Last Updated**: March 2026
**Status**: Phase 1 Complete, Phase 2 In Progress