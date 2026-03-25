# Web-OS CI/CD Plan

## Overview

This document outlines the CI/CD strategy for Web-OS, including automated testing, building, and deployment pipelines.

## Current Architecture

```
web-os/
├── api/                    # Express API server
├── auth-proxy/             # Authentication proxy
├── images/opencode-base/   # Base Docker image
├── frontend/               # Web frontend (future)
└── templates/chat-sdk/     # SDK templates
```

## CI/CD Pipeline Design

### Pipeline Stages

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Lint &    │────▶│    Test    │────▶│   Build    │────▶│   Deploy   │
│   Format    │     │             │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

### Branch Strategy

| Branch | Environment | Auto-Deploy |
|--------|-------------|-------------|
| `main` | Production | ✅ Yes |
| `staging` | Staging | ✅ Yes |
| `dev` | Development | ✅ Yes |
| `feature/*` | None | ❌ No (PR only) |

## Implementation Plan

### Phase 1: GitHub Actions Setup

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, staging, dev]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm run test:unit
      - run: npm run test:integration

  build:
    runs-on: ubuntu-latest
    needs: test
    if: github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker images
        run: |
          docker buildx build --platform linux/amd64 \
            -t ${{ secrets.REGISTRY }}/web-os-api:${{ github.sha }} \
            -f api/Dockerfile api --push
          docker buildx build --platform linux/amd64 \
            -t ${{ secrets.REGISTRY }}/web-os-auth-proxy:${{ github.sha }} \
            -f auth-proxy/Dockerfile auth-proxy --push

  deploy:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Deploy to production
        run: |
          kubectl set image deployment/api \
            api=${{ secrets.REGISTRY }}/web-os-api:${{ github.sha }} \
            -n web-os
```

### Phase 2: Testing Infrastructure

```yaml
# Test structure
tests/
├── unit/                    # Fast, isolated tests
│   ├── api/
│   ├── auth-proxy/
│   └── templates/
├── integration/             # API + DB tests
│   └── api/
├── e2e/                    # Full flow tests
│   ├── auth/
│   ├── pods/
│   └── chat/
└── scripts/
    ├── setup-test-env.sh
    └── teardown-test-env.sh
```

### Phase 3: Deployment Environments

```yaml
# Environments
environments/
├── dev/
│   ├── kustomization.yaml
│   └── patches/
├── staging/
│   ├── kustomization.yaml
│   └── patches/
└── prod/
    ├── kustomization.yaml
    └── patches/
```

## Secrets Management

### GitHub Secrets (Required)

```
REGISTRY_URL              # registry.digitalocean.com/scout-live
REGISTRY_USERNAME         # Docker registry username
REGISTRY_PASSWORD         # Docker registry password
KUBE_CONFIG               # Base64-encoded kubeconfig
DIGITALOCEAN_TOKEN        # DO API token
LETSENCRYPT_EMAIL         # SSL certificate email
```

### Kubernetes Secrets (Required)

```yaml
# web-os namespace secrets
api-keys-secret           # LLM API keys
session-secret            # Session signing secret
owner-key-secret         # Pod owner keypairs
```

## Rollout Strategy

### Blue-Green Deployment

```yaml
# Kubernetes deployment strategy
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

### Health Checks

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

## Monitoring & Alerts

### Metrics

- **API Response Time**: p50, p95, p99
- **Pod Creation Time**: Time from request to running
- **Auth Success Rate**: Percentage of successful authentications
- **Error Rate**: 4xx and 5xx errors per minute

### Alerts

```yaml
# Alert rules
alerts:
  - name: APIErrorRate
    condition: error_rate > 5%
    severity: critical
    notify: [slack, email]
  
  - name: PodCreationFailed
    condition: pod_creation_failures > 3/5min
    severity: warning
    notify: [slack]
  
  - name: AuthFailureRate
    condition: auth_failures > 10%
    severity: warning
    notify: [slack]
```

## Security Scanning

### Container Scanning

```yaml
# Trivy vulnerability scanning
- name: Scan images
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: ${{ secrets.REGISTRY }}/web-os-api:${{ github.sha }}
    format: 'sarif'
    output: 'trivy-results.sarif'
```

### Dependency Scanning

```yaml
# Dependabot configuration
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/api"
    schedule:
      interval: "weekly"
  - package-ecosystem: "npm"
    directory: "/auth-proxy"
    schedule:
      interval: "weekly"
```

## Implementation Steps

### Week 1: Foundation
1. ✅ Create `.github/workflows/ci.yml`
2. ✅ Add `npm run lint` scripts
3. ✅ Add `npm run test:unit` scripts
4. ✅ Set up GitHub secrets

### Week 2: Testing
1. ✅ Write unit tests for core modules
2. ✅ Set up test database/fixtures
3. ✅ Add integration tests
4. ✅ Configure coverage reports

### Week 3: Deployment
1. ✅ Create Kubernetes manifests
2. ✅ Set up staging environment
3. ✅ Configure blue-green deployment
4. ✅ Add health checks

### Week 4: Monitoring
1. ✅ Set up Prometheus/Grafana
2. ✅ Configure alerts
3. ✅ Add security scanning
4. ✅ Document runbooks

## Cost Estimation

| Resource | Development | Staging | Production |
|----------|-------------|---------|------------|
| CI/CD | GitHub Free | GitHub Free | GitHub Free |
| Compute | $20/mo | $40/mo | $80/mo |
| Storage | $5/mo | $10/mo | $20/mo |
| Monitoring | Free | $10/mo | $30/mo |
| **Total** | **$25/mo** | **$60/mo** | **$130/mo** |

## Next Steps

1. Create `.github/workflows/ci.yml`
2. Add test scripts to `package.json`
3. Configure GitHub secrets
4. Test on feature branch
5. Merge to main for production deployment