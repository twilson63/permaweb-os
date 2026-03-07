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
