# Web-OS Chat SDK Templates

Templates for building chat applications that interface securely with Web-OS pods.

## Templates

| Template | Description | Tech Stack |
|----------|-------------|------------|
| `basic/` | Minimal chat client | HTML + JS |
| `react/` | React chat component | React + TypeScript |
| `advanced/` | Full-featured chat app | React + TypeScript + Streaming |
| `vanilla/` | Pure JavaScript SDK | JavaScript |

## Quick Start

```bash
# Basic HTML template
cd templates/chat-sdk/basic
python3 -m http.server 8080
# Open http://localhost:8080

# React template
cd templates/chat-sdk/react
npm install && npm run dev
```

## Authentication

All templates support:
- **Ethereum** (MetaMask) - `personal_sign` for message signing
- **Arweave** (Wander) - Transaction signing for verification

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/nonce` | POST | Get auth challenge |
| `/api/auth/verify` | POST | Verify signature |
| `/api/pods` | GET | List pods |
| `/api/pods` | POST | Create pod |
| `/api/pods/:id` | GET | Get pod status |
| `/api/pods/:id` | DELETE | Delete pod |

## Environment Variables

```env
VITE_API_URL=https://api.permaweb.run
VITE_WS_URL=wss://api.permaweb.run/ws
```