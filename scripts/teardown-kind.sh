#!/usr/bin/env bash

set -euo pipefail

CLUSTER_NAME="${KIND_CLUSTER_NAME:-web-os}"

if ! command -v kind >/dev/null 2>&1; then
  printf "kind is not installed\n" >&2
  exit 1
fi

printf "Deleting kind cluster '%s'\n" "$CLUSTER_NAME"
if kind get clusters | grep -qx "$CLUSTER_NAME"; then
  kind delete cluster --name "$CLUSTER_NAME"
else
  printf "Kind cluster '%s' does not exist; nothing to delete\n" "$CLUSTER_NAME"
fi
