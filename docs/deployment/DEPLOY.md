# Web OS - DigitalOcean Deployment Guide

This guide walks you through deploying Web OS to DigitalOcean Kubernetes (DOKS).

## Prerequisites

- DigitalOcean account
- Domain name (e.g., `permaweb.live`)
- `doctl` CLI installed
- `kubectl` installed
- Docker installed locally

## 1. Set Up DigitalOcean CLI

```bash
# Install doctl (macOS)
brew install doctl

# Authenticate
doctl auth init

# Verify
doctl account get
```

## 2. Create Kubernetes Cluster

```bash
# Create a 3-node cluster (recommended for production)
doctl kubernetes cluster create web-os \
  --region nyc1 \
  --node-pool "name=default;size=s-2vcpu-4gb;count=3" \
  --auto-upgrade

# Get kubeconfig
doctl kubernetes cluster kubeconfig save web-os

# Verify
kubectl get nodes
```

## 3. Create Container Registry

```bash
# Create container registry
doctl registry create web-os-registry

# Configure kubectl to use registry
doctl registry kubernetes-manifest | kubectl apply -f -

# Authenticate Docker
doctl registry login
```

## 4. Set Up DNS

```bash
# Get cluster load balancer IP (created automatically)
kubectl get svc -A | grep LoadBalancer

# Or create a dedicated load balancer
doctl compute load-balancer create web-os-lb \
  --region nyc1 \
  --forwarding-rules "entry-port:80,entry-protocol:http,target-port:30080,target-protocol:http" \
  --forwarding-rules "entry-port:443,entry-protocol:https,target-port:30443,target-protocol:https"
```

### Configure Domain DNS

In your domain registrar, add these records:

```
# A Records
@                    A      157.230.100.100  (load balancer IP)
api                  A      157.230.100.100
*.pods               A      157.230.100.100

# Or use DigitalOcean DNS
doctl compute domain create permaweb.live
doctl compute domain records create permaweb.live --record-type A --record-name "@" --record-data 157.230.100.100
doctl compute domain records create permaweb.live --record-type A --record-name "api" --record-data 157.230.100.100
doctl compute domain records create permaweb.live --record-type A --record-name "*.pods" --record-data 157.230.100.100
```

## 5. Install Cert-Manager (TLS)

```bash
# Add Jetstack Helm repo
helm repo add jetstack https://charts.jetstack.io
helm repo update

# Install cert-manager
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true

# Create Let's Encrypt issuer
cat <<EOF | kubectl apply -f -
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

## 6. Install NGINX Ingress

```bash
# Add NGINX ingress Helm repo
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

# Install NGINX ingress
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/do-loadbalancer-enable-proxy-protocol"=true
```

## 7. Build and Push Images

```bash
# Set your registry
export REGISTRY=registry.digitalocean.com/web-os-registry

# Build images
cd web-os

# Build API image
docker build -t $REGISTRY/web-os-api:latest ./api
docker push $REGISTRY/web-os-api:latest

# Build Frontend image
docker build -t $REGISTRY/web-os-frontend:latest ./frontend
docker push $REGISTRY/web-os-frontend:latest

# Build HTTPSig Sidecar image
docker build -t $REGISTRY/web-os-sidecar:latest ./opencode-sidecar
docker push $REGISTRY/web-os-sidecar:latest

# Build OpenCode base image
docker build -t $REGISTRY/web-os-opencode:latest ./images/opencode-base
docker push $REGISTRY/web-os-opencode:latest
```

## 8. Create Namespace and RBAC

```bash
# Create namespace
kubectl create namespace web-os

# Apply RBAC configuration (service account, role, role binding, network policies)
kubectl apply -f k8s/rbac.yaml
```

## 9. Multi-Tenant Secret Management

Web OS uses **per-wallet secret isolation** for LLM API keys. Each wallet gets its own Kubernetes secret, ensuring users can only access their own keys.

### 9.1 Secret Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         API Layer                            │
│ 1. User registers LLM key → Create wallet-scoped secret     │
│ 2. User creates pod → API creates pod with owner's secret    │
│ 3. Pod mounts ONLY the owner's secret                        │
└─────────────────────────────────────────────────────────────┘

Secret naming: llm-keys-<SHA256(wallet-address)[:16]>
Example: llm-keys-a1b2c3d4e5f67890
```

