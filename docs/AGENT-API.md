# PermawebOS Agent API

> OpenCode REST API for agent communication

## Overview

PermawebOS exposes OpenCode's REST API for agent communication. This allows developers to:

- Create and manage sessions
- Send messages synchronously or asynchronously
- Stream real-time events via SSE
- Access files and tools

## Base URL

```
http://localhost:4096  (development)
https://api.permaweb.run (production, via auth-proxy)
```

## Authentication

### Development (No Auth)

```bash
# No authentication required for local development
curl http://localhost:4096/session
```

### Production (Arweave Wallet)

```javascript
// 1. Request nonce
const nonce = await fetch('https://api.permaweb.run/api/auth/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: walletAddress })
}).then(r => r.json());

// 2. Sign with Arweave wallet
const signature = await window.arweaveWallet.sign(nonce.transaction);

// 3. Verify and get session token
const { token } = await fetch('https://api.permaweb.run/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        address: walletAddress,
        signature: signature.signature,
        ...nonce.transaction
    })
}).then(r => r.json());

// 4. Use token in subsequent requests
fetch('https://api.permaweb.run/session', {
    headers: { 'Authorization': `Bearer ${token}` }
});
```

## Sessions

### Create Session

```http
POST /session
Content-Type: application/json

{
    "title": "My Agent Session",
    "parentID": "optional-parent-id"
}
```

**Response:**
```json
{
    "id": "ses_307ff8042ffee8wUY42dhfKvOX",
    "title": "My Agent Session",
    "createdAt": 1773698843299,
    "parentID": null
}
```

### List Sessions

```http
GET /session
```

**Response:**
```json
[
    { "id": "ses_xxx", "title": "...", ... },
    { "id": "ses_yyy", "title": "...", ... }
]
```

### Get Session

```http
GET /session/:id
```

### Delete Session

```http
DELETE /session/:id
```

## Messages

### Send Message (Sync)

Waits for the agent to complete before responding.

```http
POST /session/:id/message
Content-Type: application/json

{
    "parts": [
        { "type": "text", "text": "Hello! What can you help me with?" }
    ],
    "model": "anthropic/claude-opus-4-6",
    "agent": "optional-agent-id"
}
```

**Response:**
```json
{
    "info": {
        "id": "msg_xxx",
        "sessionID": "ses_xxx",
        "createdAt": 1773698843299
    },
    "parts": [
        {
            "id": "prt_xxx",
            "type": "text",
            "text": "Hello! I can help you with..."
        }
    ]
}
```

### Send Message (Async)

Returns immediately, use SSE to receive response.

```http
POST /session/:id/prompt_async
Content-Type: application/json

{
    "parts": [
        { "type": "text", "text": "Hello!" }
    ],
    "model": "anthropic/claude-opus-4-6"
}
```

**Response:** `204 No Content`

### Get Messages

```http
GET /session/:id/message?limit=50
```

## Events (SSE)

### Connect to Event Stream

```javascript
const es = new EventSource('http://localhost:4096/event');

es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    console.log('Event:', data);
};

es.onerror = (e) => {
    console.error('SSE Error:', e);
};
```

### Event Types

| Event | Description |
|-------|-------------|
| `server.connected` | Initial connection established |
| `session.updated` | Session state changed |
| `message.updated` | New message created |
| `message.part.updated` | Message part streaming |
| `file.edited` | File was modified |
| `command.executed` | Command ran |

### Example Event Data

```json
{
    "type": "message.part.updated",
    "sessionID": "ses_xxx",
    "part": {
        "id": "prt_xxx",
        "type": "text",
        "text": "Hello! I'm..."
    }
}
```

## Models

### List Available Models

```http
GET /config/providers
```

**Response:**
```json
{
    "providers": [
        { "id": "anthropic", "name": "Anthropic", ... },
        { "id": "openai", "name": "OpenAI", ... }
    ],
    "default": {
        "anthropic": "anthropic/claude-opus-4-6",
        "openai": "openai/gpt-5.3-codex"
    }
}
```

### Common Models

