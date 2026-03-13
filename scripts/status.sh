#!/usr/bin/env bash
#
# Web OS Status Check Script
# Comprehensive health check for Web OS deployment
#
# Usage:
#   ./scripts/status.sh [OPTIONS]
#
# Options:
#   -n, --namespace      Kubernetes namespace [default: web-os]
#   -w, --watch          Continuously watch status (like watch -n 5)
#   -j, --json           Output as JSON
#   -q, --quiet          Only show errors
#   -v, --verbose        Show detailed information
#   -h, --help           Show this help message
#
# Examples:
#   ./scripts/status.sh                 # Basic status check
#   ./scripts/status.sh --watch         # Continuous monitoring
#   ./scripts/status.sh --json          # JSON output for CI/CD
#   ./scripts/status.sh -n web-os-staging

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default values
NAMESPACE="${WEB_OS_NAMESPACE:-web-os}"
WATCH="${WATCH:-false}"
JSON_OUTPUT="${JSON_OUTPUT:-false}"
QUIET="${QUIET:-false}"
VERBOSE="${VERBOSE:-false}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Health check results (for JSON output)
declare -A HEALTH_RESULTS

# =============================================================================
# Helper Functions
# =============================================================================

log() {
  local level="${1}"
  local message="${2}"

  [[ "${QUIET}" == "true" && "${level}" != "error" ]] && return

  case "${level}" in
    error)   echo -e "${RED}[ERROR]${NC} ${message}" >&2 ;;
    warn)    echo -e "${YELLOW}[WARN]${NC} ${message}" ;;
    info)    [[ "${JSON_OUTPUT}" != "true" ]] && echo -e "${BLUE}[INFO]${NC} ${message}" ;;
    success) [[ "${JSON_OUTPUT}" != "true" ]] && echo -e "${GREEN}[OK]${NC} ${message}" ;;
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

check_command() {
  local cmd="${1}"
  local label="${2:-${cmd}}"
  
  if command -v "${cmd}" >/dev/null 2>&1; then
    HEALTH_RESULTS["${label}"]="healthy"
    return 0
  else
    HEALTH_RESULTS["${label}"]="missing"
    return 1
  fi
}

# =============================================================================
# Kubernetes Checks
# =============================================================================

check_cluster_connection() {
  log info "Checking Kubernetes cluster connection..."
  
  if kubectl cluster-info >/dev/null 2>&1; then
    local cluster_version
    cluster_version=$(kubectl version --short 2>/dev/null | grep -E "^Server Version" | awk '{print $3}' || echo "unknown")
    HEALTH_RESULTS["kubernetes"]="healthy"
    HEALTH_RESULTS["cluster_version"]="${cluster_version}"
    log success "Connected to Kubernetes cluster (${cluster_version})"
    return 0
  else
    HEALTH_RESULTS["kubernetes"]="unhealthy"
    log error "Cannot connect to Kubernetes cluster"
    return 1
  fi
}

check_namespace() {
  log info "Checking namespace '${NAMESPACE}'..."
  
  if kubectl get namespace "${NAMESPACE}" >/dev/null 2>&1; then
    HEALTH_RESULTS["namespace"]="exists"
    log success "Namespace '${NAMESPACE}' exists"
    return 0
  else
    HEALTH_RESULTS["namespace"]="missing"
    log error "Namespace '${NAMESPACE}' not found"
    return 1
  fi
}

