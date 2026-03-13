#!/usr/bin/env bash
#
# Web OS Teardown Script
# Clean removal of all Web OS resources from Kubernetes cluster
#
# Usage:
#   ./scripts/destroy.sh [OPTIONS]
#
# Options:
#   -n, --namespace      Kubernetes namespace [default: web-os]
#   -k, --keep-secrets   Preserve secrets during teardown
#   -k, --keep-namespace Preserve namespace after teardown
#   -f, --force          Skip confirmation prompt
#   -v, --verbose        Enable verbose output
#   -h, --help           Show this help message
#
# Environment Variables:
#   WEB_OS_NAMESPACE     Default namespace
#   CONFIRM_DESTROY      Set to 'yes' to skip confirmation
#
# Examples:
#   ./scripts/destroy.sh                    # Interactive teardown
#   ./scripts/destroy.sh --force            # Skip confirmation
#   ./scripts/destroy.sh --keep-secrets     # Keep secrets
#   ./scripts/destroy.sh -n web-os-staging  # Different namespace

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
K8S_DIR="${ROOT_DIR}/k8s"

# Default values
NAMESPACE="${WEB_OS_NAMESPACE:-web-os}"
KEEP_SECRETS="${KEEP_SECRETS:-false}"
KEEP_NAMESPACE="${KEEP_NAMESPACE:-false}"
FORCE="${FORCE:-false}"
VERBOSE="${VERBOSE:-false}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =============================================================================
# Helper Functions
# =============================================================================

log() {
  local level="${1}"
  local message="${2}"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  case "${level}" in
    error)   echo -e "${RED}[ERROR]${NC} ${message}" >&2 ;;
    warn)    echo -e "${YELLOW}[WARN]${NC} ${message}" ;;
    info)    echo -e "${BLUE}[INFO]${NC} ${message}" ;;
    success) echo -e "${GREEN}[OK]${NC} ${message}" ;;
    debug)   [[ "${VERBOSE}" == "true" ]] && echo -e "[DEBUG] ${message}" ;;
  esac
}

show_help() {
  sed -n '/^# Usage:/,/^$/p' "${BASH_SOURCE[0]}" | sed '1d;$d'
  exit 0
}

require_command() {
  local cmd="${1}"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    log error "Required command not found: ${cmd}"
    exit 1
  fi
}

confirm() {
  local message="${1}"
  local response
  
  if [[ "${FORCE}" == "true" ]] || [[ "${CONFIRM_DESTROY:-}" == "yes" ]]; then
    return 0
  fi
  
  echo ""
  echo -e "${YELLOW}⚠️  WARNING: ${message}${NC}"
  echo ""
  read -r -p "Are you sure? Type 'yes' to confirm: " response
  
  if [[ "${response}" != "yes" ]]; then
    log info "Aborted by user"
    exit 0
  fi
}

# =============================================================================
# Kubernetes Functions
# =============================================================================

get_resources() {
  log info "Listing Web OS resources in namespace '${NAMESPACE}'..."
  
  echo ""
  echo "Deployments:"
  kubectl get deployments -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os 2>/dev/null || true
  
  echo ""
  echo "Pods:"
  kubectl get pods -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os 2>/dev/null || true
  
  echo ""
  echo "Services:"
  kubectl get svc -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os 2>/dev/null || true
  
  echo ""
  echo "Ingress:"
  kubectl get ingress -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os 2>/dev/null || true
  
  echo ""
  echo "Secrets:"
  kubectl get secrets -n "${NAMESPACE}" 2>/dev/null || true
  
  echo ""
  echo "ConfigMaps:"
  kubectl get configmaps -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os 2>/dev/null || true
  
  echo ""
  echo "HPAs:"
  kubectl get hpa -n "${NAMESPACE}" 2>/dev/null || true
}

delete_manifests() {
  log info "Deleting Kubernetes manifests..."
  
  local manifests=(
    "servicemonitor.yaml"
    "gateway-ingress.yaml"
    "api-hpa.yaml"
    "api-service.yaml"
    "api-deployment.yaml"
    "pod-service.yaml"
    "pod-template.yaml"
    "pod-ingress.template.yaml"
  )
  
  for manifest in "${manifests[@]}"; do
    local path="${K8S_DIR}/${manifest}"
    if [[ -f "${path}" ]]; then
      log debug "Deleting ${manifest}"
      kubectl delete -f "${path}" --ignore-not-found=true -n "${NAMESPACE}" 2>/dev/null || true
    fi
  done
  
  log success "Manifests deleted"
}

