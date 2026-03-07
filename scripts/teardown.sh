#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROVIDER="${WEB_OS_CLUSTER_PROVIDER:-}"
MINIKUBE_PROFILE="${MINIKUBE_PROFILE:-web-os}"

cluster_exists_kind() {
  command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -qx "${KIND_CLUSTER_NAME:-web-os}"
}

cluster_exists_minikube() {
  command -v minikube >/dev/null 2>&1 && minikube profile list -o json 2>/dev/null | grep -q "\"Name\":\"${MINIKUBE_PROFILE}\""
}

detect_provider() {
  local current_context
  current_context="$(kubectl config current-context 2>/dev/null || true)"

  if [[ "$current_context" == kind-* ]] && command -v kind >/dev/null 2>&1; then
    echo "kind"
    return
  fi

  if [[ "$current_context" == "$MINIKUBE_PROFILE" ]] && command -v minikube >/dev/null 2>&1; then
    echo "minikube"
    return
  fi

  if cluster_exists_kind; then
    echo "kind"
    return
  fi

  if cluster_exists_minikube; then
    echo "minikube"
    return
  fi

  if command -v minikube >/dev/null 2>&1; then
    echo "minikube"
    return
  fi

  if command -v kind >/dev/null 2>&1; then
    echo "kind"
    return
  fi

  printf "Neither minikube nor kind is installed.\n" >&2
  printf "Install one provider or set WEB_OS_CLUSTER_PROVIDER explicitly.\n" >&2
  exit 1
}

if [[ -z "$PROVIDER" ]]; then
  PROVIDER="$(detect_provider)"
  printf "WEB_OS_CLUSTER_PROVIDER not set, auto-selected provider: %s\n" "$PROVIDER"
fi

case "$PROVIDER" in
  minikube)
    "${SCRIPT_DIR}/teardown-minikube.sh"
    ;;
  kind)
    "${SCRIPT_DIR}/teardown-kind.sh"
    ;;
  *)
    printf "Unsupported WEB_OS_CLUSTER_PROVIDER: %s\n" "$PROVIDER" >&2
    printf "Supported values: minikube, kind\n" >&2
    exit 1
    ;;
esac