### 9.2 Register LLM Keys (Per Wallet)

**Option A: Via API (Recommended)**

```bash
# Get session token first (see wallet auth docs)
SESSION_TOKEN="your-session-token"

# Register OpenAI key
curl -X POST https://api.your-domain.com/api/llm/keys \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider": "openai", "apiKey": "sk-your-openai-key"}'

# Register Anthropic key
curl -X POST https://api.your-domain.com/api/llm/keys \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider": "anthropic", "apiKey": "sk-ant-your-key"}'

# Register Groq key
curl -X POST https://api.your-domain.com/api/llm/keys \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider": "groq", "apiKey": "gsk_your-key"}'
```

**Option B: Via kubectl (Development/Testing)**

```bash
# Calculate wallet hash
WALLET="0x1234567890abcdef"
WALLET_HASH=$(echo -n "$WALLET" | tr '[:upper:]' '[:lower:]' | sha256sum | head -c 16)
SECRET_NAME="llm-keys-$WALLET_HASH"

# Create wallet-scoped secret
kubectl create secret generic $SECRET_NAME \
  --namespace web-os \
  --from-literal=openai=sk-your-openai-key \
  --from-literal=anthropic=sk-ant-your-anthropic-key
```

### 9.3 Fallback: Global Secret (Deprecated)

For backward compatibility, you can create a global secret. This is **not recommended** for multi-tenant deployments.

```bash
# DEPRECATED: Creates a global secret accessible to all users
kubectl create secret generic llm-api-keys \
  --namespace web-os \
  --from-literal=openai=sk-your-openai-key \
  --from-literal=anthropic=sk-ant-your-anthropic-key
```

### 9.4 Security Guararantees

| Feature | Status |
|---------|--------|
| Wallet-scoped secrets | ✅ Implemented |
| Secret name derived from wallet hash | ✅ SHA256[:16] |
| Pod mounts only owner's secret | ✅ Enforced |
| RBAC limits API to llm-keys-* | ✅ Configured |
| Network policies isolate pods | ✅ Configured |

### 9.5 Other Secrets

```bash
# Create GitHub OAuth secret
kubectl create secret generic github-oauth \
  --namespace web-os \
  --from-literal=client-id=your-github-client-id \
  --from-literal=client-secret=your-github-client-secret

# Create session secret
kubectl create secret generic session-secret \
  --namespace web-os \
  --from-literal=secret=$(openssl rand -hex 32)
```

## 9. Deploy Components

### 9.1 API Deployment

```yaml
# k8s/api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: web-os
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
      - name: api
        image: registry.digitalocean.com/web-os-registry/web-os-api:latest
        ports:
        - containerPort: 3000
        env:
        - name: PORT
          value: "3000"
        - name: SESSION_SECRET
          valueFrom:
            secretKeyRef:
              name: session-secret
              key: secret
        - name: GITHUB_CLIENT_ID
          valueFrom:
            secretKeyRef:
              name: github-oauth
              key: client-id
        - name: GITHUB_CLIENT_SECRET
          valueFrom:
            secretKeyRef:
              name: github-oauth
              key: client-secret
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: web-os
spec:
  selector:
    app: api
  ports:
  - port: 80
    targetPort: 3000
```

```bash
kubectl apply -f k8s/api-deployment.yaml
```

### 9.2 Frontend Deployment

```yaml
# k8s/frontend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: web-os
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: frontend
        image: registry.digitalocean.com/web-os-registry/web-os-frontend:latest
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: web-os
spec:
  selector:
    app: frontend
  ports:
  - port: 80
    targetPort: 80
```

```bash
kubectl apply -f k8s/frontend-deployment.yaml
```

### 9.3 Pod Template (for user pods)

