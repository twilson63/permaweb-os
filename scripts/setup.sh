#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROVIDER="${WEB_OS_CLUSTER_PROVIDER:-minikube}"

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
