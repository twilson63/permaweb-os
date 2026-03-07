#!/usr/bin/env bash

set -euo pipefail

CLUSTER_NAME="${KIND_CLUSTER_NAME:-web-os}"
NAMESPACE="${K8S_NAMESPACE:-${WEB_OS_NAMESPACE:-web-os}}"
KIND_CONFIG="${KIND_CONFIG:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAMESPACE_MANIFEST="${ROOT_DIR}/k8s/namespace.yaml"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: required command not found: ${cmd}" >&2
    exit 1
  fi
}

cluster_exists() {
  kind get clusters | grep -qx "$CLUSTER_NAME"
}

echo "==> Validating prerequisites"
require_command kind
require_command kubectl

if cluster_exists; then
  echo "==> Kind cluster '${CLUSTER_NAME}' already exists"
else
  echo "==> Creating kind cluster '${CLUSTER_NAME}'"
  if [[ -n "$KIND_CONFIG" ]]; then
    kind create cluster --name "$CLUSTER_NAME" --config "$KIND_CONFIG"
  else
    kind create cluster --name "$CLUSTER_NAME"
  fi
fi

echo "==> Switching kubectl context to kind-${CLUSTER_NAME}"
kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null

if [[ -f "$NAMESPACE_MANIFEST" ]]; then
  echo "==> Applying namespace manifest"
  kubectl apply -f "$NAMESPACE_MANIFEST" >/dev/null
else
  echo "==> Namespace manifest not found, creating namespace '${NAMESPACE}' directly"
  kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
fi

echo
echo "Bootstrap complete."
echo "Provider:  kind"
echo "Cluster:   ${CLUSTER_NAME}"
echo "Namespace: ${NAMESPACE}"
echo
echo "Next steps:"
echo "- kubectl get nodes"
echo "- kubectl get ns ${NAMESPACE}"
echo "- Start adding manifests in ${ROOT_DIR}/k8s"
