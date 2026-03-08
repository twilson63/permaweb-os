# Web OS - Project Overview

A Kubernetes-based platform for running isolated OpenCode pods with HTTPSig authentication.

## Quick Links

- **Hive Room**: `#web-os` (room_mmgazn5q221npk5b)
- **Workspace**: `~/.openclaw/workspace/web-os`
- **Domain**: web-os.live

## Architecture

Each pod runs OpenCode with:
- Streamable frontend (xterm.js)
- HTTPSig signature verification
- One RSA/ECDSA wallet per pod
- LLM secrets mounted from K8s Secrets

## Getting Started

### Phase 0 - Step 1: Local Kubernetes Environment

Prerequisites:
- `kubectl`
- `minikube` or `kind`
- Docker Desktop, Podman, or another supported local runtime

Bootstrap local cluster:

```bash
chmod +x scripts/*.sh
./scripts/setup.sh
```

Optional configuration (before running setup):

```bash
export MINIKUBE_PROFILE=web-os
export MINIKUBE_CPUS=4
export MINIKUBE_MEMORY=8192
export MINIKUBE_DISK_SIZE=30g
export MINIKUBE_DRIVER=docker
export WEB_OS_NAMESPACE=web-os

# Use kind instead of minikube
export WEB_OS_CLUSTER_PROVIDER=kind
export KIND_CLUSTER_NAME=web-os
```

Validate cluster health:

```bash
kubectl get nodes
kubectl get pods -A
kubectl config current-context
```

Teardown when done:

```bash
./scripts/teardown.sh
```

Detailed setup notes: `docs/local-cluster-bootstrap.md`

## Development

Post tasks to `#web-os` with `@opencode` mention.

## GitHub OAuth Setup

Register a GitHub OAuth App before using GitHub integration:

1. Go to GitHub `Settings -> Developer settings -> OAuth Apps -> New OAuth App`
2. Set `Homepage URL` to your frontend origin (for local dev use `http://127.0.0.1:5173`)
3. Set `Authorization callback URL` to `http://127.0.0.1:3000/api/auth/github/callback`
4. Save the generated client ID and client secret as API env vars:

```bash
export GITHUB_CLIENT_ID=your_github_oauth_app_client_id
export GITHUB_CLIENT_SECRET=your_github_oauth_app_client_secret
# optional override (defaults to request host callback path)
export GITHUB_REDIRECT_URI=http://127.0.0.1:3000/api/auth/github/callback
```

API endpoints:

- `GET /api/auth/github` (requires session bearer token, redirects to GitHub)
- `GET /api/auth/github/callback` (exchanges `code`, stores GitHub token in session)

## Wildcard Ingress for Pod Subdomains

Deploy a pod with service + wildcard ingress:

```bash
# set your real provider keys before first deploy
cp k8s/llm-api-keys.secret.yaml /tmp/llm-api-keys.secret.yaml
# edit /tmp/llm-api-keys.secret.yaml and replace placeholder values

POD_BASE_DOMAIN=127.0.0.1.nip.io ./scripts/deploy-pod.sh
```

Verify DNS and ingress behavior:

```bash
POD_BASE_DOMAIN=127.0.0.1.nip.io ./scripts/verify-wildcard-ingress.sh
```

Notes:

- `POD_BASE_DOMAIN` controls wildcard host matching (`*.${POD_BASE_DOMAIN}`)
- Default domain is `127.0.0.1.nip.io`, which supports wildcard DNS locally
- LLM keys are mounted to `/secrets/llm/` and never returned by API responses
