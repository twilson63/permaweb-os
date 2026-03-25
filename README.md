# PermawebOS

> A Kubernetes-based platform for running isolated OpenCode pods with wallet authentication.

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-1.28+-blue.svg)](https://kubernetes.io/)

## Overview

PermawebOS provides per-user isolated OpenCode environments with wallet-based authentication. Each user gets their own pod with dedicated resources, and all requests are authenticated via HTTPSig (Arweave) or Ethereum personal_sign.

## Features

- **Multi-wallet Authentication** - Arweave (transaction signing), RSA, ECDSA, Ethereum
- **Per-User Isolation** - Each user gets their own OpenCode container
- **HTTPSig Verification** - RFC 9421 compliant request signing
- **Model Selection** - OpenAI, Anthropic, OpenRouter, Groq
- **Usage Tracking** - Token counts and cost calculation per wallet
- **Subdomain Routing** - Each pod at `{pod-id}.pods.permaweb.run`

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         api.permaweb.run                                │
│                      (API Gateway)                                       │
│   - Wallet authentication                                               │
│   - Pod lifecycle (create/delete/status)                                │
│   - Usage tracking                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
           ┌────────────────────────┼────────────────────────┐
           │                        │                        │
    ┌──────┴──────┐          ┌──────┴──────┐          ┌──────┴──────┐
    │   Pod A     │          │   Pod B     │          │   Pod C     │
    │             │          │             │          │             │
    │ auth-proxy  │          │ auth-proxy  │          │ auth-proxy  │
    │ open-code   │          │ open-code    │          │ open-code    │
    │             │          │             │          │             │
    │ Wallet: A   │          │ Wallet: B   │          │ Wallet: C   │
    └─────────────┘          └─────────────┘          └─────────────┘
                                    │
                        ┌───────────┴───────────┐
                        │   Kubernetes Cluster   │
                        │   - Secrets management │
                        │   - Ingress routing    │
                        │   - Resource limits    │
                        └───────────────────────┘
```

## Quick Start

### Prerequisites

- [Docker](https://www.docker.com/) 20.10+
- [kubectl](https://kubernetes.io/docs/tasks/tools/) 1.28+
- [Node.js](https://nodejs.org/) 18+
- [Bun](https://bun.sh/) (for API)

### Local Development

```bash
# Clone the repository
git clone https://github.com/twilson63/permaweb-os.git
cd permaweb-os

# Install dependencies
bun install

# Start local Kubernetes (kind or minikube)
kind create cluster --name permaweb-os
kubectl cluster-info

# Deploy
./scripts/bootstrap-kind.sh
./scripts/deploy-pod.sh
```

### Deploy to Production

See [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) for production deployment.

## Project Structure

```
permaweb-os/
├── api/                    # Main API service
│   ├── src/
│   │   ├── auth/           # Authentication (Arweave, Ethereum)
│   │   ├── pods/           # Pod orchestration
│   │   ├── llm/            # LLM secret management
│   │   └── index.ts        # Entry point
│   └── Dockerfile
├── auth-proxy/             # Per-pod authentication proxy
│   ├── src/index.ts        # Proxy server
│   └── Dockerfile
├── k8s/                    # Kubernetes manifests
│   ├── namespace.yaml
│   ├── api-deployment.yaml
│   ├── pod-template.yaml
│   └── gateway-ingress.yaml
├── demo/                   # Demo application
│   └── index.html          # Agent API demo
├── docs/                   # Documentation
│   ├── AGENT-API.md        # Agent API reference
│   ├── API.md              # REST API reference
│   ├── INFRASTRUCTURE.md   # Deployment guide
│   └── ...
├── scripts/                # Deployment scripts
│   ├── bootstrap-kind.sh
│   ├── deploy-pod.sh
│   └── health-check.sh
└── tests/                  # Test files
    └── ...
```

## Documentation

| Document | Description |
|----------|-------------|
| [API Reference](docs/API.md) | REST API endpoints |
| [Agent API](docs/AGENT-API.md) | OpenCode REST API for agents |
| [Infrastructure Guide](docs/INFRASTRUCTURE.md) | Kubernetes deployment |
| [CI/CD Plan](docs/CI-CD-PLAN.md) | GitHub Actions pipeline |
| [Architecture](docs/ARCHITECTURE.md) | System design |
| [Security Audit](docs/security-audit.md) | Security review |

## Authentication

### Arweave

```javascript
// 1. Request nonce
const { nonce, message } = await fetch('/api/auth/nonce', {
  method: 'POST',
  body: JSON.stringify({ address: walletAddress })
}).then(r => r.json());

// 2. Sign with Wander wallet
const signature = await window.arweaveWallet.sign(message);

// 3. Verify
const { token } = await fetch('/api/auth/verify', {
  method: 'POST',
  body: JSON.stringify({ address, signature, ...txData })
}).then(r => r.json());
```

### Ethereum

```javascript
// 1. Request nonce
const { nonce } = await fetch('/api/auth/nonce', {
  method: 'POST',
  body: JSON.stringify({ address, walletType: 'ethereum' })
}).then(r => r.json());

// 2. Sign with personal_sign
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: [nonce, address]
});

// 3. Verify
const { token } = await fetch('/api/auth/verify', {
  method: 'POST',
  body: JSON.stringify({ address, signature, nonce, walletType: 'ethereum' })
}).then(r => r.json());
```

## Agent API

Each pod exposes an OpenCode REST API at `https://{pod-id}.pods.permaweb.run`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/session` | POST | Create session |
| `/session/:id/message` | POST | Send message (sync) |
| `/session/:id/prompt_async` | POST | Send message (async) |
| `/event` | GET | SSE stream for events |
| `/file/content` | GET | Read file |
| `/health` | GET | Health check |

See [docs/AGENT-API.md](docs/AGENT-API.md) for full documentation.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/auth/nonce` | POST | Get authentication nonce |
| `/api/auth/verify` | POST | Verify signature, get token |
| `/api/pods` | POST | Create pod |
| `/api/pods` | GET | List pods |
| `/api/pods/:id` | GET | Get pod status |
| `/api/pods/:id` | DELETE | Delete pod |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

## Security

- Never commit API keys or secrets
- Use `k8s/llm-api-keys.secret.yaml` as a template
- All authentication uses wallet signatures
- Each pod is isolated with its own credentials

## License

MIT License - see [LICENSE](LICENSE)

## Status

Production deployment at [permaweb.run](https://permaweb.run).
