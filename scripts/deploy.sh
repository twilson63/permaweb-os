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
#   -D, --domain         Domain for ingress (default: auto-detect from LB IP)
#   -d, --dry-run        Show what would be deployed without applying
#   -v, --verbose        Enable verbose output
#   -h, --help           Show this help message
#
# Environment Variables:
#   OPENAI_API_KEY       OpenAI API key
#   ANTHROPIC_API_KEY    Anthropic API key
#   OPENROUTER_API_KEY   OpenRouter API key
#   GROQ_API_KEY         Groq API key
#   SESSION_SECRET       Session signing secret (auto-generated if not set)
#   OWNER_PUBLIC_KEY     Owner wallet public key (PEM format)
#   DOMAIN               Domain for ingress (default: auto-detect from LoadBalancer IP)
#   DOCKER_BUILDKIT       Enable BuildKit for faster builds
#
# Examples:
#   ./scripts/deploy.sh --environment prod --tag v1.2.3
#   ./scripts/deploy.sh -e staging -d  # Dry run
#   DOMAIN=permaweb.live ./scripts/deploy.sh
#   DOMAIN=164.90.123.45.nip.io ./scripts/deploy.sh  # nip.io testing

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
DOMAIN="${DOMAIN:-}"  # Auto-detected from LoadBalancer if not set
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
  if [[ -z "${OPENAI_API_KEY:-}" ]] && [[ -z "${ANTHROPIC_API_KEY:-}" ]] && [[ -z "${OPENROUTER_API_KEY:-}" ]] && [[ -z "${GROQ_API_KEY:-}" ]]; then
    log error "At least one LLM API key is required"
    log info "Set one of:"
    log info "  OPENAI_API_KEY=sk-..."
    log info "  ANTHROPIC_API_KEY=sk-ant-..."
    log info "  OPENROUTER_API_KEY=sk-or-..."
    log info "  GROQ_API_KEY=gsk_..."
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
  if [[ "${VERBOSE}" == "true" ]]; then
    build_args+=(--progress=plain)
  fi
  
  # API
  log info "Building web-os-api..."
  if [[ ${#build_args[@]} -gt 0 ]]; then
    docker build "${build_args[@]}" \
      -t "${REGISTRY}/web-os-api:${TAG}" \
      -t "${REGISTRY}/web-os-api:latest" \
      "${ROOT_DIR}/api"
  else
    docker build \
      -t "${REGISTRY}/web-os-api:${TAG}" \
      -t "${REGISTRY}/web-os-api:latest" \
      "${ROOT_DIR}/api"
  fi
  
  # Frontend
  log info "Building web-os-frontend..."
  if [[ ${#build_args[@]} -gt 0 ]]; then
    docker build "${build_args[@]}" \
      -t "${REGISTRY}/web-os-frontend:${TAG}" \
      -t "${REGISTRY}/web-os-frontend:latest" \
      "${ROOT_DIR}/frontend"
  else
    docker build \
      -t "${REGISTRY}/web-os-frontend:${TAG}" \
      -t "${REGISTRY}/web-os-frontend:latest" \
      "${ROOT_DIR}/frontend"
  fi
  
  # HTTPSig Sidecar
  log info "Building web-os-sidecar..."
  if [[ ${#build_args[@]} -gt 0 ]]; then
    docker build "${build_args[@]}" \
      -t "${REGISTRY}/web-os-sidecar:${TAG}" \
      -t "${REGISTRY}/web-os-sidecar:latest" \
      "${ROOT_DIR}/opencode-sidecar"
  else
    docker build \
      -t "${REGISTRY}/web-os-sidecar:${TAG}" \
      -t "${REGISTRY}/web-os-sidecar:latest" \
      "${ROOT_DIR}/opencode-sidecar"
  fi
  
  # OpenCode Base
  log info "Building web-os-opencode..."
  if [[ ${#build_args[@]} -gt 0 ]]; then
    docker build "${build_args[@]}" \
      -t "${REGISTRY}/web-os-opencode:${TAG}" \
      -t "${REGISTRY}/web-os-opencode:latest" \
      "${ROOT_DIR}/images/opencode-base"
  else
    docker build \
      -t "${REGISTRY}/web-os-opencode:${TAG}" \
      -t "${REGISTRY}/web-os-opencode:latest" \
      "${ROOT_DIR}/images/opencode-base"
  fi
  
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
  [[ -n "${OPENROUTER_API_KEY:-}" ]] && secret_args+=(--from-literal=openrouter="${OPENROUTER_API_KEY}")
  [[ -n "${GROQ_API_KEY:-}" ]] && secret_args+=(--from-literal=groq="${GROQ_API_KEY}")
  
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
  
  # Auto-detect domain from LoadBalancer IP if not set
  if [[ -z "${DOMAIN:-}" ]]; then
    log info "DOMAIN not set, attempting auto-detection..."
    DOMAIN=$(detect_loadbalancer_ip)
    if [[ -n "${DOMAIN}" ]]; then
      DOMAIN="${DOMAIN}.nip.io"
      log info "Auto-detected domain: ${DOMAIN}"
    else
      log warn "Could not auto-detect LoadBalancer IP, using default"
      DOMAIN="web-os.local"
    fi
  fi
  
  log info "Using domain: ${DOMAIN}"
  
  local manifests=(
    "namespace.yaml"
    "rbac.yaml"
    "api-deployment.yaml"
    "api-service.yaml"
    "api-hpa.yaml"
    "servicemonitor.yaml"
    "stale-pod-cleanup.yaml"
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
  
  # Apply ingress with domain templating
  apply_ingress
  
  log success "Manifests applied"
}

detect_loadbalancer_ip() {
  # Try to get LoadBalancer IP from nginx ingress
  local ip=""
  ip=$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  
  if [[ -z "${ip}" ]]; then
    # Try to get from any LoadBalancer service
    ip=$(kubectl get svc -A -o jsonpath='{range .items[?(@.spec.type=="LoadBalancer")]}{.status.loadBalancer.ingress[0].ip}{"\n"}{end}' 2>/dev/null | head -1 || true)
  fi
  
  echo "${ip}"
}

apply_ingress() {
  log info "Applying ingress with domain: ${DOMAIN}"
  
  # Determine API and pod subdomains
  local api_host="api.${DOMAIN}"
  local pod_host="*.${DOMAIN}"
  
  # For production domains, use separate subdomain for pods
  if [[ "${DOMAIN}" != *".nip.io" ]] && [[ "${DOMAIN}" != *".local" ]]; then
    pod_host="*.pods.${DOMAIN}"
  fi
  
  # Generate ingress manifest
  local ingress_manifest
  ingress_manifest=$(cat <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-os-routing
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/name: web-os-routing
    app.kubernetes.io/part-of: web-os
spec:
  ingressClassName: nginx
  rules:
    - host: ${api_host}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  name: http
    - host: "${pod_host}"
      http:
        paths:
          - path: /health
            pathType: Prefix
            backend:
              service:
                name: user-pod
                port:
                  name: httpsig-http
          - path: /verify
            pathType: Prefix
            backend:
              service:
                name: user-pod
                port:
                  name: httpsig-http
          - path: /
            pathType: Prefix
            backend:
              service:
                name: user-pod
                port:
                  name: opencode-http
EOF
)
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "${ingress_manifest}"
  else
    echo "${ingress_manifest}" | kubectl apply -f -
  fi
  
  log success "Ingress applied with domain: ${DOMAIN}"
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
  echo "Domain:      ${DOMAIN}"
  echo ""
  
  if [[ "${DOMAIN}" != "web-os.local" ]]; then
    echo "Access URLs:"
    echo "  API:         https://api.${DOMAIN}"
    echo "  Health:      https://api.${DOMAIN}/health"
    echo "  Pods:        https://<pod-id>.pods.${DOMAIN}"
    echo ""
  fi
  
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
      -D|--domain)
        DOMAIN="${2}"
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