```yaml
# k8s/pod-template.yaml
apiVersion: v1
kind: Pod
metadata:
  name: user-pod-template
  namespace: web-os
  labels:
    app: user-pod
spec:
  restartPolicy: Always
  securityContext:
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
  volumes:
  - name: home-opencode
    emptyDir: {}
  - name: llm-secrets
    secret:
      secretName: llm-api-keys
  containers:
  # HTTPSig Sidecar
  - name: sidecar
    image: registry.digitalocean.com/web-os-registry/web-os-sidecar:latest
    ports:
    - containerPort: 3001
      name: sidecar
    env:
    - name: PORT
      value: "3001"
    - name: OWNER_KEY_ID
      valueFrom:
        fieldRef:
          fieldPath: metadata.labels['owner-wallet']
    - name: OWNER_PUBLIC_KEY_PEM
      valueFrom:
        secretKeyRef:
          name: pod-owner-keys
          key: public-key
    resources:
      requests:
        cpu: 50m
        memory: 64Mi
      limits:
        cpu: 200m
        memory: 256Mi
  # OpenCode
  - name: opencode
    image: registry.digitalocean.com/web-os-registry/web-os-opencode:latest
    ports:
    - containerPort: 4096
      name: opencode
    volumeMounts:
    - name: home-opencode
      mountPath: /home/opencode
    - name: llm-secrets
      mountPath: /secrets/llm
      readOnly: true
    env:
    - name: OPENCODE_HOST
      value: "0.0.0.0"
    - name: OPENCODE_PORT
      value: "4096"
    resources:
      requests:
        cpu: 500m
        memory: 1Gi
      limits:
        cpu: 2000m
        memory: 4Gi
```

## 10. Create Ingress

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-os-ingress
  namespace: web-os
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  tls:
  - hosts:
    - permaweb.live
    - api.permaweb.live
    - "*.pods.permaweb.live"
    secretName: web-os-tls
  rules:
  # Main site
  - host: permaweb.live
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend
            port:
              number: 80
  # API
  - host: api.permaweb.live
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api
            port:
              number: 80
  # User pods (wildcard)
  - host: "*.pods.permaweb.live"
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: user-pod
            port:
              number: 3001
```

```bash
kubectl apply -f k8s/ingress.yaml
```

## 11. Verify Deployment

```bash
# Check all pods are running
kubectl get pods -n web-os

# Check services
kubectl get svc -n web-os

# Check ingress
kubectl get ingress -n web-os

# Check TLS certificate
kubectl get certificate -n web-os

# Test API health
curl https://api.permaweb.live/health

# Test frontend
curl https://permaweb.live/
```

## 12. Configure Auto-Scaling

```yaml
# k8s/api-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: web-os
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

```bash
kubectl apply -f k8s/api-hpa.yaml
```

## 13. Set Up Monitoring (Optional)

```bash
# Install Prometheus
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace

# Install Grafana dashboard for Web OS
kubectl apply -f k8s/grafana-dashboard.yaml
```

## 14. CI/CD Pipeline

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to DigitalOcean

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4

    - name: Install doctl
      uses: digitalocean/action-doctl@v2
      with:
        token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}

    - name: Log in to DO Container Registry
      run: doctl registry login --expiry-seconds 600

    - name: Build images
      run: |
        docker build -t registry.digitalocean.com/web-os-registry/web-os-api:${{ github.sha }} ./api
        docker build -t registry.digitalocean.com/web-os-registry/web-os-frontend:${{ github.sha }} ./frontend
        docker build -t registry.digitalocean.com/web-os-registry/web-os-sidecar:${{ github.sha }} ./opencode-sidecar

    - name: Push images
      run: |
        docker push registry.digitalocean.com/web-os-registry/web-os-api:${{ github.sha }}
        docker push registry.digitalocean.com/web-os-registry/web-os-frontend:${{ github.sha }}
        docker push registry.digitalocean.com/web-os-registry/web-os-sidecar:${{ github.sha }}

    - name: Update deployment
      run: |
        kubectl set image deployment/api api=registry.digitalocean.com/web-os-registry/web-os-api:${{ github.sha }} -n web-os
        kubectl set image deployment/frontend frontend=registry.digitalocean.com/web-os-registry/web-os-frontend:${{ github.sha }} -n web-os
        kubectl rollout status deployment/api -n web-os
        kubectl rollout status deployment/frontend -n web-os
