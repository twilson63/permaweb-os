#!/usr/bin/env bash
#
# DigitalOcean Cluster Creation Script
# Creates a new Kubernetes cluster for Permaweb OS
#
# Usage:
#   ./scripts/do-cluster-create.sh [OPTIONS]
#
# Options:
#   -n, --name           Cluster name [default: permaweb-os]
#   -r, --region         DO region [default: nyc1]
#   -s, --size           Node size [default: s-2vcpu-4gb]
#   -c, --count          Node count [default: 3]
#   -p, --project        DO project name [default: permaweb-os]
#   --ha                 Enable high availability (3 control plane nodes)
#   --auto-upgrade       Enable auto-upgrade
#   --dry-run            Show what would be created
#   -h, --help           Show this help
#
# Prerequisites:
#   - doctl CLI installed and authenticated
#   - DIGITALOCEAN_TOKEN set (or doctl auth init)
#
# Examples:
#   ./scripts/do-cluster-create.sh
#   ./scripts/do-cluster-create.sh --name prod-cluster --region sfo3 --size c-2vcpu-4gb
#   ./scripts/do-cluster-create.sh --ha --count 5

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Defaults
CLUSTER_NAME="${CLUSTER_NAME:-permaweb-os}"
REGION="${REGION:-nyc1}"
NODE_SIZE="${NODE_SIZE:-s-2vcpu-4gb}"
NODE_COUNT="${NODE_COUNT:-3}"
PROJECT_NAME="${PROJECT_NAME:-permaweb-os}"
HA="${HA:-false}"
AUTO_UPGRADE="${AUTO_UPGRADE:-true}"
DRY_RUN="${DRY_RUN:-false}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# =============================================================================
# Helper Functions
# =============================================================================

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
  
  if ! command -v doctl >/dev/null 2>&1; then
    log error "doctl CLI not found"
    log info "Install: brew install doctl"
    log info "Or visit: https://docs.digitalocean.com/reference/doctl/"
    exit 1
  fi
  
  # Check authentication
  if ! doctl account get >/dev/null 2>&1; then
    log error "doctl not authenticated"
    log info "Run: doctl auth init"
    log info "Or set DIGITALOCEAN_TOKEN environment variable"
    exit 1
  fi
  
  log success "Prerequisites met"
}

get_or_create_project() {
  local project_name="${1}"
  
  # Check if project exists
  local project_id
  project_id=$(doctl projects list 2>/dev/null | grep "${project_name}" | awk '{print $1}' || true)
  
  if [[ -n "${project_id}" ]]; then
    log info "Found existing project: ${project_name} (${project_id})"
    echo "${project_id}"
    return 0
  fi
  
  log info "Creating project: ${project_name}"
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would create project: ${project_name}"
    echo "dry-run-project-id"
    return 0
  fi
  
  # Create project and extract ID from output
  local output
  output=$(doctl projects create "${project_name}" \
    --description "Permaweb OS - Web-based operating system for AI agents" \
    2>&1)
  
  # Extract the UUID from the output
  project_id=$(echo "${output}" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1 || echo "default")
  
  log success "Created project: ${project_name} (${project_id})"
  echo "${project_id}"
}

create_cluster() {
  local cluster_name="${1}"
  local region="${2}"
  local size="${3}"
  local count="${4}"
  local ha="${5}"
  
  log info "Creating cluster: ${cluster_name}"
  log info "  Region: ${region}"
  log info "  Node size: ${size}"
  log info "  Node count: ${count}"
  log info "  HA: ${ha}"
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would create cluster with above parameters"
    echo "dry-run-cluster-id"
    return 0
  fi
  
  local ha_flag=""
  if [[ "${ha}" == "true" ]]; then
    ha_flag="--ha"
  fi
  
  local auto_upgrade_flag=""
  if [[ "${AUTO_UPGRADE}" == "true" ]]; then
    auto_upgrade_flag="--auto-upgrade"
  fi
  
  # Create cluster and capture output
  local output
  output=$(doctl kubernetes cluster create "${cluster_name}" \
    --region "${region}" \
    --size "${size}" \
    --count "${count}" \
    ${ha_flag} \
    ${auto_upgrade_flag} \
    2>&1)
  
  # Extract cluster ID from output
  local cluster_id
  cluster_id=$(echo "${output}" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1)
  
  if [[ -z "${cluster_id}" ]]; then
    log error "Failed to create cluster"
    log error "${output}"
    return 1
  fi
  
  log success "Created cluster: ${cluster_id}"
  echo "${cluster_id}"
}

