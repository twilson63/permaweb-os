# Permaweb OS Deployment Guide

Platform-agnostic Kubernetes deployment instructions for Permaweb OS.

## Prerequisites

- Kubernetes cluster (1.28+) with:
  - At least 3 nodes (recommended: 4 vCPU, 8GB RAM each)
  - LoadBalancer support (cloud provider or MetalLB)
- Domain name with DNS control
- Container registry access
- `kubectl` configured for your cluster
- Docker with buildx support

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Ingress (nginx)                         │
│         *.pods.permaweb.run → User Pods                    │
│         api.permaweb.run → API Gateway                     │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway                              │
│  - Wallet authentication (Arweave/Ethereum)                 │
│  - LLM key management                                       │
│  - Pod orchestration                                        │
│  - Kubernetes API client                                    │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    User Pods                                 │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │   Auth Proxy    │───▶│    OpenCode     │                │
│  │   (port 3001)   │    │   (port 4096)   │                │
│  │ HTTPSig verify  │    │  AI Agent       │                │
│  └─────────────────┘    └─────────────────┘                │
│         │                        │                          │
│         └────────────────────────┘                          │
│                   │                                         │
│            ┌──────────┐                                     │
│            │  PVC     │ (workspace storage)                │
│            └──────────┘                                     │
└─────────────────────────────────────────────────────────────┘
```

## Step 1: Cluster Setup

### Create Namespace

```bash
kubectl create namespace web-os
```

### Set Up Ingress Controller

**Using Helm (recommended):**
```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.type=LoadBalancer
```

**Or using manifests:**
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/cloud/deploy.yaml
```

Wait for LoadBalancer IP:
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

### Install cert-manager

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.5/cert-manager.yaml
```

Wait for cert-manager to be ready:
```bash
kubectl rollout status deployment/cert-manager -n cert-manager --timeout=60s
kubectl rollout status deployment/cert-manager-webhook -n cert-manager --timeout=60s
```

## Step 2: DNS Configuration

Point your domain to the LoadBalancer IP:

```
api.permaweb.run     A      <LOADBALANCER_IP>
*.pods.permaweb.run   A      <LOADBALANCER_IP>
```

## Step 3: TLS Certificates

### Create ClusterIssuer for HTTP-01 (api.permaweb.run)

```yaml
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

### Create ClusterIssuer for DNS-01 (*.pods.permaweb.run wildcard)

For DNS-01, you need credentials for your DNS provider.

**Cloudflare example:**
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: cloudflare-api-token
  namespace: cert-manager
type: Opaque
stringData:
  api-token: YOUR_CLOUDFLARE_API_TOKEN
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-dns
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@permaweb.run
    privateKeySecretRef:
      name: letsencrypt-dns
    solvers:
    - dns01:
        cloudflare:
          apiTokenSecretRef:
            name: cloudflare-api-token
            key: api-token
```

**DigitalOcean example:**
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: digitalocean-dns
  namespace: cert-manager
type: Opaque
stringData:
  access-token: YOUR_DIGITALOCEAN_TOKEN
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-dns
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@permaweb.run
    privateKeySecretRef:
      name: letsencrypt-dns
    solvers:
    - dns01:
        digitalocean:
          tokenSecretRef:
            name: digitalocean-dns
            key: access-token
```

```bash
kubectl apply -f cluster-issuer.yaml
```

## Step 4: RBAC Configuration

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: web-os-api
  namespace: web-os
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: web-os-api
  namespace: web-os
rules:
- apiGroups: [""]
  resources: ["secrets"]
  verbs: ["get", "list", "create", "update", "patch", "delete"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "create", "update", "patch", "delete", "watch"]
- apiGroups: [""]
  resources: ["services"]
  verbs: ["get", "list", "create", "update", "patch", "delete"]
- apiGroups: [""]
  resources: ["persistentvolumeclaims"]
  verbs: ["get", "list", "create", "update", "patch", "delete"]