```

## 15. Cost Estimate

| Resource | Size | Monthly Cost |
|----------|------|--------------|
| Kubernetes (3 nodes) | s-2vcpu-4gb | $72/mo |
| Load Balancer | - | $12/mo |
| Container Registry | Basic | $5/mo |
| DNS (optional) | - | Free |
| **Total** | | **~$89/mo** |

---

## Cluster Sizing Guide

### Recommended Node Types

For Permaweb OS, **CPU-Optimized nodes are recommended** over Basic or Memory-Optimized nodes:

| Tier | Node Type | vCPU | RAM | Monthly Cost | Max Pods | Cost/Pod |
|------|-----------|------|-----|--------------|----------|----------|
| **Recommended** | c-4vcpu-8gb | 4 | 8GB | $72 | 10 | $7.20 |
| **Recommended** | c-8vcpu-16gb | 8 | 16GB | $144 | 20 | $7.20 |
| Budget | s-4vcpu-8gb | 4 | 8GB | $48 | 8 | $6.00 |
| Development | s-2vcpu-4gb | 2 | 4GB | $24 | 3 | $8.00 |

**Why CPU-Optimized?**
- OpenCode is CPU-bound, not memory-bound
- Dedicated cores prevent noisy neighbor issues
- Consistent performance for LLM workloads
- Same cost/pod efficiency as larger nodes

### Cluster Sizing by Scale

| Scale | Node Pool | Min Nodes | Max Nodes | Concurrent Users | Monthly Cost |
|-------|-----------|-----------|-----------|------------------|--------------|
| Development | c-4vcpu-8gb | 2 | 5 | 10-20 | $161 |
| Small | c-4vcpu-8gb | 3 | 10 | 20-50 | $233 |
| Medium | c-8vcpu-16gb | 5 | 15 | 50-200 | $757 |
| Large | c-8vcpu-16gb | 10 | 30 | 200-500 | $1,457 |
| Enterprise | c-8vcpu-16gb | 15 | 50 | 500-1000 | $2,197 |

### Quick Sizing Calculator

Use the cluster calculator for specific recommendations:

```bash
# For 100 concurrent users
deno run --allow-net scripts/cluster-calculator.ts 100

# Compare all node types
deno run --allow-net scripts/cluster-calculator.ts --compare

# Interactive mode
deno run --allow-net scripts/cluster-calculator.ts --interactive
```

### Resource Requirements

**User Pod (OpenCode + HTTPSig Sidecar):**
- CPU Request: 350m (250m OpenCode + 100m sidecar)
- CPU Limit: 1500m (1000m OpenCode + 500m sidecar)
- Memory Request: 640Mi (512Mi + 128Mi)
- Memory Limit: 2560Mi (2048Mi + 512Mi)

**API Pod:**
- CPU Request: 100m
- CPU Limit: 500m
- Memory Request: 128Mi
- Memory Limit: 512Mi

**System Overhead (~560m CPU, ~512Mi RAM per node):**
- CoreDNS, metrics-server, CSI driver, CNI, kube-proxy

### Cost Optimization Tips

1. **Right-size pod requests** - Actual usage is typically 40-60% of requests
2. **Enable cluster autoscaler** - Scale down during low usage
3. **Terminate idle pods** - Set 30-minute idle timeout for user pods
4. **Use multiple node pools** - Separate API and user workloads
5. **Monitor actual usage** - Adjust requests based on real metrics

For detailed analysis, see:
- [docs/cost-analysis.md](docs/cost-analysis.md) - Full cost breakdown
- [docs/scaling-strategy.md](docs/scaling-strategy.md) - Scaling recommendations

## Troubleshooting

### Pods not starting

```bash
# Check pod events
kubectl describe pod <pod-name> -n web-os

# Check logs
kubectl logs <pod-name> -n web-os

# Check image pull secrets
kubectl get secrets -n web-os
```

### Ingress not working

```bash
# Check ingress controller
kubectl get pods -n ingress-nginx

# Check ingress events
kubectl describe ingress web-os-ingress -n web-os

# Check cert-manager logs
kubectl logs -n cert-manager -l app=cert-manager
```

### DNS not resolving

```bash
# Check DNS propagation
dig permaweb.live
dig api.permaweb.live

