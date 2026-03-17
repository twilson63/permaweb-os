# Infrastructure Deployment Guide

> Complete guide for deploying PermawebOS infrastructure with Kubernetes

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Cluster Setup](#cluster-setup)
4. [DNS & TLS](#dns--tls)
5. [Core Services](#core-services)
6. [Pod Architecture](#pod-architecture)
7. [Authentication Flow](#authentication-flow)
8. [Scaling & Monitoring](#scaling--monitoring)
9. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Internet Users                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        NGINX Ingress Controller                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │ api.permaweb.run│  │*.pods.permaweb. │  │  Wildcard TLS   │          │
│  │    (API)        │  │     run         │  │   (Let's Encrypt)│          │
│  └────────┬────────┘  └────────┬────────┘  └─────────────────┘          │
└───────────┼─────────────────────┼───────────────────────────────────────┘
            │                     │
            ▼                     ▼
┌───────────────────┐   ┌───────────────────────────────────────────────┐
│   API Service     │   │              Pod Services                      │
│  (ClusterIP)      │   │   (Dynamic per-user pod)                       │
│                   │   │                                                │
│ ┌───────────────┐ │   │ ┌─────────────┐  ┌─────────────────────────┐  │
│ │  API Server   │ │   │ │ Auth Proxy  │◄─┤ Enforces wallet ownership│  │
│ │  (Port 3000)  │ │   │ │ (Port 3001) │  │ - Browser: Session Cookie│  │
│ │               │ │   │ └──────┬──────┘  │ - API: Bearer Token     │  │
│ │ - Pod CRUD    │ │   │        │         │ - HTTPSig: Signed Req   │  │
│ │ - Auth Store  │ │   │        ▼         └─────────────────────────┘  │
│ │ - K8s Client  │ │   │ ┌─────────────┐                              │
│ └───────────────┘ │   │ │ OpenCode    │  (Port 4096)                  │
└───────────────────┘   │ │ Agent       │  - REST API                   │
                        │ └─────────────┘  - Session management          │
                        │                 - File operations               │
                        └───────────────────────────────────────────────┘
```

### Components

| Component | Port | Purpose |
|-----------|------|---------|
| **NGINX Ingress** | 80/443 | TLS termination, routing |
| **API Service** | 3000 | Pod CRUD, auth store, session management |
| **Auth Proxy** | 3001 | Wallet authentication, request proxying |
| **OpenCode Agent** | 4096 | Agent REST API, sessions, tools |

### DNS Structure

```
api.permaweb.run          → API Service (pod management)
<pod-id>.pods.permaweb.run → User pod (auth proxy + OpenCode)
```

---

## Prerequisites

### Required Tools

```bash
# Kubernetes
kubectl version --client  # v1.28+
helm version             # v3.12+

# DigitalOcean
doctl version            # v1.100+

# Docker
docker version           # v24+

# Arweave (optional, for testing)
npm install -g arweave-deploy
```

### Required Access

- DigitalOcean account with Kubernetes enabled
- Domain name (e.g., `permaweb.run`)
- API keys for LLM providers (OpenAI, Anthropic, etc.)
- Container registry (DigitalOcean or Docker Hub)

### Infrastructure Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| Nodes | 3 | 5+ |
| CPU per node | 2 vCPU | 4 vCPU |
| Memory per node | 4 GB | 8 GB |
| Storage per node | 50 GB | 100 GB SSD |

---

## Cluster Setup

### 1. Create Kubernetes Cluster

```bash
# Create cluster
doctl kubernetes cluster create permaweb-os \
  --region nyc1 \
  --node-pool "name=default;size=s-2vcpu-4gb;count=3;auto-scale=true;min-nodes=3;max-nodes=10" \
  --auto-upgrade

# Get kubeconfig
doctl kubernetes cluster kubeconfig save permaweb-os

# Verify
kubectl get nodes
```

### 2. Create Container Registry

```bash
# Create registry
doctl registry create permaweb-registry

# Configure cluster to use registry
doctl registry kubernetes-manifest | kubectl apply -f -

# Login Docker
doctl registry login
```

### 3. Create Namespace

```bash
kubectl apply -f k8s/namespace.yaml
```

### 4. Install NGINX Ingress

```bash
# Add NGINX Helm repo
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

# Install NGINX ingress
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/do-loadbalancer-enable-proxy-protocol"=true
```

### 5. Install Cert-Manager

```bash
# Add Jetstack Helm repo
helm repo add jetstack https://charts.jetstack.io
helm repo update

# Install cert-manager
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true
```

### 6. Create RBAC

```bash
kubectl apply -f k8s/rbac.yaml
```

---

## DNS & TLS

### 1. Configure DNS

```bash
# Get load balancer IP
LB_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

# Create DNS records (example with DigitalOcean)
doctl compute domain create permaweb.run --ip-address $LB_IP
doctl compute domain records create permaweb.run --record-type A --record-name "api" --record-data $LB_IP
doctl compute domain records create permaweb.run --record-type A --record-name "*.pods" --record-data $LB_IP
```

### 2. Create Wildcard TLS Certificate

```yaml
# k8s/wildcard-certificate.yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: pods-wildcard
  namespace: web-os
spec:
  secretName: pods-wildcard-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - "pods.permaweb.run"
    - "*.pods.permaweb.run"
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: api-cert
  namespace: web-os
spec:
  secretName: api-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - "api.permaweb.run"
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@permaweb.run
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
```

```bash
kubectl apply -f k8s/wildcard-certificate.yaml
```

---

## Core Services

### API Service

The main API handles pod lifecycle and authentication.

#### Deployment

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
      app.kubernetes.io/name: web-os-api
  template:
    spec:
      serviceAccountName: web-os-api
      containers:
        - name: api
          image: registry.digitalocean.com/permaweb-registry/web-os-api:latest
          ports:
            - containerPort: 3000
          env:
            - name: PORT
              value: "3000"
            - name: KUBERNETES_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
```

#### Service

```yaml
# k8s/api-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: web-os
spec:
  selector:
    app.kubernetes.io/name: web-os-api
  ports:
    - port: 80
      targetPort: 3000
      name: http
```

### Auth Proxy

Enforces wallet ownership for pod access.

#### Key Configuration

```typescript
// Environment variables
const PORT = process.env.AUTH_PORT || '3001';
const BACKEND_PORT = process.env.BACKEND_PORT || '4096';
const OWNER_WALLET = process.env.OWNER_WALLET;
const OWNER_KEY_ID = process.env.OWNER_KEY_ID;
const SESSION_DURATION_HOURS = 24;
```

#### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/auth/nonce` | POST | Generate challenge for signing |
| `/auth/verify` | POST | Verify signature, create session |
| `/auth/logout` | GET | Clear session |
| `/api/*` | ALL | Proxy to backend (if authenticated) |

### OpenCode Agent

The agent REST API for coding tasks.

#### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/session` | POST | Create session |
| `/session/:id/message` | POST | Send message (sync) |
| `/session/:id/prompt_async` | POST | Send message (async) |
| `/event` | GET | SSE stream |
| `/file/content` | GET | Read file |

---

## Pod Architecture

### Pod Template

Each user pod contains two containers:

1. **Auth Proxy** (port 3001) - Authentication layer
2. **OpenCode Agent** (port 4096) - Agent REST API

```yaml
# k8s/pod-template.yaml
apiVersion: v1
kind: Pod
metadata:
  name: user-pod
  namespace: web-os
  labels:
    pod-id: "{{POD_ID}}"
    owner-wallet: "{{OWNER_WALLET}}"
  annotations:
    owner-key-id: "{{OWNER_KEY_ID}}"
spec:
  volumes:
    - name: llm-secrets
      secret:
        secretName: {{LLM_SECRET_NAME}}
    - name: owner-key
      secret:
        secretName: {{OWNER_KEY_SECRET_NAME}}
  containers:
    - name: auth-proxy
      image: registry.digitalocean.com/permaweb-registry/web-os-auth-proxy:latest
      ports:
        - containerPort: 3001
      env:
        - name: OWNER_WALLET
          valueFrom:
            fieldRef:
              fieldPath: metadata.labels['owner-wallet']
        - name: OWNER_KEY_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.annotations['owner-key-id']
    - name: opencode
      image: registry.digitalocean.com/permaweb-registry/web-os-opencode:latest
      ports:
        - containerPort: 4096
      env:
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: {{LLM_SECRET_NAME}}
              key: openai
```

### Pod Creation Flow

```
1. User authenticates with wallet
2. API verifies signature
3. API creates Kubernetes secret (owner key)
4. API creates pod with:
   - Unique pod ID (UUID prefix)
   - Owner wallet label
   - Owner key secret mounted
5. NGINX routes subdomain to pod
6. Auth proxy enforces ownership
```

### Service & Ingress

```yaml
# k8s/pod-service.template.yaml
apiVersion: v1
kind: Service
metadata:
  name: pod-{{POD_ID}}
  namespace: web-os
spec:
  selector:
    pod-id: "{{POD_ID}}"
  ports:
    - port: 80
      targetPort: 3001  # Auth proxy
      name: auth-http
---
# k8s/pod-ingress.template.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: pod-{{POD_ID}}
  namespace: web-os
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/websocket-services: pod-{{POD_ID}}
spec:
  tls:
    - hosts:
        - "{{POD_ID}}.pods.permaweb.run"
      secretName: pods-wildcard-tls
  rules:
    - host: "{{POD_ID}}.pods.permaweb.run"
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: pod-{{POD_ID}}
                port:
                  name: auth-http
```

---

## Authentication Flow

### Browser Authentication (Session Cookie)

```
┌────────────┐     ┌────────────┐     ┌────────────┐
│   Browser  │     │ Auth Proxy │     │   Wallet   │
└─────┬──────┘     └─────┬──────┘     └─────┬──────┘
      │                  │                  │
      │ GET /            │                  │
      │─────────────────►│                  │
      │                  │                  │
      │ 302 /auth/login  │                  │
      │◄─────────────────│                  │
      │                  │                  │
      │ Connect Wallet   │                  │
      │─────────────────────────────────────►
      │                  │                  │
      │ POST /auth/nonce │                  │
      │─────────────────►│                  │
      │                  │                  │
      │ { nonce, message }                  │
      │◄─────────────────│                  │
      │                  │                  │
      │ Sign message     │                  │
      │─────────────────────────────────────►
      │                  │                  │
      │ { signature }    │                  │
      │─────────────────►│                  │
      │                  │                  │
      │ Verify signature │                  │
      │ (check owner)    │                  │
      │                  │                  │
      │ Set-Cookie: session                │
      │◄─────────────────│                  │
      │                  │                  │
      │ GET / (with cookie)                │
      │─────────────────►│                  │
      │                  │                  │
      │ Proxy to OpenCode (port 4096)      │
      │◄─────────────────│                  │
```

### API Authentication (Bearer Token)

```
┌────────────┐     ┌────────────┐     ┌────────────┐
│   Client   │     │ Auth Proxy │     │   API      │
└─────┬──────┘     └─────┬──────┘     └─────┬──────┘
      │                  │                  │
      │ Authorization: Bearer <token>       │
      │─────────────────►│                  │
      │                  │                  │
      │                  │ Validate token   │
      │                  │─────────────────►│
      │                  │                  │
      │                  │ { wallet }       │
      │                  │◄─────────────────│
      │                  │                  │
      │ (if wallet == owner)                │
      │ Proxy to OpenCode                   │
      │◄─────────────────│                  │
```

### HTTPSig Authentication

```
┌────────────┐     ┌────────────┐
│   Client   │     │ Auth Proxy │
└─────┬──────┘     └─────┬──────┘
      │                  │
      │ GET /api/...     │
      │ Signature: keyId="<key-id>"│
      │          headers="(request-target) date"│
      │          signature="<base64>"│
      │─────────────────►│
      │                  │
      │                  │ Verify signature
      │                  │ using public key
      │                  │ (mounted from secret)
      │                  │
      │                  │ Check key-id matches owner
      │                  │
      │ Proxy to OpenCode│
      │◄─────────────────│
```

---

## Scaling & Monitoring

### Horizontal Pod Autoscaling

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

### Prometheus Monitoring

```yaml
# k8s/servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: web-os-monitor
  namespace: web-os
spec:
  selector:
    matchLabels:
      app.kubernetes.io/part-of: web-os
  endpoints:
    - port: http
      path: /metrics
```

### Key Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|------------------|
| `http_requests_total` | Total HTTP requests | - |
| `http_request_duration_seconds` | Request latency | p99 > 1s |
| `pod_creation_duration_seconds` | Time to create pod | > 30s |
| `auth_failures_total` | Failed auth attempts | > 100/min |
| `active_sessions` | Active user sessions | - |
| `opencode_sessions` | Active agent sessions | - |

### Log Aggregation

```bash
# Install Loki (recommended)
helm repo add grafana https://grafana.github.io/helm-charts
helm install loki grafana/loki-stack --namespace monitoring --create-namespace

# View logs
kubectl logs -f deployment/api -n web-os
kubectl logs -f pod/<pod-id> -c auth-proxy -n web-os
kubectl logs -f pod/<pod-id> -c opencode -n web-os
```

---

## Troubleshooting

### Common Issues

#### Pod Not Starting

```bash
# Check pod status
kubectl get pods -n web-os -l pod-id=<pod-id>

# Check events
kubectl describe pod <pod-id> -n web-os

# Check logs
kubectl logs <pod-id> -c auth-proxy -n web-os
kubectl logs <pod-id> -c opencode -n web-os
```

#### Authentication Failing

```bash
# Check auth proxy logs
kubectl logs -f deployment/api -n web-os | grep -i auth

# Verify session store
kubectl exec -it deployment/api -n web-os -- redis-cli KEYS "session:*"

# Check owner wallet match
kubectl get pod <pod-id> -n web-os -o jsonpath='{.metadata.labels.owner-wallet}'
```

#### TLS Certificate Issues

```bash
# Check certificate status
kubectl get certificates -n web-os

# Check cert-manager logs
kubectl logs -f deployment/cert-manager -n cert-manager

# Force certificate renewal
kubectl delete certificate pods-wildcard -n web-os
```

#### Ingress Not Routing

```bash
# Check ingress status
kubectl get ingress -n web-os

# Check NGINX logs
kubectl logs -f deployment/ingress-nginx-controller -n ingress-nginx

# Test DNS resolution
dig <pod-id>.pods.permaweb.run
```

### Debug Commands

```bash
# Port forward to API
kubectl port-forward svc/api 3000:80 -n web-os

# Port forward to pod
kubectl port-forward pod/<pod-id> 3001:3001 -n web-os

# SSH into pod container
kubectl exec -it <pod-id> -c opencode -n web-os -- /bin/sh

# Check K8s events
kubectl get events -n web-os --sort-by='.lastTimestamp'

# Resource usage
kubectl top pods -n web-os
kubectl top nodes
```

---

## Appendix

### Environment Variables

#### API Service

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP port | `3000` |
| `KUBERNETES_NAMESPACE` | K8s namespace | `web-os` |
| `LLM_SECRETS_DIR` | LLM API keys path | `/secrets/llm` |

#### Auth Proxy

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_PORT` | HTTP port | `3001` |
| `BACKEND_PORT` | OpenCode port | `4096` |
| `OWNER_WALLET` | Pod owner address | Required |
| `OWNER_KEY_ID` | Key ID for HTTPSig | Required |
| `SESSION_SECRET` | Session signing key | Required |
| `SESSION_DURATION_HOURS` | Session TTL | `24` |
| `DOMAIN` | Cookie domain | `pods.permaweb.run` |

#### OpenCode Agent

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | From secret |
| `ANTHROPIC_API_KEY` | Anthropic API key | From secret |

### File Structure

```
web-os/
├── api/                    # Main API service
│   ├── src/
│   │   ├── index.ts        # Entry point
│   │   ├── auth/           # Authentication logic
│   │   └── pods/           # Pod orchestration
│   └── Dockerfile
├── auth-proxy/             # Authentication proxy
│   ├── src/
│   │   └── index.ts        # Proxy server
│   └── Dockerfile
├── k8s/                    # Kubernetes manifests
│   ├── namespace.yaml
│   ├── api-deployment.yaml
│   ├── api-service.yaml
│   ├── gateway-ingress.yaml
│   ├── pod-template.yaml
│   ├── rbac.yaml
│   └── servicemonitor.yaml
├── demo/                   # Demo app
│   └── index.html
└── docs/                   # Documentation
    ├── AGENT-API.md
    ├── API.md
    ├── DEPLOY.md
    └── INFRASTRUCTURE.md   # This file
```

### Useful Commands

```bash
# Deploy everything
kubectl apply -f k8s/

# Scale API
kubectl scale deployment api --replicas=5 -n web-os

# Update deployment
kubectl set image deployment/api web-os-api=registry.digitalocean.com/permaweb-registry/web-os-api:v2

# Rollback
kubectl rollout undo deployment/api -n web-os

# Delete all pods (recreate from templates)
kubectl delete pods -n web-os --all

# Full teardown
kubectl delete namespace web-os
```

---

## Next Steps

1. **Set up CI/CD** - See [CI-CD-PLAN.md](./CI-CD-PLAN.md)
2. **Configure Monitoring** - Deploy Grafana + Prometheus
3. **Enable Auto-scaling** - Configure HPA and cluster autoscaler
4. **Security Audit** - Review [security-audit.md](./security-audit.md)
5. **Test Authentication** - Use the demo app at `/demo/index.html`

---

*Last updated: 2026-03-17*