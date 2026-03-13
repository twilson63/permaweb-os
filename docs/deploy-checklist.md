# Web OS Deployment Checklist

Complete pre-flight checklist for production deployment.

## Prerequisites

### Required Tools
- [ ] `kubectl` 1.28+ installed and configured
- [ ] `docker` 20.10+ installed
- [ ] `helm` 3.x installed (for cert-manager, ingress-nginx)
- [ ] `doctl` CLI (for DigitalOcean) or equivalent cloud CLI
- [ ] `git` for version control

### Access Requirements
- [ ] Kubernetes cluster admin access
- [ ] Container registry write access
- [ ] DNS management access for domain
- [ ] SSL certificate management (or Let's Encrypt via cert-manager)

---

## 1. Environment Variables

### Required: API Service

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | API server port | No | `3000` |
| `SESSION_SECRET` | Session signing secret (32+ chars) | **Yes** | - |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | No | - |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret | No | - |
| `GITHUB_REDIRECT_URI` | GitHub OAuth callback URL | No | Auto-detected |
| `OPENCODE_BIN` | Path to OpenCode binary | No | `/Users/tron/.opencode/bin/opencode` |
| `USAGE_STORE_PATH` | Usage data file path | No | `./data/usage-store.json` |

### Required: HTTPSig Sidecar

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Sidecar server port | No | `3001` |
| `OWNER_KEY_ID` | Owner wallet key identifier | **Yes** | - |
| `OWNER_PUBLIC_KEY_PEM` | Owner public key (PEM format) | **Yes** | - |
| `OPENCODE_BIN` | Path to OpenCode binary | No | `/home/opencode/.opencode/bin/opencode` |
| `OPENCODE_MODEL` | Default model override | No | - |

### Required: OpenCode Container

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `OPENCODE_HOST` | Bind address | No | `0.0.0.0` |
| `OPENCODE_PORT` | Port | No | `4096` |

---

## 2. Secrets Management

### Create Kubernetes Secrets

```bash
# 1. Session secret (generate a strong random secret)
kubectl create secret generic session-secret \
  --namespace web-os \
  --from-literal=secret=$(openssl rand -hex 32)

# 2. LLM API keys
kubectl create secret generic llm-api-keys \
  --namespace web-os \
  --from-literal=openai=sk-your-openai-key \
  --from-literal=anthropic=sk-ant-your-anthropic-key

# 3. GitHub OAuth (optional)
kubectl create secret generic github-oauth \
  --namespace web-os \
  --from-literal=client-id=your-github-client-id \
  --from-literal=client-secret=your-github-client-secret

# 4. Owner wallet keys (for HTTPSig verification)
kubectl create secret generic owner-wallet-keys \
  --namespace web-os \
  --from-literal=public-key="$(cat public_key.pem)"
```

### Secrets Checklist

| Secret Name | Keys | Required | Notes |
|-------------|------|----------|-------|
| `session-secret` | `secret` | **Yes** | 32+ byte hex string |
| `llm-api-keys` | `openai`, `anthropic` | **Yes** | At least one provider |
| `github-oauth` | `client-id`, `client-secret` | No | For GitHub integration |
| `owner-wallet-keys` | `public-key` | **Yes** | For HTTPSig verification |

---

## 3. DNS Configuration

### Required DNS Records

```
# A Records (point to load balancer IP)
permaweb.live           A      <LOAD_BALANCER_IP>
api.permaweb.live       A      <LOAD_BALANCER_IP>

# Wildcard for user pods
*.pods.permaweb.live    A      <LOAD_BALANCER_IP>

# Optional: www redirect
www.permaweb.live       CNAME  permaweb.live
```

### DNS Checklist

- [ ] Root domain A record configured
- [ ] API subdomain A record configured
- [ ] Wildcard pods subdomain configured
- [ ] DNS propagation verified (`dig permaweb.live`)

---

## 4. SSL/TLS Certificates

### Option A: Let's Encrypt (Recommended)

```bash
# Install cert-manager
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true

# Create ClusterIssuer
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

### Option B: Custom Certificates

1. Obtain certificates from your CA
2. Create Kubernetes TLS secret:

```bash
kubectl create secret tls web-os-tls \
  --namespace web-os \
  --cert=path/to/cert.pem \
  --key=path/to/key.pem
```

### SSL Checklist

- [ ] cert-manager installed (for Let's Encrypt)
- [ ] ClusterIssuer created
- [ ] Certificate issuance verified
- [ ] TLS secret present in web-os namespace

---

## 5. Resource Quotas

### Recommended Resource Allocations

| Component | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-----------|-------------|-----------|----------------|--------------|
| API | 100m | 500m | 128Mi | 512Mi |
| Frontend | 50m | 200m | 32Mi | 128Mi |
| HTTPSig Sidecar | 100m | 500m | 128Mi | 512Mi |
| OpenCode | 250m | 1000m | 512Mi | 2Gi |
| NGINX Ingress | 100m | 200m | 64Mi | 128Mi |

### Cluster Sizing

| Scale | Nodes | Type | Concurrent Users | Monthly Cost |
|-------|-------|------|------------------|--------------|
| Development | 2 | c-4vcpu-8gb | 10-20 | ~$161 |
| Small | 3 | c-4vcpu-8gb | 20-50 | ~$233 |
| Medium | 5 | c-8vcpu-16gb | 50-200 | ~$757 |
| Large | 10 | c-8vcpu-16gb | 200-500 | ~$1,457 |

### Resource Quota Setup

```bash
# Apply resource quota to namespace
kubectl apply -f - <<EOF
apiVersion: v1
kind: ResourceQuota
metadata:
  name: web-os-quota
  namespace: web-os
spec:
  hard:
    requests.cpu: "4"
    requests.memory: "8Gi"
    limits.cpu: "16"
    limits.memory: "32Gi"
    pods: "50"
EOF
```

---

## 6. Pre-Deployment Verification

### Cluster Prerequisites

- [ ] Kubernetes cluster running (v1.28+)
- [ ] NGINX Ingress Controller installed
- [ ] cert-manager installed and configured
- [ ] Container registry configured and authenticated
- [ ] `web-os` namespace created

### Container Images

```bash
# Build and push images
export REGISTRY=registry.digitalocean.com/web-os-registry

docker build -t $REGISTRY/web-os-api:latest ./api
docker build -t $REGISTRY/web-os-frontend:latest ./frontend
docker build -t $REGISTRY/web-os-sidecar:latest ./opencode-sidecar
docker build -t $REGISTRY/web-os-opencode:latest ./images/opencode-base

docker push $REGISTRY/web-os-api:latest
docker push $REGISTRY/web-os-frontend:latest
docker push $REGISTRY/web-os-sidecar:latest
docker push $REGISTRY/web-os-opencode:latest
```

### Images Checklist

- [ ] API image built and pushed
- [ ] Frontend image built and pushed
- [ ] Sidecar image built and pushed
- [ ] OpenCode base image built and pushed
- [ ] All images tagged with version (not just `latest`)

---

## 7. Deployment Sequence

### Step-by-Step Deployment

```bash
# 1. Create namespace
kubectl apply -f k8s/namespace.yaml

# 2. Create secrets (see section 2)
# ... create secrets as documented above ...

# 3. Deploy API
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/api-service.yaml

# 4. Deploy ingress
kubectl apply -f k8s/gateway-ingress.yaml

# 5. Configure DNS
# ... wait for DNS propagation ...

# 6. Verify health
kubectl wait --for=condition=available --timeout=300s deployment/api -n web-os
curl https://api.permaweb.live/health

# 7. Deploy monitoring (optional)
kubectl apply -f k8s/servicemonitor.yaml
```

---

## 8. Post-Deployment Verification

### Health Checks

```bash
# API health
curl -s https://api.permaweb.live/health
# Expected: {"status":"ok"}

# API metrics
curl -s https://api.permaweb.live/metrics | grep webos_
# Expected: Prometheus metrics output

# Frontend
curl -s https://permaweb.live/ -I
# Expected: HTTP/2 200

# Ingress
kubectl get ingress -n web-os
# Expected: All hosts showing ADDRESS
```

### Verification Checklist

- [ ] API `/health` returns `{"status":"ok"}`
- [ ] API `/metrics` returns Prometheus metrics
- [ ] Frontend accessible at root domain
- [ ] Wildcard DNS resolves pod subdomains
- [ ] TLS certificate valid (no browser warnings)
- [ ] HPA configured and active
- [ ] Prometheus scraping metrics

---

## 9. Monitoring & Alerting

### Prometheus Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `webos_pods_total` | Gauge | Total pods managed |
| `webos_http_requests_total` | Counter | HTTP requests by method/path/status |
| `webos_auth_attempts_total` | Counter | Auth attempts by type |
| `webos_auth_failures_total` | Counter | Auth failures by reason |
| `webos_httpsig_verifications_total` | Counter | HTTPSig verifications |
| `webos_replay_rejections_total` | Counter | Replay attack rejections |

### Alerts Configured

- `WebOSHighErrorRate` - 5xx rate > 5%
- `WebOSHighAuthFailures` - Auth failures > 0.1/sec
- `WebOSSlowRequests` - P99 latency > 500ms
- `WebOSHighHTTPSigFailures` - HTTPSig failures > 0.05/sec
- `WebOSReplayAttacks` - Any replay attack detected
- `WebOSPodsAtCapacity` - > 50 active pods

### Monitoring Checklist

- [ ] Prometheus Operator installed
- [ ] ServiceMonitor applied
- [ ] PrometheusRule applied
- [ ] Grafana dashboard imported
- [ ] Alertmanager configured

---

## 10. Rollback Procedure

### Quick Rollback

```bash
# Rollback API to previous version
kubectl rollout undo deployment/api -n web-os

# Rollback to specific revision
kubectl rollout undo deployment/api -n web-os --to-revision=3

# Check rollout history
kubectl rollout history deployment/api -n web-os
```

### Full Rollback

```bash
# Use versioned deployment
kubectl apply -f k8s/api-deployment-v1.2.3.yaml

# Or change image tag
kubectl set image deployment/api \
  api=registry.digitalocean.com/web-os-registry/web-os-api:v1.2.3 \
  -n web-os
```

---

## 11. Security Hardening

### Container Security

- [ ] Running as non-root user (UID 1000)
- [ ] Read-only root filesystem where possible
- [ ] Dropped all Linux capabilities
- [ ] Seccomp profile enabled
- [ ] No privileged containers

### Network Security

- [ ] Network policies configured
- [ ] Ingress rate limiting enabled
- [ ] TLS 1.2+ required
- [ ] HSTS headers configured

### Secret Security

- [ ] Secrets not in git
- [ ] Secrets encrypted at rest (cloud KMS)
- [ ] Secret rotation policy defined
- [ ] No secrets in environment variables (use volumes)

---

## 12. Production Readiness Summary

### Critical Requirements (Must Have)

1. **Secrets**: All secrets created and configured
2. **DNS**: All DNS records pointing to load balancer
3. **TLS**: Valid certificates for all domains
4. **Images**: All container images pushed and accessible
5. **Health Checks**: `/health` endpoints responding
6. **Resource Limits**: All pods have CPU/memory limits

### Recommended Requirements (Should Have)

1. **HPA**: Auto-scaling configured
2. **Monitoring**: Prometheus/Grafana installed
3. **Alerting**: Critical alerts configured
4. **Backups**: Persistent volume backups scheduled
5. **Log Aggregation**: Centralized logging (Loki/ELK)
6. **Rate Limiting**: NGINX rate limits configured

### Nice to Have

1. **WAF**: Web Application Firewall
2. **CDN**: Static asset caching
3. **Multi-region**: Geographic redundancy
4. **DR Plan**: Disaster recovery documented

---

## Quick Reference Commands

```bash
# Check all pods
kubectl get pods -n web-os

# Check all services
kubectl get svc -n web-os

# Check ingress
kubectl get ingress -n web-os

# Check HPA status
kubectl get hpa -n web-os

# View API logs
kubectl logs -f deployment/api -n web-os

# Describe pod issues
kubectl describe pod <pod-name> -n web-os

# Port-forward for debugging
kubectl port-forward -n web-os svc/api 3000:3000

# Get cluster info
kubectl cluster-info
```

---

*Last updated: 2025-01-12*