# Check load balancer
doctl compute load-balancer list
```

## Next Steps

1. Set up monitoring alerts
2. Configure log aggregation
3. Set up backup for persistent volumes
4. Implement rate limiting
5. Add WAF (Web Application Firewall)

## Monitoring & Metrics

### Prometheus Metrics Endpoints

Web OS exposes Prometheus-compatible metrics endpoints:

| Service | Port | Path | Description |
|---------|------|------|-------------|
| API | 3000 | `/metrics` | Main API metrics |
| OpenCode Sidecar | 3001 | `/metrics` | HTTPSig verification metrics |

### Available Metrics

#### API Metrics (webos_*)

| Metric | Type | Description |
|--------|------|-------------|
| `webos_pods_total` | Gauge | Total pods managed |
| `webos_pods_by_status` | Gauge | Pods by phase (running/pending/failed) |
| `webos_http_requests_total` | Counter | HTTP requests by method/path/status |
| `webos_http_request_duration_seconds` | Histogram | Request latency |
| `webos_auth_attempts_total` | Counter | Auth attempts by type (wallet/github) |
| `webos_auth_failures_total` | Counter | Auth failures by reason |
| `webos_tokens_used_total` | Counter | Tokens consumed by wallet/model |
| `webos_active_websockets` | Gauge | Active WebSocket connections |

#### Sidecar Metrics (webos_httpsig_*)

| Metric | Type | Description |
|--------|------|-------------|
| `webos_httpsig_verifications_total` | Counter | Signature verifications (success/failure) |
| `webos_httpsig_verification_duration_seconds` | Histogram | Verification latency |
| `webos_proxy_requests_total` | Counter | Proxied requests to OpenCode |
| `webos_replay_rejections_total` | Counter | Replayed requests rejected |

### Prometheus Operator Setup

If you're using Prometheus Operator (kube-prometheus-stack):

```bash
# Install kube-prometheus-stack
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace

# Apply ServiceMonitor and PrometheusRule
kubectl apply -f k8s/servicemonitor.yaml
```

### Manual Prometheus Scrape Config

If not using Prometheus Operator, add this to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'web-os-api'
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names:
            - web-os
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
        target_label: __address__
```

## Auto-Scaling

### HorizontalPodAutoscaler (HPA)

The API deployment supports auto-scaling based on:

1. **CPU Utilization** - Scale up when CPU > 70%
2. **Memory Utilization** - Scale up when memory > 80%

```bash
# Apply HPA configuration
kubectl apply -f k8s/api-hpa.yaml

# Check HPA status
kubectl get hpa -n web-os

# Watch HPA in action
kubectl describe hpa api-hpa -n web-os
```

### Custom Metrics (Optional)

For latency-based scaling, you need Prometheus Adapter:

```bash
# Install prometheus-adapter
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus-adapter prometheus-community/prometheus-adapter \
  --namespace monitoring \
  --set prometheus.url=http://prometheus-k8s.monitoring.svc.cluster.local:9090
```

Configure the adapter with a custom rule:

```yaml
# custom-metrics.yaml
rules:
  custom:
    - seriesQuery: 'webos_http_request_duration_seconds_bucket'
      resources:
        overrides:
          namespace: { resource: namespace }
          pod: { resource: pod }
      name:
        matches: "^(.*)_bucket"
        as: "${1}"
      metricsQuery: 'histogram_quantile(0.99, rate(<<.Series>>[5m]))'
```

### Pod Scaling Per User Demand

For dynamic user pod scaling, consider:

1. **Vertical Pod Autoscaler (VPA)** - For OpenCode workloads
2. **KEDA** - For event-driven scaling based on queue depth
3. **Cluster Autoscaler** - For node-level scaling

```bash
# Example: Install VPA
kubectl apply -f https://github.com/kubernetes/autoscaler/releases/latest/download/vertical-pod-autoscaler.yaml
```

### Grafana Dashboard

Import the Web OS dashboard for visualization:

```bash
# Port-forward Grafana
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80

# Import dashboard (dashboard JSON in k8s/grafana-dashboard.json)
# Access Grafana at http://localhost:3000
# Default credentials: admin/prom-operator
```

## Resources