- apiGroups: ["networking.k8s.io"]
  resources: ["ingresses"]
  verbs: ["get", "list", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: web-os-api
  namespace: web-os
subjects:
- kind: ServiceAccount
  name: web-os-api
  namespace: web-os
roleRef:
  kind: Role
  name: web-os-api
  apiGroup: rbac.authorization.k8s.io
```

```bash
kubectl apply -f rbac.yaml
```

## Step 5: Container Registry

Login to your container registry:

```bash
# Docker Hub
docker login

# DigitalOcean
doctl registry login

# GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Google Container Registry
gcloud auth configure-docker
```

## Step 6: Build and Push Images

**Important:** Build for `linux/amd64` platform (most Kubernetes clusters run on amd64):

```bash
# API
docker buildx build --platform linux/amd64 \
  -t your-registry/web-os-api:amd64 \
  -f api/Dockerfile api/
docker push your-registry/web-os-api:amd64

# Auth Proxy
docker buildx build --platform linux/amd64 \
  -t your-registry/web-os-auth-proxy:amd64 \
  -f auth-proxy/Dockerfile auth-proxy/
docker push your-registry/web-os-auth-proxy:amd64

# OpenCode Base
docker buildx build --platform linux/amd64 \
  -t your-registry/web-os-opencode:amd64 \
  -f images/opencode-base/Dockerfile images/opencode-base/
docker push your-registry/web-os-opencode:amd64

# Frontend (optional)
docker buildx build --platform linux/amd64 \
  -t your-registry/web-os-frontend:amd64 \
  -f frontend/Dockerfile frontend/
docker push your-registry/web-os-frontend:amd64
```

## Step 7: Create Secrets

### LLM API Keys

```bash
kubectl create secret generic llm-api-keys -n web-os \
  --from-literal=openrouter=YOUR_OPENROUTER_KEY \
  --from-literal=anthropic=YOUR_ANTHROPIC_KEY \
  --from-literal=openai=YOUR_OPENAI_KEY
```

### Session Secret

```bash
kubectl create secret generic session-secret -n web-os \
  --from-literal=secret="$(openssl rand -hex 32)"
```

### Registry Secret (if using private registry)

```bash
kubectl create secret docker-registry registry-secret \
  -n web-os \
  --docker-server=your-registry \
  --docker-username=USERNAME \
  --docker-password=PASSWORD
```

## Step 8: Kubernetes API Access

**Important for cloud providers:** Many cloud Kubernetes clusters don't allow pods to reach the internal Kubernetes API. You need to create a kubeconfig for external access.

### Get cluster credentials

```bash
# DigitalOcean
doctl kubernetes cluster kubeconfig save CLUSTER_NAME

# GKE
gcloud container clusters get-credentials CLUSTER_NAME

# EKS
aws eks update-kubeconfig --name CLUSTER_NAME

# AKS
az aks get-credentials --resource-group RG_NAME --name CLUSTER_NAME
```

### Create kubeconfig secret for API

```bash
# Get cluster server URL
CLUSTER_URL=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')

# Create service account token
kubectl create token web-os-api -n web-os --duration=87600h > /tmp/token

# Get CA cert
kubectl config view --raw --flatten -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d > /tmp/ca.crt

# Create kubeconfig
cat > /tmp/kubeconfig << EOF
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority: /home/webos/.kube/ca.crt
    server: ${CLUSTER_URL}
  name: web-os-cluster
contexts:
- context:
    cluster: web-os-cluster
    namespace: web-os
    user: web-os-api
  name: web-os-api
current-context: web-os-api
users:
- name: web-os-api
  user:
    token: $(cat /tmp/token)
EOF

# Create secret
kubectl create secret generic kubeconfig -n web-os \
  --from-file=config=/tmp/kubeconfig \
  --from-file=ca.crt=/tmp/ca.crt

# Cleanup
rm /tmp/token /tmp/ca.crt /tmp/kubeconfig
```

## Step 9: Deploy API

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: web-os
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web-os-api
  template:
    metadata:
      labels:
        app: web-os-api
    spec:
      serviceAccountName: web-os-api
      imagePullSecrets:
      - name: registry-secret
      containers:
      - name: api
        image: your-registry/web-os-api:amd64
        ports:
        - containerPort: 3000
        env:
        - name: PORT
          value: "3000"
        - name: POD_BASE_DOMAIN
          value: "pods.permaweb.run"
        - name: KUBECONFIG
          value: /home/webos/.kube/config
        volumeMounts:
        - name: kubeconfig
          mountPath: /home/webos/.kube
          readOnly: true
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 512Mi
      volumes:
      - name: kubeconfig
        secret:
          secretName: kubeconfig
```

```bash
kubectl apply -f api-deployment.yaml
```

## Step 10: Create Services and Ingress

### API Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: web-os
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 3000
    name: http
  selector:
    app: web-os-api
```

### API Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: web-os
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - api.permaweb.run
    secretName: api-tls
  rules:
  - host: api.permaweb.run
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api
            port:
              name: http
```

### Wildcard Ingress for User Pods

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: pods-wildcard
  namespace: web-os
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-dns
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - "*.pods.permaweb.run"
    secretName: pods-wildcard-tls
  rules:
  - host: "*.pods.permaweb.run"
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: user-pod
            port:
              name: auth-http
```

```bash
kubectl apply -f api-service.yaml
kubectl apply -f api-ingress.yaml
kubectl apply -f pods-wildcard-ingress.yaml
```

## Step 11: Verify Deployment

```bash
# Check API health
curl https://api.permaweb.run/health

# Check TLS certificates
kubectl get certificates -n web-os

# Check pods
kubectl get pods -n web-os

# Check ingress
kubectl get ingress -n web-os
```

## Step 12: Create First User Pod

Use the test client at `https://permaweb-os.zenbin.org/` or:

```bash
# Authenticate
curl -X POST https://api.permaweb.run/api/auth/nonce \
  -H "Content-Type: application/json" \
  -d '{"address":"YOUR_WALLET_ADDRESS","walletType":"arweave"}'

# Sign the challenge with your wallet, then:
curl -X POST https://api.permaweb.run/api/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"signature":"YOUR_SIGNATURE","nonce":"NONCE_FROM_STEP_1"}'

# Create pod
curl -X POST https://api.permaweb.run/api/pods \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -d '{"model":"opencode/big-pickle"}'
```

## Troubleshooting

### Pod stuck in ContainerCreating

1. Check events: `kubectl describe pod POD_NAME -n web-os`
2. Check if image exists: `docker pull your-registry/web-os-api:amd64`
3. Check secrets: `kubectl get secrets -n web-os`

### Multi-Attach error for PVC

This happens when multiple pods try to use the same PVC. Each wallet gets one PVC for persistence. Solutions:
- Create pods with different wallets
- Wait for old pod to terminate before creating new one
- Delete old pod first: `kubectl delete pod OLD_POD -n web-os`

### TLS certificate not issued

1. Check cert-manager logs: `kubectl logs -n cert-manager deployment/cert-manager`
2. Check challenges: `kubectl get challenges -A`
3. Verify DNS records point to LoadBalancer IP

### API can't reach Kubernetes API

Ensure kubeconfig secret is mounted correctly:
```bash
kubectl exec deployment/api -n web-os -- ls /home/webos/.kube/
```

## Platform-Specific Notes

### DigitalOcean

- Use `doctl kubernetes cluster kubeconfig save CLUSTER_NAME`
- Block storage doesn't support ReadWriteMany (one pod per PVC)
- Use DigitalOcean DNS for DNS-01 challenges

### AWS EKS

- Use IAM roles for service accounts (IRSA) instead of kubeconfig secret
- Install AWS Load Balancer Controller for Ingress
- Use Route53 for DNS-01 challenges

### Google GKE

- Use Workload Identity instead of kubeconfig secret
- GKE Ingress is different from nginx ingress
- Use Cloud DNS for DNS-01 challenges

### Azure AKS

- Use Azure AD pod identity instead of kubeconfig secret
- Use Application Gateway Ingress Controller (AGIC) or nginx
- Use Azure DNS for DNS-01 challenges

### Bare Metal / On-Premises

- Use MetalLB for LoadBalancer support
- Use nginx ingress controller
- Use external DNS provider (Cloudflare, Route53, etc.) for DNS-01

## Cleanup

```bash
# Delete namespace (removes all resources)
kubectl delete namespace web-os

# Delete cluster resources
kubectl delete -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.5/cert-manager.yaml
helm uninstall ingress-nginx -n ingress-nginx
```

## Next Steps

1. Set up monitoring (Prometheus/Grafana)
2. Configure log aggregation (ELK, Loki)
3. Set up backup for PVCs
4. Configure resource quotas
5. Set up pod autoscaling
6. Review and update NetworkPolicy for security