#!/usr/bin/env bash
set -euo pipefail

PROFILE="${MINIKUBE_PROFILE:-web-os}"

if ! command -v minikube >/dev/null 2>&1; then
  printf "minikube is not installed\n" >&2
  exit 1
fi

printf "Deleting minikube profile '%s'\n" "$PROFILE"
if minikube profile list -o json 2>/dev/null | grep -q "\"Name\":\"${PROFILE}\""; then
  minikube delete --profile "$PROFILE"
else
  printf "Minikube profile '%s' does not exist; nothing to delete\n" "$PROFILE"
fi
