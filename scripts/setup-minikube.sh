#!/usr/bin/env bash
set -euo pipefail

PROFILE="${MINIKUBE_PROFILE:-web-os}"
K8S_VERSION="${MINIKUBE_K8S_VERSION:-stable}"
CPUS="${MINIKUBE_CPUS:-4}"
MEMORY="${MINIKUBE_MEMORY:-8192}"
DISK_SIZE="${MINIKUBE_DISK_SIZE:-30g}"
DRIVER="${MINIKUBE_DRIVER:-}"
NAMESPACE="${WEB_OS_NAMESPACE:-web-os}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "Missing required command: %s\n" "$1" >&2
    exit 1
  fi
}

printf "==> Checking prerequisites\n"
require_command minikube
require_command kubectl

printf "==> Starting minikube profile '%s'\n" "$PROFILE"

start_args=(
  start
  --profile "$PROFILE"
  --kubernetes-version "$K8S_VERSION"
  --cpus "$CPUS"
  --memory "$MEMORY"
  --disk-size "$DISK_SIZE"
  --container-runtime containerd
)

if [[ -n "$DRIVER" ]]; then
  start_args+=(--driver "$DRIVER")
fi

minikube "${start_args[@]}"

printf "==> Enabling ingress addon\n"
minikube addons enable ingress --profile "$PROFILE"

printf "==> Enabling metrics-server addon\n"
minikube addons enable metrics-server --profile "$PROFILE"

printf "==> Configuring kubectl context\n"
kubectl config use-context "$PROFILE"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl config set-context --current --namespace "$NAMESPACE" >/dev/null

printf "\nLocal Kubernetes environment is ready.\n"
printf "Profile:   %s\n" "$PROFILE"
printf "Namespace: %s\n" "$NAMESPACE"
printf "\nNext commands:\n"
printf "  kubectl get nodes\n"
printf "  kubectl get pods -A\n"
