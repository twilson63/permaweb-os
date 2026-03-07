# Local Cluster Bootstrap (Phase 0 - Step 1)

This project supports two local Kubernetes providers:

- `minikube` (default)
- `kind`

Use `scripts/setup.sh` as the single entrypoint.

## What `scripts/setup.sh` does

Based on `WEB_OS_CLUSTER_PROVIDER`, the wrapper dispatches to:

- `scripts/bootstrap-minikube.sh`
- `scripts/bootstrap-kind.sh`

Both implementations:

1. Validate required tools
2. Provision or reuse the local cluster
3. Switch `kubectl` context to that cluster
4. Apply `k8s/namespace.yaml` (or create namespace if missing)

## Prerequisites

- macOS/Linux shell
- `kubectl`
- one provider:
  - `minikube` (+ `docker` when using docker driver)
  - `kind`

## Usage

From repository root:

```bash
chmod +x scripts/*.sh
./scripts/setup.sh
```

Use kind:

```bash
WEB_OS_CLUSTER_PROVIDER=kind ./scripts/setup.sh
```

Use minikube explicitly:

```bash
WEB_OS_CLUSTER_PROVIDER=minikube ./scripts/setup.sh
```

## Configuration

Global:

- `WEB_OS_CLUSTER_PROVIDER` (`minikube` or `kind`, default: `minikube`)
- `WEB_OS_NAMESPACE` or `K8S_NAMESPACE` (default: `web-os`)

Minikube-specific:

- `MINIKUBE_PROFILE` (default: `web-os`)
- `MINIKUBE_DRIVER` (default: `docker`)
- `MINIKUBE_CPUS` (default: `4`)
- `MINIKUBE_MEMORY` (default: `8192`)
- `MINIKUBE_DISK_SIZE` (default: `30g`)

Kind-specific:

- `KIND_CLUSTER_NAME` (default: `web-os`)
- `KIND_CONFIG` (optional path to kind config file)

## Verify cluster health

```bash
kubectl get nodes
kubectl get ns web-os
kubectl get pods -A
kubectl config current-context
```

## Tear down

Use the provider-aware wrapper:

```bash
./scripts/teardown.sh
```

Examples:

```bash
WEB_OS_CLUSTER_PROVIDER=kind ./scripts/teardown.sh
WEB_OS_CLUSTER_PROVIDER=minikube ./scripts/teardown.sh
```

## Wildcard ingress (P1-S4)

After cluster bootstrap, deploy the pod resources with wildcard ingress:

```bash
POD_BASE_DOMAIN=127.0.0.1.nip.io ./scripts/deploy-pod.sh
```

Validate wildcard DNS + ingress routing:

```bash
POD_BASE_DOMAIN=127.0.0.1.nip.io ./scripts/verify-wildcard-ingress.sh
```

This config creates ingress rules for `*.127.0.0.1.nip.io` and routes:

- `/health` and `/verify` to the HTTPSig sidecar (API)
- `/` to the OpenCode container (frontend)
