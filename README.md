# Permaweb OS

> A Kubernetes-based platform for running isolated OpenCode pods with HTTPSig authentication. Each user connects with their wallet, spawns a personal pod, and interacts through signed JSON messages.

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-1.28+-blue.svg)](https://kubernetes.io/)

## 🌟 Features

- **Wallet Authentication** - Connect with Arweave, RSA, ECDSA, or Ethereum wallets
- **HTTPSig Verification** - RFC 9421 compliant request signing
- **Per-Pod Isolation** - Each user gets their own OpenCode container
- **Model Selection** - Choose from OpenAI, Anthropic, and more
- **Usage Tracking** - Token counts and cost calculation per wallet
- **Subdomain Routing** - Each pod gets `{pod-id}.pods.permaweb.live`

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         permaweb.live                                   │
│                      (Kubernetes Cluster)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Gateway Service                                │    │
│  │   - Wallet authentication (Arweave, RSA, ECDSA)                  │    │
│  │   - Pod lifecycle (create/delete/status)                         │    │
│  │   - Request routing                                              │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                    │                                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│  │   Pod 1    │  │   Pod 2    │  │   Pod 3    │  │   Pod N    │         │
│  │            │  │            │  │            │  │            │         │
│  │ HTTPSig    │  │ HTTPSig    │  │ HTTPSig    │  │ HTTPSig    │         │
│  │ OpenCode   │  │ OpenCode    │  │ OpenCode   │  │ OpenCode    │         │
│  │ Dev Tools  │  │ Dev Tools   │  │ Dev Tools  │  │ Dev Tools  │         │
│  │            │  │            │  │            │  │            │         │
│  │ Wallet: A  │  │ Wallet: B  │  │ Wallet: C  │  │ Wallet: N  │         │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘         │
│                                                                          │
│  Secret Store: LLM API keys per wallet                                   │
│  Persistent Storage: Git repos, session data                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 📋 Prerequisites

- [Docker](https://www.docker.com/) 20.10+
- [Kubectl](https://kubernetes.io/docs/tasks/tools/) 1.28+
- [Kind](https://kind.sigs.k8s.io/) or [Minikube](https://minikube.sigs.k8s.io/)
- [Node.js](https://nodejs.org/) 18+
- [Bun](https://bun.sh/) (for Hive)

## 🚀 Quick Start

### 1. Clone and Setup

```bash
git clone https://github.com/twilson63/permaweb-os.git
cd permaweb-os

# Start local Kubernetes cluster
./scripts/setup.sh
```

### 2. Configure LLM Keys

```bash
# Copy the secret template
cp k8s/llm-api-keys.secret.yaml /tmp/llm-api-keys.secret.yaml

# Edit and add your keys
# Replace placeholder values with your actual API keys
```

### 3. Deploy

```bash
# Deploy a pod
POD_BASE_DOMAIN=127.0.0.1.nip.io ./scripts/deploy-pod.sh
```

### 4. Verify

```bash
# Check cluster status
kubectl get pods -n web-os

# Check pod health
curl http://{pod-id}.127.0.0.1.nip.io:3001/health
```

## 🔑 Authentication Flow

```
1. User clicks "Connect Wallet"
2. Frontend requests nonce from /api/auth/nonce
3. User signs nonce with wallet
4. Frontend sends signature to /api/auth/verify
5. Server verifies signature, creates session token
6. Session token stored in localStorage
7. Token sent in Authorization: Bearer header
8. Pods bound to wallet address (ownerWallet field)
```

## 📁 Project Structure

```
permaweb-os/
├── api/                    # Gateway API (Express)
│   ├── src/
│   │   ├── auth/          # Authentication
│   │   ├── pods/          # Pod management
│   │   ├── llm/           # LLM integration
│   │   └── usage/         # Usage tracking
│   └── test/              # API tests
├── frontend/              # Vite + React frontend
│   └── src/
│       ├── App.tsx        # Main app
│       └── api.ts         # API client
├── opencode-sidecar/      # HTTPSig verification
│   └── src/
│       ├── index.ts       # Sidecar server
│       ├── httpSig.ts     # Signature verification
│       └── opencode.ts    # OpenCode proxy
├── images/
│   └── opencode-base/     # OpenCode container image
├── k8s/                   # Kubernetes manifests
│   ├── namespace.yaml
│   ├── pod-template.yaml
│   ├── api-deployment.yaml
│   └── ingress.yaml
├── scripts/               # Setup scripts
├── docs/                  # Documentation
│   └── adr.md            # Architecture Decision Records
├── ARCHITECTURE.md        # Technical architecture
├── DESIGN.md             # Design narrative
├── DEPLOY.md              # Deployment guide
└── README.md              # This file
```

## 🧪 Testing

```bash
# API tests
cd api && npm test

# Sidecar tests
cd opencode-sidecar && npm test

# Run all tests
npm run test:all
```

## 📊 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/nonce` | Get challenge for wallet signature |
| `POST` | `/api/auth/verify` | Verify signature, get session token |
| `GET` | `/api/auth/github` | Redirect to GitHub OAuth |
| `GET` | `/api/auth/github/callback` | GitHub OAuth callback |
| `GET` | `/api/pods` | List pods for authenticated user |
| `POST` | `/api/pods` | Create a new pod |
| `GET` | `/api/pods/:id` | Get pod status |
| `DELETE` | `/api/pods/:id` | Delete a pod |
| `GET` | `/api/llm/providers` | List available LLM providers |
| `GET` | `/api/usage` | Get usage for authenticated user |

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `3000` |
| `SESSION_SECRET` | Session signing secret | Required |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | Optional |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret | Optional |
| `GITHUB_REDIRECT_URI` | GitHub OAuth callback URL | Optional |
| `OPENCODE_BIN` | Path to OpenCode binary | `/Users/tron/.opencode/bin/opencode` |
| `USAGE_STORE_PATH` | Path to usage data file | `./data/usage-store.json` |

### Kubernetes Configuration

```yaml
# Namespace
kubectl create namespace web-os

# Secrets
kubectl create secret generic llm-api-keys \
  --from-literal=openai=sk-... \
  --from-literal=anthropic=sk-ant-...

# Deploy
kubectl apply -f k8s/
```

## 📖 Documentation

- [Architecture](./ARCHITECTURE.md) - Technical architecture details
- [Design](./DESIGN.md) - Design narrative and rationale
- [Deployment](./DEPLOY.md) - DigitalOcean deployment guide
- [ADRs](./docs/adr.md) - Architecture Decision Records

## 🛣️ Roadmap

### Phase 0: Foundation ✅
- Local Kubernetes cluster
- Service skeletons
- Base OpenCode image
- HTTPSig library
- CI + ADRs

### Phase 1: Core Pod Infrastructure ✅
- Pod template + K8s deployment
- Pod lifecycle API
- Basic frontend
- Wildcard ingress
- Subdomain routing

### Phase 2: Authentication ✅
- Wallet connection flow
- HTTPSig request signing
- Session management
- Per-pod identity

### Phase 3: LLM Integration ✅
- Secret storage for API keys
- Key injection into pods
- Model selection UI
- Usage tracking

### Phase 4: GitHub Integration 🔄
- OAuth flow
- Repository browser
- Clone/edit/push workflow
- PR creation

### Phase 5: Production ⏳
- DNS (permaweb.live)
- TLS certificates
- Monitoring/logging
- Rate limiting

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [OpenCode](https://github.com/anomalyco/opencode) - The AI agent harness
- [HTTP Message Signatures](https://datatracker.ietf.org/doc/html/rfc9421) - RFC 9421
- [Kubernetes](https://kubernetes.io/) - Container orchestration
- [Arweave](https://arweave.org/) - Permanent storage inspiration

## 📬 Contact

- Issues: [GitHub Issues](https://github.com/twilson63/permaweb-os/issues)
- Discussions: [GitHub Discussions](https://github.com/twilson63/permaweb-os/discussions)

---

Built with ❤️ for the decentralized future