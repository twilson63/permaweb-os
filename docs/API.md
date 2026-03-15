# Web-OS API Developer Guide

Complete API reference for Web-OS, a decentralized compute platform for AI agents.

## Base URL

```
Production: https://api.permaweb.run
Staging: https://staging-api.permaweb.run
Local: http://localhost:3000
```

## Authentication

Web-OS supports two authentication methods:

1. **Session-based (Browser)** - Wallet signature → session cookie
2. **HTTPSig (API)** - Request signing with Ed25519 keypairs

### Session Authentication

All endpoints except `/api/auth/*` and `/health` require authentication.

---

## Endpoints

### Health

#### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 12345
}
```

---

### Authentication

#### `POST /api/auth/nonce`

Get a challenge message for wallet signing.

**Request Body:**
```json
{
  "address": "string",       // Wallet address
  "walletType": "string"     // "ethereum" | "arweave"
}
```

**Response:**
```json
{
  "message": "Sign in to Web OS\n\nAddress: 0x...\nNonce: abc123\nIssued At: 2026-03-15T...",
  "nonce": "abc123",
  "walletType": "ethereum"
}
```

**Example:**
```bash
curl -X POST https://api.permaweb.run/api/auth/nonce \
  -H "Content-Type: application/json" \
  -d '{"address": "0x1234...", "walletType": "ethereum"}'
```

---

#### `POST /api/auth/verify`

Verify wallet signature and get session token.

**Ethereum Request:**
```json
{
  "address": "string",
  "signature": "string",
  "walletType": "ethereum"
}
```

**Arweave Request:**
```json
{
  "address": "string",
  "message": "string",
  "signature": "string",
  "owner": "string",
  "reward": "string",
  "lastTx": "string",
  "dataSize": "string",
  "dataRoot": "string",
  "tags": [],
  "walletType": "arweave"
}
```

**Response:**
```json
{
  "token": "base64url-token",
  "expiresAt": "2026-03-16T..."
}
```

**Example (Ethereum):**
```javascript
// Sign the message
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: [message, address]
});

// Verify
const res = await fetch('https://api.permaweb.run/api/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    address,
    signature,
    walletType: 'ethereum'
  })
});
const { token } = await res.json();
```

**Example (Arweave):**
```javascript
// Create and sign transaction
const arweave = Arweave.init({ host: 'arweave.net', port: 443, protocol: 'https' });
const tx = await arweave.createTransaction({ data: message });
const signedTx = await wallet.sign(tx);

// Verify
const res = await fetch('https://api.permaweb.run/api/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    address,
    message,
    signature: signedTx.signature,
    owner: signedTx.owner,
    reward: signedTx.reward?.toString(),
    lastTx: signedTx.last_tx,
    dataSize: signedTx.data_size?.toString(),
    dataRoot: signedTx.data_root,
    tags: signedTx.tags || [],
    walletType: 'arweave'
  })
});
```

---

### Pods

#### `GET /api/pods`

List all pods for authenticated user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "pods": [
    {
      "id": "abc123",
      "status": "running",
      "model": "openrouter/anthropic/claude-3.5-sonnet",
      "createdAt": "2026-03-15T...",
      "owner": "0x..."
    }
  ]
}
```

---

#### `POST /api/pods`

Create a new pod.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "model": "string"  // Optional, defaults to "openrouter/anthropic/claude-3.5-sonnet"
}
```

**Response:**
```json
{
  "id": "abc123def456...",
  "status": "pending",
  "model": "openrouter/anthropic/claude-3.5-sonnet",
  "createdAt": "2026-03-15T...",
  "owner": "0x..."
}
```

**Example:**
```bash
curl -X POST https://api.permaweb.run/api/pods \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"model": "openrouter/anthropic/claude-3.5-sonnet"}'
```

---

#### `GET /api/pods/:id`

Get a specific pod.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": "abc123",
  "status": "running",
  "model": "openrouter/anthropic/claude-3.5-sonnet",
  "createdAt": "2026-03-15T...",
  "owner": "0x...",
  "url": "https://abc123.pods.permaweb.run"
}
```