| Model ID | Description |
|----------|-------------|
| `anthropic/claude-opus-4-6` | Claude Opus 4.6 (most capable) |
| `anthropic/claude-sonnet-4-5` | Claude Sonnet 4.5 (fast) |
| `openai/gpt-5.3-codex` | GPT-5.3 Codex |
| `opencode/big-pickle` | OpenCode's default model |

## Files

### Read File

```http
GET /file/content?path=/path/to/file.ts
```

### Search Files

```http
GET /find?pattern=searchTerm
GET /find/file?query=filename
GET /find/symbol?query=functionName
```

## Tools

### List Available Tools

```http
GET /experimental/tool?provider=anthropic&model=claude-opus-4-6
```

## Agents

### List Agents

```http
GET /agent
```

**Response:**
```json
[
    { "id": "default", "name": "Default Agent", ... }
]
```

## Complete Example

### JavaScript/TypeScript

```javascript
// Create session
const session = await fetch('http://localhost:4096/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'My Session' })
}).then(r => r.json());

console.log('Session:', session.id);

// Connect to event stream
const es = new EventSource(`http://localhost:4096/event`);

es.addEventListener('message.part.updated', (e) => {
    const data = JSON.parse(e.data);
    console.log('Stream:', data.part.text);
});

// Send message async
await fetch(`http://localhost:4096/session/${session.id}/prompt_async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        parts: [{ type: 'text', text: 'Write a hello world in Python' }],
        model: 'anthropic/claude-opus-4-6'
    })
});

// Listen for completion
es.addEventListener('message.updated', (e) => {
    const data = JSON.parse(e.data);
    console.log('Message complete:', data);
    es.close();
});
```

### Python

```python
import requests
import json

BASE_URL = 'http://localhost:4096'

# Create session
session = requests.post(
    f'{BASE_URL}/session',
    json={'title': 'My Session'}
).json()

print(f'Session: {session["id"]}')

# Send message
response = requests.post(
    f'{BASE_URL}/session/{session["id"]}/message',
    json={
        'parts': [{'type': 'text', 'text': 'Hello!'}],
        'model': 'anthropic/claude-opus-4-6'
    }
).json()

print(f'Response: {response["parts"][0]["text"]}')
```

### cURL

```bash
# Create session
SESSION=$(curl -s -X POST http://localhost:4096/session \
    -H 'Content-Type: application/json' \
    -d '{"title":"Test"}' | jq -r '.id')

# Send message
curl -X POST http://localhost:4096/session/$SESSION/message \
    -H 'Content-Type: application/json' \
    -d '{
        "parts": [{"type": "text", "text": "Hello!"}],
        "model": "anthropic/claude-opus-4-6"
    }' | jq .

# Stream events (requires curl 7.82+)
curl --no-buffer http://localhost:4096/event
```

## Error Handling

All errors follow this format:

```json
{
    "error": {
        "code": "SESSION_NOT_FOUND",
        "message": "Session ses_xxx not found"
    }
}
```

### Common Error Codes

| Code | Description |
|------|-------------|
| `SESSION_NOT_FOUND` | Session ID doesn't exist |
| `INVALID_REQUEST` | Malformed request body |
| `MODEL_NOT_FOUND` | Specified model doesn't exist |
| `RATE_LIMITED` | Too many requests |
| `UNAUTHORIZED` | Authentication required |

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /session/:id/message` | 60/minute |
| `GET /event` | 10 concurrent connections |
| `GET /file/content` | 100/minute |

## OpenAPI Specification

Full OpenAPI 3.1 spec available at:

```
http://localhost:4096/doc
```

## SDK

JavaScript/TypeScript SDK available:

```bash
npm install @opencode/sdk
```

```typescript
import { OpenCode } from '@opencode/sdk';

const client = new OpenCode({ baseUrl: 'http://localhost:4096' });

// Create session
const session = await client.session.create({ title: 'My Session' });

// Send message
const response = await client.session.message(session.id, {
    parts: [{ type: 'text', text: 'Hello!' }],
    model: 'anthropic/claude-opus-4-6'
});

// Stream events
for await (const event of client.events()) {
    console.log(event);
}
```

---

*Last updated: 2026-03-16*