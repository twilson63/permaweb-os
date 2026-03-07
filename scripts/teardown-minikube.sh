#!/usr/bin/env bash
set -euo pipefail

PROFILE="${MINIKUBE_PROFILE:-web-os}"

if ! command -v minikube >/dev/null 2>&1; then
  printf "minikube is not installed\n" >&2
  exit 1
fi

printf "Deleting minikube profile '%s'\n" "$PROFILE"
minikube delete --profile "$PROFILE"
