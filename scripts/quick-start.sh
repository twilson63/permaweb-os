#!/usr/bin/env bash
#
# Permaweb OS Quick Start
# One command to create cluster and deploy
#
# Usage:
#   ./scripts/quick-start.sh [OPTIONS]
#
# Options:
#   -n, --name           Cluster name [default: permaweb-os]
#   -r, --region         DO region [default: nyc1]
#   -d, --domain         Domain for ingress (optional, uses nip.io if not set)
#   -e, --environment    Environment [default: prod]
#   --skip-cluster       Skip cluster creation (use existing)
#   --dry-run            Show what would be done
#   -h, --help           Show this help
#
# Prerequisites:
#   - doctl authenticated (run: doctl auth init)
#   - OPENAI_API_KEY and/or ANTHROPIC_API_KEY
#
# Examples:
#   ./scripts/quick-start.sh
#   ./scripts/quick-start.sh -d permaweb.live
#   ./scripts/quick-start.sh -r sfo3 -n my-permaweb

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Defaults
CLUSTER_NAME="${CLUSTER_NAME:-permaweb-os}"
REGION="${REGION:-nyc1}"
DOMAIN="${DOMAIN:-}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
SKIP_CLUSTER="${SKIP_CLUSTER:-false}"
DRY_RUN="${DRY_RUN:-false}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
  local level="${1}"
  local message="${2}"
  case "${level}" in
    error)   echo -e "${RED}[ERROR]${NC} ${message}" >&2 ;;
    warn)    echo -e "${YELLOW}[WARN]${NC} ${message}" ;;
    info)    echo -e "${BLUE}[INFO]${NC} ${message}" ;;
    success) echo -e "${GREEN}[OK]${NC} ${message}" ;;
  esac
}

show_help() {
  sed -n '/^# Usage:/,/^$/p' "${BASH_SOURCE[0]}" | sed '1d;$d'
  exit 0
}

