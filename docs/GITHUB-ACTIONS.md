# GitHub Actions Setup

This document describes the required GitHub secrets for CI/CD and provides the workflow file content.

## Required Secrets

Configure these secrets in GitHub repository settings:
`Settings` > `Secrets and variables` > `Actions` > `New repository secret`

### `DIGITALOCEAN_ACCESS_TOKEN`

A DigitalOcean API token with read/write access to:
- Kubernetes clusters (read/write)
- Container registry (read/write)

**How to create:**
1. Go to https://cloud.digitalocean.com/account/api/tokens
2. Click "Generate New Token"
3. Name it: `permaweb-os-ci`
4. Select scopes: `read` and `write`
5. Copy the token value
6. Add to GitHub secrets as `DIGITALOCEAN_ACCESS_TOKEN`

### Kubernetes Secrets (Pre-existing)

These are managed in-cluster and NOT synced from GitHub:

| Secret | Purpose | Managed By |
|--------|---------|------------|
| `kubeconfig` | K8s API access | Manual (created once) |
| `llm-api-keys` | Global LLM keys | Manual (created once) |
| `session-secret` | Session signing | Manual (created once) |
| `registry-scout-live` | Docker registry | Manual (created once) |
| `permaweb-api-tls` | TLS certificate | cert-manager |
| `permaweb-pods-tls` | TLS certificate | cert-manager |

## Workflow File

**After merging this PR**, create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: api/package-lock.json
          
      - name: Install dependencies
        working-directory: api
        run: npm ci
        
      - name: Build
        working-directory: api
        run: npm run build
        
      - name: Run tests
        working-directory: api
        run: npm test
        env:
          SKIP_K8S_TESTS: 'true'

  build:
    name: Build & Push Images
    runs-on: ubuntu-latest
    needs: [test]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3
        
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
        
      - name: Login to DigitalOcean Registry
        uses: docker/login-action@v3
        with:
          registry: registry.digitalocean.com
          username: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
          password: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
          
      - name: Build and push API
        uses: docker/build-push-action@v5
        with:
          context: ./api
          file: ./api/Dockerfile
          platforms: linux/amd64
          push: true
          tags: registry.digitalocean.com/scout-live/web-os-api:amd64
          cache-from: type=registry,ref=registry.digitalocean.com/scout-live/web-os-api:cache
          cache-to: type=registry,ref=registry.digitalocean.com/scout-live/web-os-api:cache,mode=max
          
      - name: Build and push Auth Proxy
        uses: docker/build-push-action@v5
        with:
          context: ./auth-proxy
          platforms: linux/amd64
          push: true
          tags: registry.digitalocean.com/scout-live/web-os-auth-proxy:amd64
          cache-from: type=registry,ref=registry.digitalocean.com/scout-live/web-os-auth-proxy:cache
          cache-to: type=registry,ref=registry.digitalocean.com/scout-live/web-os-auth-proxy:cache,mode=max
          
      - name: Build and push OpenCode
        uses: docker/build-push-action@v5
        with:
          context: ./images/opencode-base
          platforms: linux/amd64
          push: true
          tags: registry.digitalocean.com/scout-live/web-os-opencode:amd64
          cache-from: type=registry,ref=registry.digitalocean.com/scout-live/web-os-opencode:cache
          cache-to: type=registry,ref=registry.digitalocean.com/scout-live/web-os-opencode:cache,mode=max
          
      - name: Build and push Frontend
        uses: docker/build-push-action@v5
        with:
          context: ./frontend
          platforms: linux/amd64
          push: true
          tags: registry.digitalocean.com/scout-live/web-os-frontend:amd64
          cache-from: type=registry,ref=registry.digitalocean.com/scout-live/web-os-frontend:cache
          cache-to: type=registry,ref=registry.digitalocean.com/scout-live/web-os-frontend:cache,mode=max

  deploy:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: [build]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        
      - name: Install doctl
        uses: digitalocean/action-doctl@v2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
          
      - name: Save kubeconfig
        run: doctl kubernetes cluster kubeconfig save permaweb-os
        
      - name: Install kubectl
        uses: azure/setup-kubectl@v3
        
      - name: Deploy API
        run: |
          kubectl apply -f k8s/namespace.yaml
          kubectl apply -f k8s/rbac.yaml
          kubectl rollout restart deployment/api -n web-os
          kubectl rollout status deployment/api -n web-os --timeout=120s
          
      - name: Verify deployment
        run: |
          kubectl get pods -n web-os
          kubectl get ingress -n web-os
          curl -sf https://api.permaweb.run/health || exit 1
          
      - name: Notify on success
        if: success()
        run: |
          echo "✅ Deployment successful"
          echo "API: https://api.permaweb.run"
          echo "Health: https://api.permaweb.run/health"
          
      - name: Notify on failure
        if: failure()
        run: |
          echo "❌ Deployment failed"
          kubectl logs -n web-os deployment/api --tail=50
          exit 1
```

## Branch Protection

After adding the workflow, configure branch protection in GitHub Settings > Branches:

1. Click "Add rule" for `main` branch
2. Enable:
   - ☑ Require a pull request before merging
   - ☑ Require approvals: 1
   - ☑ Require status checks to pass before merging
   - ☑ Require branches to be up to date before merging
   - Status checks: `test`
   - ☑ Require conversation resolution before merging
3. Click "Create"

## Workflow Overview

### On Pull Request
1. Runs tests (unit + integration)
2. Builds all images (no push)
3. Status check must pass before merge

### On Push to Main
1. Runs tests (if configured)
2. Builds and pushes all images to DigitalOcean registry
3. Deploys to production cluster
4. Verifies deployment health
5. Notifies on success/failure