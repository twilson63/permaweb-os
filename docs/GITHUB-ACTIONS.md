# GitHub Actions Setup

This document describes the required GitHub secrets for CI/CD.

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

## Workflow Overview

### On Pull Request
1. Runs tests (unit + integration)
2. Builds all images (no push)
3. Status check must pass before merge

### On Push to Main
1. Runs tests
2. Builds and pushes all images to DigitalOcean registry
3. Deploys to production cluster
4. Verifies deployment health
5. Notifies on success/failure

## Branch Protection

Configure in GitHub Settings > Branches:
- Require PR before merging: ✓
- Require approvals: 1
- Require status checks: test
- Require conversation resolution: ✓