#!/usr/bin/env bash
#
# DigitalOcean Ingress Setup
# Installs NGINX ingress controller with LoadBalancer
#
# Usage:
#   ./scripts/do-setup-ingress.sh [OPTIONS]
#
# Options:
#   --tls                 Enable TLS with cert-manager (requires domain)
#   -d, --domain          Domain for TLS certificate
#   --dry-run             Show what would be done
#   -h, --help            Show this help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Defaults
ENABLE_TLS="${ENABLE_TLS:-false}"
DOMAIN="${DOMAIN:-}"
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
  
  if ! command -v kubectl >/dev/null 2>&1; then
    log error "kubectl not found"
    exit 1
  fi
  
  if ! kubectl cluster-info >/dev/null 2>&1; then
    log error "Cannot connect to Kubernetes cluster"
    log info "Run: doctl kubernetes cluster kubeconfig save <cluster-id>"
    exit 1
  fi
  
  log success "Prerequisites met"
}

install_nginx_ingress() {
  log info "Installing NGINX ingress controller..."
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would install NGINX ingress controller"
    return 0
  fi
  
  # Add NGINX ingress repository
  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/do/deploy.yaml
  
  # Wait for ingress controller to be ready
  log info "Waiting for ingress controller..."
  kubectl wait --namespace ingress-nginx \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/component=controller \
    --timeout=300s
  
  log success "NGINX ingress controller installed"
}

get_loadbalancer_ip() {
  log info "Getting LoadBalancer IP..."
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "192.0.2.1"
    return 0
  fi
  
  local ip=""
  local retries=30
  
  for ((i=1; i<=retries; i++)); do
    ip=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
      -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
    
    if [[ -n "${ip}" ]]; then
      break
    fi
    
    log info "Waiting for LoadBalancer IP... (${i}/${retries})"
    sleep 5
  done
  
  if [[ -z "${ip}" ]]; then
    log warn "LoadBalancer IP not assigned yet"
    echo "pending"
    return 0
  fi
  
  log success "LoadBalancer IP: ${ip}"
  echo "${ip}"
}

save_loadbalancer_ip() {
  local ip="${1}"
  
  local info_file="${ROOT_DIR}/.cluster-info"
  
  if [[ -f "${info_file}" ]]; then
    echo "LOADBALANCER_IP=\"${ip}\"" >> "${info_file}"
  else
    cat > "${info_file}" <<EOF
# Permaweb OS Cluster Info
LOADBALANCER_IP="${ip}"
EOF
  fi
  
  log success "LoadBalancer IP saved to .cluster-info"
}

install_cert_manager() {
  log info "Installing cert-manager..."
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would install cert-manager"
    return 0
  fi
  
  # Install cert-manager
  kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
  
  # Wait for cert-manager to be ready
  kubectl wait --namespace cert-manager \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/instance=cert-manager \
    --timeout=300s
  
  log success "cert-manager installed"
}

create_wildcard_certificate() {
  local domain="${1}"
  
  log info "Creating wildcard certificate for *.${domain}..."
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    log info "Would create certificate for *.${domain}"
    return 0
  fi
  
  # Create namespace if not exists
  kubectl create namespace web-os --dry-run=client -o yaml | kubectl apply -f -
  
  # Create certificate issuer
  cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@${domain}
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
  
  # Create wildcard certificate
  cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: permaweb-wildcard
  namespace: web-os
spec:
  secretName: permaweb-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
  - "api.${domain}"
  - "*.${domain}"
EOF
  
  log success "Certificate created"
  log info "Note: DNS must be configured before certificate can be issued"
  log info "Point *.${domain} and api.${domain} to the LoadBalancer IP"
}

show_next_steps() {
  local lb_ip="${1}"
  
  echo ""
  echo "=============================================="
  echo "  Ingress Setup Complete"
  echo "=============================================="
  echo ""
  
  if [[ -n "${lb_ip}" ]] && [[ "${lb_ip}" != "pending" ]]; then
    echo "LoadBalancer IP: ${lb_ip}"
    echo ""
    echo "DNS Configuration:"
    echo "  api.permaweb.live    A    ${lb_ip}"
    echo "  *.permaweb.live      A    ${lb_ip}"
    echo ""
    if [[ "${lb_ip}" != "192.0.2.1" ]]; then
      echo "nip.io testing URLs:"
      echo "  API:    http://api.${lb_ip}.nip.io"
      echo "  Health: http://api.${lb_ip}.nip.io/health"
      echo ""
    fi
  fi
  
  echo "Next steps:"
  echo "  1. Configure DNS (or use nip.io for testing)"
  echo "  2. Deploy Permaweb OS:"
  echo "     DOMAIN=permaweb.live ./scripts/deploy.sh -e prod"
  echo ""
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "${1}" in
      --tls)
        ENABLE_TLS="true"
        shift
        ;;
      -d|--domain)
        DOMAIN="${2}"
        ENABLE_TLS="true"
        shift 2
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
  
  log info "Setting up ingress controller"
  
  check_prerequisites
  install_nginx_ingress
  
  local lb_ip
  lb_ip=$(get_loadbalancer_ip)
  save_loadbalancer_ip "${lb_ip}"
  
  if [[ "${ENABLE_TLS}" == "true" ]] && [[ -n "${DOMAIN}" ]]; then
    install_cert_manager
    create_wildcard_certificate "${DOMAIN}"
  fi
  
  show_next_steps "${lb_ip}"
  
  log success "Ingress setup complete"
}

main "$@"