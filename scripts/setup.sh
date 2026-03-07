#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROVIDER="${WEB_OS_CLUSTER_PROVIDER:-}"

detect_provider() {
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
    "${SCRIPT_DIR}/bootstrap-minikube.sh"
    ;;
  kind)
    "${SCRIPT_DIR}/bootstrap-kind.sh"
    ;;
  *)
    printf "Unsupported WEB_OS_CLUSTER_PROVIDER: %s\n" "$PROVIDER" >&2
    printf "Supported values: minikube, kind\n" >&2
    exit 1
    ;;
esac