---

#### `DELETE /api/pods/:id`

Delete a pod.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```
204 No Content
```

---

### WebSocket Chat

#### `WS /ws`

WebSocket endpoint for real-time chat with pods.

**Connection:**
```javascript
const ws = new WebSocket('wss://api.permaweb.run/ws?pod=<pod-id>&token=<session-token>');

ws.onopen = () => {
  console.log('Connected to pod');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};

// Send a message
ws.send(JSON.stringify({
  type: 'message',
  content: 'Hello!'
}));
```

**Message Format:**
```json
// Send
{
  "type": "message",
  "content": "string"
}

// Receive
{
  "id": "string",
  "role": "user" | "assistant" | "system",
  "content": "string",
  "timestamp": "2026-03-15T..."
}
```

---

### LLM Providers

#### `GET /api/llm/providers`

List available LLM providers and models.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "providers": [
    {
      "id": "openrouter",
      "name": "OpenRouter",
      "models": [
        { "id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet" },
        { "id": "openai/gpt-4o", "name": "GPT-4o" }
      ]
    }
  ]
}
```

---

### Usage

#### `POST /api/usage`

Record usage for billing.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "podId": "string",
  "tokens": 1000,
  "model": "string"
}
```

---

#### `GET /api/usage`

Get usage statistics.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "usage": [
    {
      "date": "2026-03-15",
      "tokens": 50000,
      "cost": 5.00
    }
  ],
  "total": {
    "tokens": 500000,
    "cost": 50.00
  }
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

**Common Error Codes:**

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Missing or invalid session token |
| `INVALID_SIGNATURE` | Wallet signature verification failed |
| `POD_NOT_FOUND` | Pod does not exist |
| `POD_LIMIT_EXCEEDED` | User has too many pods |
| `RATE_LIMIT_EXCEEDED` | Too many requests |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/api/auth/*` | 10 req/min |
| `/api/pods` (POST) | 5 req/min |
| `/api/pods` (GET) | 100 req/min |
| WebSocket | 100 msg/min |

---

## SDK Examples

### JavaScript/TypeScript

```javascript
import { WebOSClient } from '@web-os/chat-sdk';

const client = new WebOSClient({ apiUrl: 'https://api.permaweb.run' });

// Authenticate
await client.connectEthereum();

// Create pod
const pod = await client.createPod({ model: 'claude-3.5-sonnet' });

// Connect WebSocket
client.connect(pod.id, (message) => {
  console.log('Received:', message);
});

// Send message
client.sendMessage('Hello!');
```

### Python

```python
import requests

# Get nonce
nonce_res = requests.post('https://api.permaweb.run/api/auth/nonce', json={
    'address': '0x...',
    'walletType': 'ethereum'
})
nonce_data = nonce_res.json()

# Sign with wallet (use web3.py or similar)
signature = sign_message(nonce_data['message'])

# Verify
verify_res = requests.post('https://api.permaweb.run/api/auth/verify', json={
    'address': '0x...',
    'signature': signature,
    'walletType': 'ethereum'
})
token = verify_res.json()['token']

# Create pod
pod_res = requests.post('https://api.permaweb.run/api/pods',
    headers={'Authorization': f'Bearer {token}'},
    json={'model': 'claude-3.5-sonnet'}
)
```

---

## Webhook Events (Future)

Webhooks for pod lifecycle events:

```json
{
  "event": "pod.created",
  "podId": "abc123",
  "owner": "0x...",
  "timestamp": "2026-03-15T..."
}
```

**Events:**
- `pod.created`
- `pod.started`
- `pod.stopped`
- `pod.deleted`
- `pod.error`

---

## OpenAPI Specification

Full OpenAPI 3.0 spec available at:
```
GET /openapi.json
```

---

## Support

- **GitHub Issues:** https://github.com/twilson63/permaweb-os/issues
- **Discord:** https://discord.gg/clawd
- **Email:** support@permaweb.run