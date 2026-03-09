#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NAMESPACE="${K8S_NAMESPACE:-${WEB_OS_NAMESPACE:-web-os}}"
POD_NAME="${WEB_OS_POD_NAME:-user-pod}"
POD_MANIFEST="${ROOT_DIR}/k8s/pod-template.yaml"
SERVICE_MANIFEST="${ROOT_DIR}/k8s/pod-service.yaml"
LLM_SECRET_MANIFEST="${ROOT_DIR}/k8s/llm-api-keys.secret.yaml"
INGRESS_TEMPLATE="${ROOT_DIR}/k8s/pod-ingress.template.yaml"
NAMESPACE_MANIFEST="${ROOT_DIR}/k8s/namespace.yaml"
OPENCODE_IMAGE="${OPENCODE_IMAGE:-web-os/opencode-base:latest}"
SIDECAR_IMAGE="${SIDECAR_IMAGE:-web-os/opencode-sidecar:latest}"
POD_BASE_DOMAIN="${POD_BASE_DOMAIN:-127.0.0.1.nip.io}"
POD_HOST="${POD_NAME}.${POD_BASE_DOMAIN}"
OWNER_WALLET="${WEB_OS_OWNER_WALLET:-}"
LLM_SECRET_PREFIX="${WEB_OS_LLM_SECRET_PREFIX:-llm-keys}"
GLOBAL_LLM_SECRET_NAME="${WEB_OS_GLOBAL_LLM_SECRET_NAME:-llm-api-keys}"
LLM_SECRET_NAME="${WEB_OS_LLM_SECRET_NAME:-}"

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

apply_ingress_manifest() {
  python3 - "$INGRESS_TEMPLATE" "$POD_BASE_DOMAIN" <<'PY' | kubectl apply -f - >/dev/null
from pathlib import Path
import sys

template_path = Path(sys.argv[1])
base_domain = sys.argv[2]
template = template_path.read_text(encoding="utf-8")
rendered = template.replace("{{POD_BASE_DOMAIN}}", base_domain)
sys.stdout.write(rendered)
PY
}

wallet_secret_name() {
  local wallet="$1"
  require_command shasum
  require_command awk
  require_command cut
  local normalized
  normalized="$(printf '%s' "$wallet" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  local wallet_hash
  wallet_hash="$(printf '%s' "$normalized" | shasum -a 256 | awk '{print $1}' | cut -c1-16)"
  printf '%s-%s' "$LLM_SECRET_PREFIX" "$wallet_hash"
}

apply_pod_manifest() {
  local secret_name="$1"
  python3 - "$POD_MANIFEST" "$secret_name" <<'PY' | kubectl apply -f -
from pathlib import Path
import sys

template_path = Path(sys.argv[1])
secret_name = sys.argv[2]
template = template_path.read_text(encoding="utf-8")
rendered = template.replace("{{LLM_SECRET_NAME}}", secret_name)
sys.stdout.write(rendered)
PY
}

ensure_llm_secret() {
  local secret_name="$1"

  if [[ -n "${OPENAI_API_KEY:-}" || -n "${ANTHROPIC_API_KEY:-}" ]]; then
    local create_cmd=(kubectl create secret generic "$secret_name" --namespace "$NAMESPACE" --dry-run=client -o yaml)

    if [[ -n "${OPENAI_API_KEY:-}" ]]; then
      create_cmd+=(--from-literal=openai="$OPENAI_API_KEY")
    fi

    if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
      create_cmd+=(--from-literal=anthropic="$ANTHROPIC_API_KEY")
    fi

    echo "==> Applying wallet-specific LLM secret '${secret_name}'"
    "${create_cmd[@]}" | kubectl apply -f - >/dev/null
    return
  fi

  if kubectl get secret "$secret_name" --namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo "==> Found existing LLM secret '${secret_name}'"
    return
  fi

  if [[ "$secret_name" != "$GLOBAL_LLM_SECRET_NAME" ]] && kubectl get secret "$GLOBAL_LLM_SECRET_NAME" --namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo "warning: wallet secret '${secret_name}' missing, falling back to '${GLOBAL_LLM_SECRET_NAME}'" >&2
    LLM_SECRET_NAME="$GLOBAL_LLM_SECRET_NAME"
    return
  fi

  if [[ -f "${LLM_SECRET_MANIFEST}" ]]; then
    echo "==> Applying global LLM API key secret"
    kubectl apply -f "${LLM_SECRET_MANIFEST}" >/dev/null
    if [[ "$secret_name" == "$GLOBAL_LLM_SECRET_NAME" ]]; then
      return
    fi
  fi

  if ! kubectl get secret "$secret_name" --namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo "error: missing LLM secret '${secret_name}'. Set OPENAI_API_KEY/ANTHROPIC_API_KEY or create the secret first." >&2
    exit 1
  fi
}

echo "==> Validating prerequisites"
require_command kubectl
require_command python3

if [[ ! -f "${POD_MANIFEST}" ]]; then
  echo "error: missing pod manifest: ${POD_MANIFEST}" >&2
  exit 1
fi

if [[ ! -f "${SERVICE_MANIFEST}" ]]; then
  echo "error: missing service manifest: ${SERVICE_MANIFEST}" >&2
  exit 1
fi

if [[ ! -f "${INGRESS_TEMPLATE}" ]]; then
  echo "error: missing ingress template: ${INGRESS_TEMPLATE}" >&2
  exit 1
fi

if [[ -f "${NAMESPACE_MANIFEST}" ]]; then
  echo "==> Ensuring namespace exists"
  kubectl apply -f "${NAMESPACE_MANIFEST}" >/dev/null
else
  kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
fi

ensure_kind_images

if [[ -z "$LLM_SECRET_NAME" ]]; then
  if [[ -n "$OWNER_WALLET" ]]; then
    LLM_SECRET_NAME="$(wallet_secret_name "$OWNER_WALLET")"
  else
    LLM_SECRET_NAME="$GLOBAL_LLM_SECRET_NAME"
  fi
fi

ensure_llm_secret "$LLM_SECRET_NAME"

echo "==> Deploying pod manifest"
apply_pod_manifest "$LLM_SECRET_NAME"

echo "==> Deploying service manifest"
kubectl apply -f "${SERVICE_MANIFEST}" >/dev/null

echo "==> Deploying ingress manifest for '*.${POD_BASE_DOMAIN}'"
apply_ingress_manifest

echo "==> Waiting for pod to be ready"
kubectl wait --namespace "${NAMESPACE}" --for=condition=Ready "pod/${POD_NAME}" --timeout=180s

echo
echo "==> Container status"
kubectl get pod "${POD_NAME}" -n "${NAMESPACE}" -o wide

echo
echo "==> Service and ingress"
kubectl get service "${POD_NAME}" -n "${NAMESPACE}"
kubectl get ingress "${POD_NAME}" -n "${NAMESPACE}"

echo
echo "==> OpenCode logs"
kubectl logs -n "${NAMESPACE}" "${POD_NAME}" -c opencode --tail=50

echo
echo "==> HTTPSig sidecar logs"
kubectl logs -n "${NAMESPACE}" "${POD_NAME}" -c httpsig-sidecar --tail=50

echo
echo "==> Wildcard subdomain ready"
echo "Pod host:   http://${POD_HOST}"
echo "API health: http://${POD_HOST}/health"
echo "Frontend:   http://${POD_HOST}/"
