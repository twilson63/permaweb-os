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

## 8. Create Namespace and Secrets

```bash
# Create namespace
kubectl create namespace web-os

# Create LLM API keys secret
kubectl create secret generic llm-api-keys \
  --namespace web-os \
  --from-literal=openai=sk-your-openai-key \
  --from-literal=anthropic=sk-ant-your-anthropic-key

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

## Resources

- [DigitalOcean Kubernetes Docs](https://docs.digitalocean.com/products/kubernetes/)
- [Cert-Manager Docs](https://cert-manager.io/docs/)
- [NGINX Ingress Docs](https://kubernetes.github.io/ingress-nginx/)
- [Web OS Architecture](./DESIGN.md)