#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NAMESPACE="${K8S_NAMESPACE:-${WEB_OS_NAMESPACE:-web-os}}"
POD_NAME="${WEB_OS_POD_NAME:-user-pod}"
POD_MANIFEST="${ROOT_DIR}/k8s/pod-template.yaml"
NAMESPACE_MANIFEST="${ROOT_DIR}/k8s/namespace.yaml"
OPENCODE_IMAGE="${OPENCODE_IMAGE:-web-os/opencode-base:latest}"
SIDECAR_IMAGE="${SIDECAR_IMAGE:-web-os/opencode-sidecar:latest}"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: required command not found: ${cmd}" >&2
    exit 1
  fi
}

ensure_kind_images() {
  if [[ "$(kubectl config current-context)" != kind-* ]]; then
    return
  fi

  require_command docker
  require_command kind

  echo "==> Building local images"
  docker build -t "${OPENCODE_IMAGE}" "${ROOT_DIR}/images/opencode-base"
  docker build -t "${SIDECAR_IMAGE}" "${ROOT_DIR}/opencode-sidecar"

  local cluster_name
  cluster_name="$(kubectl config current-context)"
  cluster_name="${cluster_name#kind-}"

  echo "==> Loading images into kind cluster '${cluster_name}'"
  kind load docker-image --name "${cluster_name}" "${OPENCODE_IMAGE}" "${SIDECAR_IMAGE}"
}

echo "==> Validating prerequisites"
require_command kubectl

if [[ ! -f "${POD_MANIFEST}" ]]; then
  echo "error: missing pod manifest: ${POD_MANIFEST}" >&2
  exit 1
fi

if [[ -f "${NAMESPACE_MANIFEST}" ]]; then
  echo "==> Ensuring namespace exists"
  kubectl apply -f "${NAMESPACE_MANIFEST}" >/dev/null
else
  kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
fi

ensure_kind_images

echo "==> Deploying pod manifest"
kubectl apply -f "${POD_MANIFEST}"

echo "==> Waiting for pod to be ready"
kubectl wait --namespace "${NAMESPACE}" --for=condition=Ready "pod/${POD_NAME}" --timeout=180s

echo
echo "==> Container status"
kubectl get pod "${POD_NAME}" -n "${NAMESPACE}" -o wide

echo
echo "==> OpenCode logs"
kubectl logs -n "${NAMESPACE}" "${POD_NAME}" -c opencode --tail=50

echo
echo "==> HTTPSig sidecar logs"
kubectl logs -n "${NAMESPACE}" "${POD_NAME}" -c httpsig-sidecar --tail=50
