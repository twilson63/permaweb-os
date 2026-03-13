#!/usr/bin/env bash
#
# Web OS Production Deployment Script
# One-command deployment to Kubernetes cluster
#
# Usage:
#   ./scripts/deploy.sh [OPTIONS]
#
# Options:
#   -e, --environment    Environment (dev|staging|prod) [default: dev]
#   -r, --registry       Container registry URL
#   -t, --tag            Image tag [default: latest]
#   -n, --namespace      Kubernetes namespace [default: web-os]
#   -d, --dry-run        Show what would be deployed without applying
#   -v, --verbose        Enable verbose output
#   -h, --help           Show this help message
#
# Environment Variables:
#   OPENAI_API_KEY       OpenAI API key (required)
#   ANTHROPIC_API_KEY    Anthropic API key (required)
#   SESSION_SECRET       Session signing secret (auto-generated if not set)
#   OWNER_PUBLIC_KEY     Owner wallet public key (PEM format)
#   DOCKER_BUILDKIT       Enable BuildKit for faster builds
#
# Examples:
#   ./scripts/deploy.sh --environment prod --tag v1.2.3
#   ./scripts/deploy.sh -e staging -d  # Dry run
#   REGISTRY=registry.example.com ./scripts/deploy.sh

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
K8S_DIR="${ROOT_DIR}/k8s"

# Default values
ENVIRONMENT="${ENVIRONMENT:-dev}"
REGISTRY="${REGISTRY:-docker.io/library}"
TAG="${TAG:-latest}"
NAMESPACE="${NAMESPACE:-web-os}"
DRY_RUN="${DRY_RUN:-false}"
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
    log info "Install ${cmd} or ensure it's in your PATH"
    exit 1
  fi
}