assign_cluster_to_project() {
  local cluster_id="${1}"
  local project_id="${2}"
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would assign cluster ${cluster_id} to project ${project_id}"
    return 0
  fi
  
  log info "Assigning cluster to project..."
  doctl projects resources assign "${project_id}" \
    --resource "do:kubernetes:${cluster_id}" >/dev/null
  
  log success "Cluster assigned to project"
}

save_cluster_info() {
  local cluster_id="${1}"
  local cluster_name="${2}"
  local project_id="${3}"
  
  local info_file="${ROOT_DIR}/.cluster-info"
  
  cat > "${info_file}" <<EOF
# Permaweb OS Cluster Info
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
CLUSTER_ID="${cluster_id}"
CLUSTER_NAME="${cluster_name}"
PROJECT_ID="${project_id}"
PROJECT_NAME="${PROJECT_NAME}"
REGION="${REGION}"
NODE_SIZE="${NODE_SIZE}"
NODE_COUNT="${NODE_COUNT}"
EOF
  
  log success "Saved cluster info to .cluster-info"
}

get_kubeconfig() {
  local cluster_id="${1}"
  
  log info "Downloading kubeconfig..."
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would download kubeconfig for cluster ${cluster_id}"
    return 0
  fi
  
  doctl kubernetes cluster kubeconfig save "${cluster_id}"
  
  log success "Kubeconfig saved to ~/.kube/config"
}

show_cluster_info() {
  local cluster_id="${1}"
  
  echo ""
  echo "=============================================="
  echo "  Cluster Created Successfully"
  echo "=============================================="
  echo ""
  
  if [[ "${DRY_RUN}" != "true" ]]; then
    echo "Cluster:"
    doctl kubernetes cluster get "${cluster_id}"
    echo ""
    echo "Nodes:"
    kubectl get nodes
    echo ""
  fi
  
  echo "Next steps:"
  echo "  1. Install ingress controller:"
  echo "     ./scripts/do-setup-ingress.sh"
  echo ""
  echo "  2. Install cert-manager (for TLS):"
  echo "     ./scripts/do-setup-cert-manager.sh"
  echo ""
  echo "  3. Deploy Permaweb OS:"
  echo "     ./scripts/deploy.sh -e prod"
  echo ""
  echo "Cluster info saved to: .cluster-info"
}

# =============================================================================
# Main
# =============================================================================

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
      -s|--size)
        NODE_SIZE="${2}"
        shift 2
        ;;
      -c|--count)
        NODE_COUNT="${2}"
        shift 2
        ;;
      -p|--project)
        PROJECT_NAME="${2}"
        shift 2
        ;;
      --ha)
        HA="true"
        shift
        ;;
      --auto-upgrade)
        AUTO_UPGRADE="true"
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
  
  log info "Creating Permaweb OS Kubernetes cluster"
  log info "Name: ${CLUSTER_NAME}, Region: ${REGION}, Size: ${NODE_SIZE}x${NODE_COUNT}"
  
  check_prerequisites
  
  # Create or get project
  local project_id
  project_id=$(get_or_create_project "${PROJECT_NAME}")
  
  # Create cluster
  local cluster_id
  cluster_id=$(create_cluster "${CLUSTER_NAME}" "${REGION}" "${NODE_SIZE}" "${NODE_COUNT}" "${HA}")
  
  # Assign to project
  assign_cluster_to_project "${cluster_id}" "${project_id}"
  
  # Save cluster info
  save_cluster_info "${cluster_id}" "${CLUSTER_NAME}" "${project_id}"
  
  # Download kubeconfig
  get_kubeconfig "${cluster_id}"
  
  # Show info
  show_cluster_info "${cluster_id}"
  
  log success "Cluster creation complete"
}

main "$@"