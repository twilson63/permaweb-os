#!/usr/bin/env bash
#
# DigitalOcean Cluster Destruction
# Destroys the Permaweb OS Kubernetes cluster
#
# Usage:
#   ./scripts/do-cluster-destroy.sh [OPTIONS]
#
# Options:
#   -n, --name           Cluster name to destroy
#   -f, --force          Skip confirmation
#   --dry-run            Show what would be destroyed
#   -h, --help           Show this help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Defaults
CLUSTER_NAME="${CLUSTER_NAME:-}"
FORCE="${FORCE:-false}"
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
  if ! command -v doctl >/dev/null 2>&1; then
    log error "doctl CLI not found"
    exit 1
  fi
  
  if ! doctl account get >/dev/null 2>&1; then
    log error "doctl not authenticated"
    exit 1
  fi
}

get_cluster_info() {
  local info_file="${ROOT_DIR}/.cluster-info"
  
  if [[ -f "${info_file}" ]]; then
    source "${info_file}"
    CLUSTER_NAME="${CLUSTER_NAME:-${CLUSTER_ID:-}}"
  fi
  
  if [[ -z "${CLUSTER_NAME}" ]]; then
    log error "No cluster name specified and no .cluster-info file found"
    log info "Use: -n <cluster-name> to specify cluster"
    exit 1
  fi
}

get_cluster_id() {
  local name="${1}"
  doctl kubernetes cluster list --format ID,Name --no-header | \
    grep -E "\s+${name}$" | awk '{print $1}' || true
}

delete_cluster() {
  local cluster_id="${1}"
  local cluster_name="${2}"
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would delete cluster: ${cluster_name} (${cluster_id})"
    return 0
  fi
  
  log info "Deleting cluster: ${cluster_name} (${cluster_id})"
  doctl kubernetes cluster delete "${cluster_id}" --force
  
  log success "Cluster deleted"
}

delete_project() {
  local project_id="${1}"
  
  if [[ -z "${project_id}" ]]; then
    return 0
  fi
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would delete project: ${project_id}"
    return 0
  fi
  
  log info "Deleting project: ${project_id}"
  doctl projects delete "${project_id}" --force
  
  log success "Project deleted"
}

cleanup() {
  local info_file="${ROOT_DIR}/.cluster-info"
  
  if [[ -f "${info_file}" ]]; then
    rm "${info_file}"
    log success "Removed .cluster-info"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "${1}" in
      -n|--name)
        CLUSTER_NAME="${2}"
        shift 2
        ;;
      -f|--force)
        FORCE="true"
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
  
  check_prerequisites
  get_cluster_info
  
  local cluster_id
  cluster_id=$(get_cluster_id "${CLUSTER_NAME}")
  
  if [[ -z "${cluster_id}" ]]; then
    log error "Cluster not found: ${CLUSTER_NAME}"
    exit 1
  fi
  
  echo ""
  echo "=============================================="
  echo "  WARNING: This will destroy the cluster"
  echo "=============================================="
  echo ""
  echo "Cluster: ${CLUSTER_NAME}"
  echo "ID: ${cluster_id}"
  echo ""
  echo "All pods, services, and data will be lost!"
  echo ""
  
  if [[ "${FORCE}" != "true" ]] && [[ "${DRY_RUN}" != "true" ]]; then
    read -p "Are you sure? (y/N): " confirm
    if [[ "${confirm}" != "y" ]] && [[ "${confirm}" != "Y" ]]; then
      log info "Cancelled"
      exit 0
    fi
  fi
  
  # Get project ID from .cluster-info if available
  local project_id=""
  local info_file="${ROOT_DIR}/.cluster-info"
  if [[ -f "${info_file}" ]]; then
    source "${info_file}"
    project_id="${PROJECT_ID:-}"
  fi
  
  delete_cluster "${cluster_id}" "${CLUSTER_NAME}"
  
  # Optionally delete project (only if created by us)
  if [[ -n "${project_id}" ]]; then
    echo ""
    read -p "Delete DO project too? (y/N): " del_project
    if [[ "${del_project}" == "y" ]] || [[ "${del_project}" == "Y" ]]; then
      delete_project "${project_id}"
    fi
  fi
  
  cleanup
  
  log success "Cluster destruction complete"
}

main "$@"