check_prerequisites() {
  log info "Checking prerequisites..."
  
  local missing=()
  
  # Check doctl
  if ! command -v doctl >/dev/null 2>&1; then
    missing+=("doctl")
  fi
  
  # Check kubectl
  if ! command -v kubectl >/dev/null 2>&1; then
    missing+=("kubectl")
  fi
  
  # Check docker
  if ! command -v docker >/dev/null 2>&1; then
    missing+=("docker")
  fi
  
  if [[ ${#missing[@]} -gt 0 ]]; then
    log error "Missing prerequisites: ${missing[*]}"
    log info "Install with: brew install doctl kubectl docker"
    exit 1
  fi
  
  # Check doctl auth
  if ! doctl account get >/dev/null 2>&1; then
    log error "doctl not authenticated"
    log info "Run: doctl auth init"
    exit 1
  fi
  
  # Check API keys
  if [[ -z "${OPENAI_API_KEY:-}" ]] && [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    log error "Missing API keys"
    log info "Set: export OPENAI_API_KEY=sk-..."
    log info "Or: export ANTHROPIC_API_KEY=sk-ant-..."
    exit 1
  fi
  
  log success "Prerequisites met"
}

create_cluster() {
  log info "=== Step 1: Create Cluster ==="
  
  if [[ "${SKIP_CLUSTER}" == "true" ]]; then
    log info "Skipping cluster creation (--skip-cluster)"
    return 0
  fi
  
  local cmd="${SCRIPT_DIR}/do-cluster-create.sh"
  cmd+=" --name ${CLUSTER_NAME}"
  cmd+=" --region ${REGION}"
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    cmd+=" --dry-run"
  fi
  
  $cmd
}

setup_ingress() {
  log info "=== Step 2: Setup Ingress ==="
  
  local cmd="${SCRIPT_DIR}/do-setup-ingress.sh"
  
  if [[ -n "${DOMAIN}" ]]; then
    cmd+=" --tls --domain ${DOMAIN}"
  fi
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    cmd+=" --dry-run"
  fi
  
  $cmd
}

build_images() {
  log info "=== Step 3: Build Images ==="
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would build Docker images"
    return 0
  fi
  
  # Build images using deploy script's build function
  "${SCRIPT_DIR}/deploy.sh" --dry-run -v 2>&1 | head -20 || true
  
  # Actually build
  log info "Building API..."
  docker build -t web-os-api:latest "${ROOT_DIR}/api"
  
  log info "Building Sidecar..."
  docker build -t web-os-sidecar:latest "${ROOT_DIR}/opencode-sidecar"
  
  log info "Building Frontend..."
  docker build -t web-os-frontend:latest "${ROOT_DIR}/frontend"
  
  log success "Images built"
}

push_to_registry() {
  log info "=== Step 4: Push to Registry ==="
  
  if [[ -z "${REGISTRY:-}" ]]; then
    log info "No REGISTRY set, skipping push (using local images)"
    return 0
  fi
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would push images to ${REGISTRY}"
    return 0
  fi
  
  local images=("web-os-api" "web-os-sidecar" "web-os-frontend")
  
  for image in "${images[@]}"; do
    docker tag "${image}:latest" "${REGISTRY}/${image}:latest"
    docker push "${REGISTRY}/${image}:latest"
  done
  
  log success "Images pushed to ${REGISTRY}"
}

deploy() {
  log info "=== Step 5: Deploy Permaweb OS ==="
  
  local cmd="${SCRIPT_DIR}/deploy.sh"
  cmd+=" --environment ${ENVIRONMENT}"
  
  if [[ -n "${DOMAIN}" ]]; then
    cmd+=" --domain ${DOMAIN}"
  fi
  
  if [[ -n "${REGISTRY:-}" ]]; then
    cmd+=" --registry ${REGISTRY}"
  fi
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    cmd+=" --dry-run"
  fi
  
  # Pass through environment variables
  export OPENAI_API_KEY="${OPENAI_API_KEY:-}"
  export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
  
  $cmd
}

show_summary() {
  local lb_ip=""
  local info_file="${ROOT_DIR}/.cluster-info"
  
  if [[ -f "${info_file}" ]]; then
    source "${info_file}"
    lb_ip="${LOADBALANCER_IP:-}"
  fi
  
  echo ""
  echo "=============================================="
  echo "  Permaweb OS Deployed!"
  echo "=============================================="
  echo ""
  echo "Cluster: ${CLUSTER_NAME}"
  echo "Region: ${REGION}"
  
  if [[ -n "${DOMAIN}" ]]; then
    echo "Domain: ${DOMAIN}"
    echo ""
    echo "Access URLs:"
    echo "  API:    https://api.${DOMAIN}"
    echo "  Health: https://api.${DOMAIN}/health"
    echo "  Pods:   https://<pod-id>.pods.${DOMAIN}"
  elif [[ -n "${lb_ip}" ]]; then
    echo "Domain: ${lb_ip}.nip.io"
    echo ""
    echo "Access URLs:"
    echo "  API:    http://api.${lb_ip}.nip.io"
    echo "  Health: http://api.${lb_ip}.nip.io/health"
    echo "  Pods:   http://<pod-id>.pods.${lb_ip}.nip.io"
  fi
  
  echo ""
  echo "Useful Commands:"
  echo "  Check status:  ./scripts/status.sh"
  echo "  View logs:     kubectl logs -f deployment/api -n web-os"
  echo "  Destroy:       ./scripts/do-cluster-destroy.sh"
  echo ""
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "${1}" in
      -n|--name)
        CLUSTER_NAME="${2}"
        shift 2
        ;;
      -r|--region)
        REGION="${2}"
        shift 2
        ;;
      -d|--domain)
        DOMAIN="${2}"
        shift 2
        ;;
      -e|--environment)
        ENVIRONMENT="${2}"
        shift 2
        ;;
      --skip-cluster)
        SKIP_CLUSTER="true"
        shift
        ;;
      --dry-run)
        DRY_RUN="true"
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
  
  echo ""
  echo "=============================================="
  echo "  Permaweb OS Quick Start"
  echo "=============================================="
  echo ""
  echo "This will:"
  echo "  1. Create a Kubernetes cluster on DigitalOcean"
  echo "  2. Setup NGINX ingress with LoadBalancer"
  echo "  3. Build Docker images"
  echo "  4. Deploy Permaweb OS"
  echo ""
  
  if [[ "${DRY_RUN}" != "true" ]]; then
    read -p "Continue? (y/N): " confirm
    if [[ "${confirm}" != "y" ]] && [[ "${confirm}" != "Y" ]]; then
      log info "Cancelled"
      exit 0
    fi
  fi
  
  check_prerequisites
  create_cluster
  setup_ingress
  build_images
  push_to_registry
  deploy
  show_summary
  
  log success "Quick start complete!"
}

main "$@"