check_deployments() {
  log info "Checking deployments..."
  
  local deployments
  deployments=$(kubectl get deployments -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os -o json 2>/dev/null || echo '{"items":[]}')
  
  local deployment_count
  deployment_count=$(echo "${deployments}" | jq -r '.items | length' 2>/dev/null || echo "0")
  
  if [[ "${deployment_count}" -eq 0 ]]; then
    HEALTH_RESULTS["deployments"]="none"
    log warn "No deployments found"
    return 1
  fi
  
  local ready_count=0
  local total_replicas=0
  local unavailable=""
  
  for deployment in $(echo "${deployments}" | jq -r '.items[].metadata.name' 2>/dev/null); do
    local ready
    local desired
    ready=$(kubectl get deployment "${deployment}" -n "${NAMESPACE}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
    desired=$(kubectl get deployment "${deployment}" -n "${NAMESPACE}" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
    
    total_replicas=$((total_replicas + desired))
    ready_count=$((ready_count + ready))
    
    if [[ "${ready}" -lt "${desired}" ]]; then
      unavailable="${deployment}"
    fi
  done
  
  if [[ "${ready_count}" -ge "${total_replicas}" && -z "${unavailable}" ]]; then
    HEALTH_RESULTS["deployments"]="healthy"
    log success "All deployments ready (${ready_count}/${total_replicas} replicas)"
    return 0
  else
    HEALTH_RESULTS["deployments"]="degraded"
    log warn "Deployments not fully ready (${ready_count}/${total_replicas} replicas)"
    [[ -n "${unavailable}" ]] && log warn "Unavailable: ${unavailable}"
    return 1
  fi
}

check_pods() {
  log info "Checking pods..."
  
  local pods
  pods=$(kubectl get pods -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os --no-headers 2>/dev/null || true)
  
  if [[ -z "${pods}" ]]; then
    HEALTH_RESULTS["pods"]="none"
    log warn "No pods found"
    return 1
  fi
  
  local total=0
  local running=0
  local pending=0
  local failed=0
  
  while IFS= read -r line; do
    total=$((total + 1))
    local status
    status=$(echo "${line}" | awk '{print $3}')
    
    case "${status}" in
      Running) running=$((running + 1)) ;;
      Pending) pending=$((pending + 1)) ;;
      Failed|Error|CrashLoopBackOff|ImagePullBackOff) failed=$((failed + 1)) ;;
    esac
  done <<< "${pods}"
  
  if [[ "${failed}" -gt 0 ]]; then
    HEALTH_RESULTS["pods"]="failed"
    log error "Found ${failed} failed pod(s)"
    echo "${pods}" | grep -E "(Failed|Error|CrashLoopBackOff|ImagePullBackOff)" || true
    return 1
  elif [[ "${pending}" -gt 0 ]]; then
    HEALTH_RESULTS["pods"]="pending"
    log warn "Found ${pending} pending pod(s)"
    return 1
  elif [[ "${running}" -eq "${total}" ]]; then
    HEALTH_RESULTS["pods"]="healthy"
    log success "All pods running (${running}/${total})"
    return 0
  else
    HEALTH_RESULTS["pods"]="unknown"
    return 1
  fi
}

check_services() {
  log info "Checking services..."
  
  local services
  services=$(kubectl get svc -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os --no-headers 2>/dev/null || true)
  
  if [[ -z "${services}" ]]; then
    HEALTH_RESULTS["services"]="none"
    log warn "No services found"
    return 1
  fi
  
  local service_count
  service_count=$(echo "${services}" | wc -l | tr -d ' ')
  
  HEALTH_RESULTS["services"]="healthy"
  log success "Found ${service_count} service(s)"
  return 0
}