delete_secrets() {
  if [[ "${KEEP_SECRETS}" == "true" ]]; then
    log info "Preserving secrets (--keep-secrets specified)"
    return
  fi
  
  log info "Deleting secrets..."
  
  local secrets=(
    "llm-api-keys"
    "session-secret"
    "github-oauth"
    "owner-wallet-keys"
  )
  
  for secret in "${secrets[@]}"; do
    kubectl delete secret "${secret}" -n "${NAMESPACE}" --ignore-not-found=true 2>/dev/null || true
  done
  
  log success "Secrets deleted"
}

delete_configmaps() {
  log info "Deleting ConfigMaps..."
  
  kubectl delete configmap -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os --ignore-not-found=true 2>/dev/null || true
  
  log success "ConfigMaps deleted"
}

delete_persistent_volumes() {
  log info "Checking for persistent volumes..."
  
  local pvc_count
  pvc_count=$(kubectl get pvc -n "${NAMESPACE}" --no-headers 2>/dev/null | wc -l || echo "0")
  
  if [[ "${pvc_count}" -gt 0 ]]; then
    log warn "Found ${pvc_count} PersistentVolumeClaims in namespace"
    echo ""
    kubectl get pvc -n "${NAMESPACE}"
    echo ""
    
    confirm "This will delete all PersistentVolumeClaims and their data!"
    
    kubectl delete pvc -n "${NAMESPACE}" --all 2>/dev/null || true
    log success "PersistentVolumeClaims deleted"
  else
    log info "No PersistentVolumeClaims found"
  fi
}

delete_namespace() {
  if [[ "${KEEP_NAMESPACE}" == "true" ]]; then
    log info "Preserving namespace (--keep-namespace specified)"
    return
  fi
  
  log info "Deleting namespace '${NAMESPACE}'..."
  
  # Final check before namespace deletion
  local remaining
  remaining=$(kubectl get all -n "${NAMESPACE}" --no-headers 2>/dev/null | wc -l || echo "0")
  
  if [[ "${remaining}" -gt 0 ]]; then
    log warn "Found ${remaining} remaining resources in namespace"
    kubectl get all -n "${NAMESPACE}"
  fi
  
  kubectl delete namespace "${NAMESPACE}" --ignore-not-found=true 2>/dev/null || true
  
  log success "Namespace deleted"
}

# =============================================================================
# Kind/Minikube Cleanup
# =============================================================================

cleanup_kind_cluster() {
  local cluster_name
  cluster_name="${KIND_CLUSTER_NAME:-web-os}"
  
  if command -v kind >/dev/null 2>&1; then
    if kind get clusters 2>/dev/null | grep -q "^${cluster_name}$"; then
      confirm "This will delete the Kind cluster '${cluster_name}'"
      kind delete cluster --name "${cluster_name}"
      log success "Kind cluster '${cluster_name}' deleted"
    fi
  fi
}

cleanup_minikube_cluster() {
  local profile
  profile="${MINIKUBE_PROFILE:-web-os}"
  
  if command -v minikube >/dev/null 2>&1; then
    if minikube profile list 2>/dev/null | grep -q "${profile}"; then
      confirm "This will delete the Minikube cluster '${profile}'"
      minikube delete --profile "${profile}"
      log success "Minikube cluster '${profile}' deleted"
    fi
  fi
}

# =============================================================================
# Main
# =============================================================================

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "${1}" in
      -n|--namespace)
        NAMESPACE="${2}"
        shift 2
        ;;
      -k|--keep-secrets)
        KEEP_SECRETS="true"
        shift
        ;;
      --keep-namespace)
        KEEP_NAMESPACE="true"
        shift
        ;;
      -f|--force)
        FORCE="true"
        shift
        ;;
      -v|--verbose)
        VERBOSE="true"
        shift
        ;;
      -h|--help)
        show_help
        ;;
      --kind)
        cleanup_kind_cluster
        exit 0
        ;;
      --minikube)
        cleanup_minikube_cluster
        exit 0
        ;;
      *)
        log error "Unknown option: ${1}"
        show_help
        ;;
    esac
  done
}

main() {
  parse_args "$@"
  
  log info "Web OS Teardown Script"
  log info "Namespace: ${NAMESPACE}"
  
  require_command kubectl
  
  # Check if namespace exists
  if ! kubectl get namespace "${NAMESPACE}" >/dev/null 2>&1; then
    log warn "Namespace '${NAMESPACE}' does not exist"
    exit 0
  fi
  
  # Show current state
  get_resources
  
  # Confirm destruction
  confirm "This will destroy all Web OS resources in namespace '${NAMESPACE}'"
  
  # Execute teardown
  delete_manifests
  delete_persistent_volumes
  delete_configmaps
  delete_secrets
  delete_namespace
  
  echo ""
  log success "Teardown completed successfully"
  echo ""
  echo "To recreate the deployment, run:"
  echo "  ./scripts/deploy.sh"
  echo ""
}

# Run main
main "$@"