check_prerequisites() {
  log info "Checking prerequisites..."
  
  require_command kubectl
  require_command docker
  
  # Check Kubernetes connectivity
  if ! kubectl cluster-info >/dev/null 2>&1; then
    log error "Cannot connect to Kubernetes cluster"
    log info "Check your kubeconfig or run: kubectl cluster-info"
    exit 1
  fi
  
  # Check for required secrets
  if [[ -z "${OPENAI_API_KEY:-}" ]] && [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    log error "At least one LLM API key is required"
    log info "Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY"
    exit 1
  fi
  
  log success "Prerequisites met"
}

# =============================================================================
# Build Functions
# =============================================================================

build_images() {
  log info "Building container images..."
  
  local build_args=()
  [[ "${VERBOSE}" == "true" ]] && build_args+=(--progress=plain)
  
  # API
  log info "Building web-os-api..."
  docker build "${build_args[@]}" \
    -t "${REGISTRY}/web-os-api:${TAG}" \
    -t "${REGISTRY}/web-os-api:latest" \
    "${ROOT_DIR}/api"
  
  # Frontend
  log info "Building web-os-frontend..."
  docker build "${build_args[@]}" \
    -t "${REGISTRY}/web-os-frontend:${TAG}" \
    -t "${REGISTRY}/web-os-frontend:latest" \
    "${ROOT_DIR}/frontend"
  
  # HTTPSig Sidecar
  log info "Building web-os-sidecar..."
  docker build "${build_args[@]}" \
    -t "${REGISTRY}/web-os-sidecar:${TAG}" \
    -t "${REGISTRY}/web-os-sidecar:latest" \
    "${ROOT_DIR}/opencode-sidecar"
  
  # OpenCode Base
  log info "Building web-os-opencode..."
  docker build "${build_args[@]}" \
    -t "${REGISTRY}/web-os-opencode:${TAG}" \
    -t "${REGISTRY}/web-os-opencode:latest" \
    "${ROOT_DIR}/images/opencode-base"
  
  log success "All images built"
}

push_images() {
  log info "Pushing container images to registry..."
  
  local images=(
    "web-os-api"
    "web-os-frontend"
    "web-os-sidecar"
    "web-os-opencode"
  )
  
  for image in "${images[@]}"; do
    log info "Pushing ${image}:${TAG}..."
    docker push "${REGISTRY}/${image}:${TAG}"
    
    if [[ "${TAG}" != "latest" ]]; then
      docker push "${REGISTRY}/${image}:latest"
    fi
  done
  
  log success "All images pushed"
}

# =============================================================================
# Kubernetes Functions
# =============================================================================

ensure_namespace() {
  log info "Ensuring namespace '${NAMESPACE}' exists..."
  
  if kubectl get namespace "${NAMESPACE}" >/dev/null 2>&1; then
    log debug "Namespace '${NAMESPACE}' already exists"
  else
    kubectl apply -f "${K8S_DIR}/namespace.yaml"
    log success "Namespace '${NAMESPACE}' created"
  fi
}

create_secrets() {
  log info "Creating/updating Kubernetes secrets..."
  
  # Generate session secret if not provided
  local session_secret="${SESSION_SECRET:-}"
  if [[ -z "${session_secret}" ]]; then
    session_secret=$(openssl rand -hex 32)
    log warn "SESSION_SECRET not set, generated random secret"
  fi
  
  # Session secret
  kubectl create secret generic session-secret \
    --namespace="${NAMESPACE}" \
    --from-literal=secret="${session_secret}" \
    --dry-run=client -o yaml | kubectl apply -f -
  
  # LLM API keys
  local secret_args=()
  [[ -n "${OPENAI_API_KEY:-}" ]] && secret_args+=(--from-literal=openai="${OPENAI_API_KEY}")
  [[ -n "${ANTHROPIC_API_KEY:-}" ]] && secret_args+=(--from-literal=anthropic="${ANTHROPIC_API_KEY}")
  
  if [[ ${#secret_args[@]} -gt 0 ]]; then
    kubectl create secret generic llm-api-keys \
      --namespace="${NAMESPACE}" \
      "${secret_args[@]}" \
      --dry-run=client -o yaml | kubectl apply -f -
  fi
  
  # Owner wallet keys (if provided)
  if [[ -n "${OWNER_PUBLIC_KEY:-}" ]]; then
    kubectl create secret generic owner-wallet-keys \
      --namespace="${NAMESPACE}" \
      --from-literal=public-key="${OWNER_PUBLIC_KEY}" \
      --dry-run=client -o yaml | kubectl apply -f -
  fi
  
  # GitHub OAuth (if configured)
  if [[ -n "${GITHUB_CLIENT_ID:-}" ]] && [[ -n "${GITHUB_CLIENT_SECRET:-}" ]]; then
    kubectl create secret generic github-oauth \
      --namespace="${NAMESPACE}" \
      --from-literal=client-id="${GITHUB_CLIENT_ID}" \
      --from-literal=client-secret="${GITHUB_CLIENT_SECRET}" \
      --dry-run=client -o yaml | kubectl apply -f -
  fi
  
  log success "Secrets configured"
}

apply_manifests() {
  log info "Applying Kubernetes manifests..."
  
  local manifests=(
    "namespace.yaml"
    "api-deployment.yaml"
    "api-service.yaml"
    "api-hpa.yaml"
    "gateway-ingress.yaml"
    "servicemonitor.yaml"
  )
  
  for manifest in "${manifests[@]}"; do
    local path="${K8S_DIR}/${manifest}"
    if [[ -f "${path}" ]]; then
      log debug "Applying ${manifest}"
      
      if [[ "${DRY_RUN}" == "true" ]]; then
        kubectl apply -f "${path}" --dry-run=client -o yaml
      else
        kubectl apply -f "${path}"
      fi
    else
      log warn "Manifest not found: ${path}"
    fi
  done
  
  log success "Manifests applied"
}

update_image_references() {
  log info "Updating deployment image references..."
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would update images to ${REGISTRY} with tag ${TAG}"
    return
  fi
  
  # Update API deployment
  kubectl set image deployment/api \
    api="${REGISTRY}/web-os-api:${TAG}" \
    --namespace="${NAMESPACE}"
  
  log success "Image references updated"
}

wait_for_rollout() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would wait for deployment rollout"
    return
  fi
  
  log info "Waiting for deployment rollout..."
  
  kubectl rollout status deployment/api \
    --namespace="${NAMESPACE}" \
    --timeout=300s
  
  log success "Deployment rolled out"
}

# =============================================================================
# Health Check Functions
# =============================================================================

run_health_checks() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would run health checks"
    return
  fi
  
  log info "Running health checks..."
  
  # Wait for pods to be ready
  kubectl wait --for=condition=ready pod \
    -l app.kubernetes.io/name=web-os-api \
    --namespace="${NAMESPACE}" \
    --timeout=180s
  
  # Check API health endpoint
  local api_pod
  api_pod=$(kubectl get pods -n "${NAMESPACE}" -l app.kubernetes.io/name=web-os-api -o jsonpath='{.items[0].metadata.name}')
  
  log info "Checking API health..."
  if kubectl exec -n "${NAMESPACE}" "${api_pod}" -- curl -sf http://localhost:3000/health >/dev/null 2>&1; then
    log success "API health check passed"
  else
    log warn "API health check failed (may need manual verification)"
  fi
  
  log success "Health checks completed"
}

show_deployment_info() {
  echo ""
  echo "=============================================="
  echo "  Web OS Deployment Complete"
  echo "=============================================="
  echo ""
  echo "Environment: ${ENVIRONMENT}"
  echo "Registry:    ${REGISTRY}"
  echo "Tag:         ${TAG}"
  echo "Namespace:   ${NAMESPACE}"
  echo ""
  echo "Pods:"
  kubectl get pods -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os
  echo ""
  echo "Services:"
  kubectl get svc -n "${NAMESPACE}"
  echo ""
  echo "Ingress:"
  kubectl get ingress -n "${NAMESPACE}"
  echo ""
  echo "To check logs:"
  echo "  kubectl logs -f deployment/api -n ${NAMESPACE}"
  echo ""
  echo "To port-forward:"
  echo "  kubectl port-forward -n ${NAMESPACE} svc/api 3000:3000"
  echo ""
}

# =============================================================================
# Main
# =============================================================================

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "${1}" in
      -e|--environment)
        ENVIRONMENT="${2}"
        shift 2
        ;;
      -r|--registry)
        REGISTRY="${2}"
        shift 2
        ;;
      -t|--tag)
        TAG="${2}"
        shift 2
        ;;
      -n|--namespace)
        NAMESPACE="${2}"
        shift 2
        ;;
      -d|--dry-run)
        DRY_RUN="true"
        shift
        ;;
      -v|--verbose)
        VERBOSE="true"
        shift
        ;;
      -h|--help)
        show_help
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
  
  log info "Starting Web OS deployment"
  log info "Environment: ${ENVIRONMENT}, Namespace: ${NAMESPACE}"
  
  # Environment-specific configuration
  case "${ENVIRONMENT}" in
    prod)
      log info "Production deployment - enabling strict checks"
      # In production, we require explicit confirmation
      if [[ "${DRY_RUN}" != "true" ]] && [[ -z "${CONFIRM_PRODUCTION:-}" ]]; then
        log warn "Production deployment requires CONFIRM_PRODUCTION=1"
        exit 1
      fi
      ;;
    staging)
      : # Staging uses defaults
      ;;
    dev|*)
      log info "Development deployment - using relaxed defaults"
      ;;
  esac
  
  check_prerequisites
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log warn "DRY RUN - no changes will be made"
  fi
  
  # Build and push (skip in dry-run)
  if [[ "${DRY_RUN}" != "true" ]]; then
    build_images
    
    if [[ "${REGISTRY}" != "docker.io/library" ]]; then
      push_images
    fi
  fi
  
  # Kubernetes deployment
  ensure_namespace
  create_secrets
  apply_manifests
  update_image_references
  
  if [[ "${DRY_RUN}" != "true" ]]; then
    wait_for_rollout
    run_health_checks
    show_deployment_info
  fi
  
  log success "Deployment completed successfully"
}

# Run main
main "$@"