check_ingress() {
  log info "Checking ingress..."
  
  local ingress
  ingress=$(kubectl get ingress -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os --no-headers 2>/dev/null || true)
  
  if [[ -z "${ingress}" ]]; then
    HEALTH_RESULTS["ingress"]="none"
    log warn "No ingress found"
    return 1
  fi
  
  # Check if ingress has an address
  local address
  address=$(kubectl get ingress -n "${NAMESPACE}" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  
  if [[ -n "${address}" ]]; then
    HEALTH_RESULTS["ingress"]="healthy"
    HEALTH_RESULTS["ingress_address"]="${address}"
    log success "Ingress configured with address: ${address}"
    return 0
  else
    # Check for hostname
    local hostname
    hostname=$(kubectl get ingress -n "${NAMESPACE}" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
    
    if [[ -n "${hostname}" ]]; then
      HEALTH_RESULTS["ingress"]="healthy"
      HEALTH_RESULTS["ingress_hostname"]="${hostname}"
      log success "Ingress configured with hostname: ${hostname}"
      return 0
    else
      HEALTH_RESULTS["ingress"]="pending"
      log warn "Ingress exists but no address assigned yet"
      return 1
    fi
  fi
}

check_hpa() {
  log info "Checking HorizontalPodAutoscaler..."
  
  local hpa
  hpa=$(kubectl get hpa -n "${NAMESPACE}" --no-headers 2>/dev/null || true)
  
  if [[ -z "${hpa}" ]]; then
    HEALTH_RESULTS["hpa"]="none"
    log info "No HPA configured"
    return 0
  fi
  
  local hpa_count
  hpa_count=$(echo "${hpa}" | wc -l | tr -d ' ')
  
  HEALTH_RESULTS["hpa"]="configured"
  log success "HPA configured (${hpa_count} resource(s))"
  
  if [[ "${VERBOSE}" == "true" ]]; then
    echo "${hpa}"
  fi
  
  return 0
}

# =============================================================================
# Secret Checks
# =============================================================================

check_secrets() {
  log info "Checking required secrets..."
  
  local required_secrets=(
    "session-secret:session"
    "llm-api-keys:openai"
  )
  
  local missing=0
  
  for secret_def in "${required_secrets[@]}"; do
    local secret_name="${secret_def%%:*}"
    local key="${secret_def##*:}"
    
    if kubectl get secret "${secret_name}" -n "${NAMESPACE}" -o jsonpath="{.data.${key}}" 2>/dev/null | grep -q .; then
      log debug "Secret '${secret_name}' has key '${key}'"
    else
      log error "Missing secret: ${secret_name} (key: ${key})"
      HEALTH_RESULTS["secret_${secret_name}"]="missing"
      missing=$((missing + 1))
    fi
  done
  
  if [[ "${missing}" -eq 0 ]]; then
    HEALTH_RESULTS["secrets"]="healthy"
    log success "All required secrets configured"
    return 0
  else
    HEALTH_RESULTS["secrets"]="incomplete"
    return 1
  fi
}

# =============================================================================
# Health Endpoint Checks
# =============================================================================

check_health_endpoints() {
  log info "Checking health endpoints..."
  
  # Try to get API service ClusterIP
  local api_ip
  api_ip=$(kubectl get svc api -n "${NAMESPACE}" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)
  
  if [[ -z "${api_ip}" ]]; then
    HEALTH_RESULTS["health_endpoints"]="skipped"
    log warn "Cannot check health endpoints (no ClusterIP)"
    return 0
  fi
  
  local api_port=3000
  
  # Check API health
  local api_health
  api_health=$(kubectl run curl-test --rm --restart=Never --image=curlimages/curl:latest -- \
    curl -sf "http://${api_ip}:${api_port}/health" 2>/dev/null || true)
  
  if [[ "${api_health}" == *"ok"* ]]; then
    HEALTH_RESULTS["api_health"]="healthy"
    log success "API health endpoint responding"
  else
    HEALTH_RESULTS["api_health"]="unhealthy"
    log warn "API health endpoint not responding"
  fi
  
  return 0
}

# =============================================================================
# Resource Summary
# =============================================================================

show_resource_summary() {
  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    return
  fi
  
  echo ""
  echo -e "${BOLD}Resource Summary:${NC}"
  echo ""
  
  echo -e "${CYAN}Namespace:${NC} ${NAMESPACE}"
  echo ""
  
  # Deployments
  echo -e "${BOLD}Deployments:${NC}"
  kubectl get deployments -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os 2>/dev/null || echo "  None"
  echo ""
  
  # Pods
  echo -e "${BOLD}Pods:${NC}"
  kubectl get pods -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os 2>/dev/null || echo "  None"
  echo ""
  
  # Services
  echo -e "${BOLD}Services:${NC}"
  kubectl get svc -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os 2>/dev/null || echo "  None"
  echo ""
  
  # Ingress
  echo -e "${BOLD}Ingress:${NC}"
  kubectl get ingress -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os 2>/dev/null || echo "  None"
  echo ""
  
  # HPA
  echo -e "${BOLD}HPA:${NC}"
  kubectl get hpa -n "${NAMESPACE}" 2>/dev/null || echo "  None"
  echo ""
  
  # Events (last 5)
  echo -e "${BOLD}Recent Events:${NC}"
  kubectl get events -n "${NAMESPACE}" --sort-by='.lastTimestamp' 2>/dev/null | tail -5 || echo "  None"
  echo ""
}

# =============================================================================
# JSON Output
# =============================================================================

print_json_output() {
  local overall_status="healthy"
  
  # Determine overall status
  for key in "${!HEALTH_RESULTS[@]}"; do
    local value="${HEALTH_RESULTS[$key]}"
    if [[ "${value}" == "failed" || "${value}" == "unhealthy" || "${value}" == "missing" ]]; then
      overall_status="unhealthy"
      break
    elif [[ "${value}" == "degraded" || "${value}" == "pending" ]]; then
      overall_status="degraded"
    fi
  done
  
  # Build JSON
  echo "{"
  echo "  \"status\": \"${overall_status}\","
  echo "  \"namespace\": \"${NAMESPACE}\","
  echo "  \"timestamp\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\","
  echo "  \"checks\": {"
  
  local first=true
  for key in "${!HEALTH_RESULTS[@]}"; do
    if [[ "${first}" == "true" ]]; then
      first=false
    else
      echo ","
    fi
    printf "    \"%s\": \"%s\"" "${key}" "${HEALTH_RESULTS[$key]}"
  done
  
  echo ""
  echo "  },"
  
  # Pod counts
  local running_pods pending_pods failed_pods
  running_pods=$(kubectl get pods -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os --no-headers 2>/dev/null | grep -c "Running" || echo "0")
  pending_pods=$(kubectl get pods -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os --no-headers 2>/dev/null | grep -c "Pending" || echo "0")
  failed_pods=$(kubectl get pods -n "${NAMESPACE}" -l app.kubernetes.io/part-of=web-os --no-headers 2>/dev/null | grep -cE "(Failed|Error|CrashLoopBackOff)" || echo "0")
  
  echo "  \"pods\": {"
  echo "    \"running\": ${running_pods},"
  echo "    \"pending\": ${pending_pods},"
  echo "    \"failed\": ${failed_pods}"
  echo "  }"
  echo "}"
}

# =============================================================================
# Watch Mode
# =============================================================================

watch_status() {
  if ! command -v watch >/dev/null 2>&1; then
    log error "watch command not available (install with: apt-get install watch or brew install watch)"
    exit 1
  fi
  
  log info "Starting watch mode (refresh every 5 seconds, Ctrl+C to exit)..."
  watch -n 5 "${SCRIPT_DIR}/status.sh -n ${NAMESPACE}"
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
      -w|--watch)
        WATCH="true"
        shift
        ;;
      -j|--json)
        JSON_OUTPUT="true"
        shift
        ;;
      -q|--quiet)
        QUIET="true"
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
  
  require_command kubectl
  require_command jq
  
  if [[ "${WATCH}" == "true" ]]; then
    watch_status
    exit 0
  fi
  
  # Run checks
  local failed=0
  
  check_cluster_connection || failed=$((failed + 1))
  check_namespace || failed=$((failed + 1))
  check_secrets || failed=$((failed + 1))
  check_deployments || failed=$((failed + 1))
  check_pods || failed=$((failed + 1))
  check_services || failed=$((failed + 1))
  check_ingress || failed=$((failed + 1))
  check_hpa || failed=$((failed + 1))
  
  if [[ "${VERBOSE}" == "true" ]]; then
    check_health_endpoints || true
  fi
  
  # Show summary
  show_resource_summary
  
  # JSON output
  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    print_json_output
  fi
  
  # Exit code
  if [[ "${failed}" -gt 0 ]]; then
    log error "Health check failed (${failed} issue(s))"
    exit 1
  else
    log success "All checks passed"
    exit 0
  fi
}

# Run main
main "$@"