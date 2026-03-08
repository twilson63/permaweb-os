# Web OS Architecture Decision Records

## ADR-001: Wallet-Based Authentication

**Status**: Accepted

**Context**: Users need to securely access their personal OpenCode pods. We need an authentication mechanism that is decentralized and works with existing Web3 wallets.

**Decision**: Use Arweave wallets (and later RSA/ECDSA) with HTTPSig (RFC 9421) for authentication. The wallet address becomes the pod identifier.

**Consequences**:
- Users connect with their existing wallet
- Each wallet maps to exactly one pod
- All requests must be HTTPSig-signed
- No username/password system needed

## ADR-002: JSON In → JSONL Out API

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

## ADR-003: Developer Agent Image

**Status**: Accepted

**Context**: Users need a complete development environment in their pod.

**Decision**: Base image includes:
- OpenCode (agent harness)
- git, curl, wget, common CLIs
- brew for additional package installation
- Node.js, Python, Rust, Go (pre-installed or installable)

**Consequences**:
- Larger image size but complete dev environment
- Users can install additional tools via brew
- No need for custom images per user
- Security: HTTPSig layer prevents unauthorized access

## ADR-004: Per-Pod HTTPSig Verification

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

## ADR-005: Secret Mount Pattern

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

## ADR-006: Per-Pod Subdomain

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