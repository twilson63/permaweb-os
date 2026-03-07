#!/usr/bin/env bash

set -euo pipefail

PROFILE="${MINIKUBE_PROFILE:-web-os}"
NAMESPACE="${K8S_NAMESPACE:-${WEB_OS_NAMESPACE:-web-os}}"
DRIVER="${MINIKUBE_DRIVER:-docker}"
CPUS="${MINIKUBE_CPUS:-4}"
MEMORY="${MINIKUBE_MEMORY:-8192}"
DISK_SIZE="${MINIKUBE_DISK_SIZE:-30g}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAMESPACE_MANIFEST="${ROOT_DIR}/k8s/namespace.yaml"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: required command not found: ${cmd}" >&2
    exit 1
  fi
}

status_of_profile() {
  minikube -p "$PROFILE" status --output=json 2>/dev/null | jq -r '.Host // ""' || true
}

echo "==> Validating prerequisites"
require_command minikube
require_command kubectl
require_command jq

if [[ "$DRIVER" == "docker" ]]; then
  require_command docker
fi

PROFILE_STATE="$(status_of_profile)"

if [[ "$PROFILE_STATE" == "Running" ]]; then
  echo "==> Minikube profile '${PROFILE}' already running"
else
  echo "==> Starting minikube profile '${PROFILE}'"
  minikube start \
    --profile "$PROFILE" \
    --driver "$DRIVER" \
    --cpus "$CPUS" \
    --memory "$MEMORY" \
    --disk-size "$DISK_SIZE"
fi

echo "==> Switching kubectl context to '${PROFILE}'"
kubectl config use-context "$PROFILE" >/dev/null

echo "==> Enabling required minikube addons"
minikube addons enable ingress -p "$PROFILE" >/dev/null
minikube addons enable metrics-server -p "$PROFILE" >/dev/null
minikube addons enable default-storageclass -p "$PROFILE" >/dev/null
minikube addons enable storage-provisioner -p "$PROFILE" >/dev/null

if [[ -f "$NAMESPACE_MANIFEST" ]]; then
  echo "==> Applying namespace manifest"
  kubectl apply -f "$NAMESPACE_MANIFEST" >/dev/null
else
  echo "==> Namespace manifest not found, creating namespace '${NAMESPACE}' directly"
  kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
fi

echo
echo "Bootstrap complete."
echo "Profile:   ${PROFILE}"
echo "Namespace: ${NAMESPACE}"
echo
echo "Next steps:"
echo "- kubectl get nodes"
echo "- kubectl get pods -n ingress-nginx"
echo "- Start adding manifests in ${ROOT_DIR}/k8s"
