# Minikube Bootstrap (Provider-specific)

For the current Phase 0 Step 1 guide covering both minikube and kind, see `docs/local-cluster-bootstrap.md`.

This project uses a local minikube cluster for Phase 1 development.

## What the bootstrap script does

`scripts/setup.sh` (wrapper) and `scripts/bootstrap-minikube.sh` (implementation) will:

1. Validate required tools (`minikube`, `kubectl`, `jq`, and `docker` when using docker driver)
2. Start a minikube profile named `web-os` by default
3. Switch `kubectl` context to that profile
4. Enable required addons:
   - `ingress`
   - `metrics-server`
   - `default-storageclass`
   - `storage-provisioner`
5. Apply `k8s/namespace.yaml` (or create namespace directly if the manifest is missing)

## Prerequisites

- macOS/Linux shell
- Docker Desktop (or another supported minikube driver)
- `minikube`
- `kubectl`
- `jq`

## Usage

From the repository root:

```bash
chmod +x scripts/setup.sh scripts/bootstrap-minikube.sh
./scripts/setup.sh
```

## Configuration

You can override defaults with environment variables:

- `MINIKUBE_PROFILE` (default: `web-os`)
- `K8S_NAMESPACE` (default: `web-os`)
- `WEB_OS_NAMESPACE` (legacy alias for namespace)
- `MINIKUBE_DRIVER` (default: `docker`)
- `MINIKUBE_CPUS` (default: `4`)
- `MINIKUBE_MEMORY` (default: `8192`)
- `MINIKUBE_DISK_SIZE` (default: `30g`)

Example:

```bash
MINIKUBE_PROFILE=web-os-dev MINIKUBE_MEMORY=12288 ./scripts/setup.sh
```

## Verify cluster health

```bash
kubectl get nodes
kubectl get ns web-os
kubectl get pods -n ingress-nginx
```

## Tear down

```bash
minikube delete -p web-os
```