- [DigitalOcean Kubernetes Docs](https://docs.digitalocean.com/products/kubernetes/)
- [Cert-Manager Docs](https://cert-manager.io/docs/)
- [NGINX Ingress Docs](https://kubernetes.github.io/ingress-nginx/)
- [Prometheus Operator Docs](https://prometheus-operator.dev/)
- [HorizontalPodAutoscaler Docs](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Web OS Architecture](./DESIGN.md)

---

## Production Deployment Quick Start

### One-Command Deploy

```bash
# Set required environment variables
export OPENAI_API_KEY="sk-your-openai-key"
export ANTHROPIC_API_KEY="sk-ant-your-anthropic-key"
export SESSION_SECRET="$(openssl rand -hex 32)"
export REGISTRY="registry.digitalocean.com/web-os-registry"

# Deploy to production
./scripts/deploy.sh --environment prod --tag v1.0.0

# Check status
./scripts/status.sh --verbose
```

### Deployment Scripts

| Script | Purpose |
|--------|---------|
| `scripts/deploy.sh` | One-command production deployment |
| `scripts/destroy.sh` | Clean teardown of all resources |
| `scripts/status.sh` | Health check and status reporting |
| `scripts/setup.sh` | Bootstrap local cluster (kind/minikube) |

### Script Options

```bash
# Deploy with options
./scripts/deploy.sh \
  --environment prod \
  --registry registry.digitalocean.com/web-os-registry \
  --tag v1.2.3 \
  --namespace web-os-prod

# Dry run (show what would be deployed)
./scripts/deploy.sh --dry-run

# Staging deployment
./scripts/deploy.sh --environment staging

# Destroy (with confirmation)
./scripts/destroy.sh

# Destroy (force, no confirmation)
./scripts/destroy.sh --force

# Status check with JSON output (for CI/CD)
./scripts/status.sh --json

# Continuous monitoring
./scripts/status.sh --watch
```

### Production Checklist

Before deploying to production:

#### Secrets & Configuration
- [ ] `SESSION_SECRET` - 32+ byte hex string (generated)
- [ ] `OPENAI_API_KEY` - OpenAI API key
- [ ] `ANTHROPIC_API_KEY` - Anthropic API key
- [ ] `OWNER_PUBLIC_KEY` - Wallet public key for HTTPSig verification
- [ ] `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` - GitHub OAuth (optional)

#### Infrastructure
- [ ] Kubernetes cluster running (v1.28+)
- [ ] Container registry configured and accessible
- [ ] DNS records pointing to load balancer
- [ ] TLS certificates (cert-manager + Let's Encrypt)
- [ ] NGINX Ingress Controller installed

#### Monitoring
- [ ] Prometheus Operator installed
- [ ] ServiceMonitor applied (`k8s/servicemonitor.yaml`)
- [ ] PrometheusRule applied (alerts)
- [ ] Grafana dashboard imported

#### Security
- [ ] All pods run as non-root (UID 1000)
- [ ] Resource limits configured for all containers
- [ ] Secrets not stored in git
- [ ] Network policies considered

### CI/CD Integration

GitHub Actions workflows are included:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push/PR | Lint, test, build images |
| `deploy.yml` | Manual or CI success | Deploy to Kubernetes |
| `destroy.yml` | Manual | Tear down deployment |

#### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `REGISTRY_URL` | Container registry URL |
| `REGISTRY_USERNAME` | Registry username |
| `REGISTRY_PASSWORD` | Registry password |
| `DIGITALOCEAN_ACCESS_TOKEN` | DigitalOcean API token |
| `DIGITALOCEAN_CLUSTER_ID` | Kubernetes cluster ID |
| `SESSION_SECRET` | Session signing secret |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID (optional) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret (optional) |

### Rollback

```bash
# Rollback to previous version
kubectl rollout undo deployment/api -n web-os

# Rollback to specific revision
kubectl rollout undo deployment/api -n web-os --to-revision=3

# View rollout history
kubectl rollout history deployment/api -n web-os
```

### Troubleshooting

#### Pods not starting
```bash
kubectl describe pod <pod-name> -n web-os
kubectl logs <pod-name> -n web-os --previous
kubectl top pods -n web-os
```

#### Ingress not working
```bash
kubectl get ingress -n web-os
kubectl logs -n ingress-nginx -l app.kubernetes.io/name=ingress-nginx
kubectl get certificate -n web-os
```

#### High resource usage
```bash
kubectl get hpa -n web-os
kubectl describe resourcequota -n web-os
kubectl describe nodes
```

---

**See also:** [Deployment Checklist](docs/deploy-checklist.md) for detailed pre-flight verification.