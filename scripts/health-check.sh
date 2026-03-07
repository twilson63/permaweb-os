#!/usr/bin/env bash

set -euo pipefail

NAMESPACE="${K8S_NAMESPACE:-${WEB_OS_NAMESPACE:-web-os}}"
INGRESS_NAMESPACE="${INGRESS_NAMESPACE:-ingress-nginx}"
INGRESS_SELECTOR="${INGRESS_SELECTOR:-app.kubernetes.io/component=controller}"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf "error: required command not found: %s\n" "$cmd" >&2
    exit 1
  fi
}

echo "==> Validating local cluster health"
require_command kubectl

echo "==> Checking cluster connectivity"
kubectl cluster-info >/dev/null

echo "==> Checking namespace '${NAMESPACE}'"
kubectl get namespace "$NAMESPACE" >/dev/null

echo "==> Checking ingress controller pods in '${INGRESS_NAMESPACE}'"
kubectl wait --namespace "$INGRESS_NAMESPACE" \
  --for=condition=available deployment/ingress-nginx-controller \
  --timeout=180s >/dev/null

RUNNING_COUNT="$(kubectl get pods -n "$INGRESS_NAMESPACE" -l "$INGRESS_SELECTOR" --field-selector=status.phase=Running -o name | wc -l | tr -d ' ')"
if [[ "$RUNNING_COUNT" -lt 1 ]]; then
  printf "error: ingress controller pods are not running in namespace %s\n" "$INGRESS_NAMESPACE" >&2
  exit 1
fi

echo
echo "Health check passed."
echo "Namespace: ${NAMESPACE}"
echo "Ingress:   ${INGRESS_NAMESPACE} (${INGRESS_SELECTOR})"
