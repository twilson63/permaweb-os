# Permaweb OS - User Journey

> A platform where you connect your wallet, spawn a personal OpenCode pod, and chat with your own AI assistant through cryptographically signed requests. Your pod, your code, your keys.

---

## The Vision

You own your AI assistant. Not a shared service where your data lives on someone else's servers. Your own isolated container with your own API keys, your own code, your own conversations.

Connect your wallet, spawn a pod, and start chatting. That's it.

---

## The Flow

### 0. Admin Sets Up Cluster (One-Time)

```
┌─────────────────────────────────────────────────────────────────┐
│  Cluster Admin                                                  │
│                                                                 │
│  1. Deploy Permaweb OS to Kubernetes                            │
│                                                                 │
│  2. Create LLM API keys secret:                                 │
│     kubectl create secret generic llm-api-keys \               │
│       --from-literal=openai=sk-... \                            │
│       --from-literal=anthropic=sk-ant-... \                     │
│       -n web-os                                                 │
│                                                                 │
│  3. The keys are now available to ALL pods                      │
│     - Mounted read-only at /secrets/llm/                        │
│     - Users NEVER see the actual keys                           │
│     - Admin can rotate keys without user action                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight:** Users don't bring their own LLM keys. The platform provides them.

### 1. Connect Your Wallet

```
┌─────────────────────────────────────────────────────────────────┐
│  Your App                                                       │
│                                                                 │
│  [Connect Wallet] ← User clicks this                           │
│                                                                 │
│  App: "Please sign this message to authenticate"                │
│  Message: "Sign in to Permaweb OS at 2024-03-09T12:00:00Z"      │
│                                                                 │
│  User signs with their wallet (Arweave, Ethereum, RSA, ECDSA)   │
│                                                                 │
│  App sends signature to: api.permaweb.live/auth/verify         │
│                                                                 │
│  Server verifies signature, returns session token               │
│                                                                 │
│  App stores token: localStorage or secure storage              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**What happens:**
- Your app requests a challenge from `POST /api/auth/nonce`
- User signs the challenge with their wallet
- App sends signature to `POST /api/auth/verify`
- Server verifies signature, creates session
- Returns session token for subsequent requests

### 2. Create Your Pod

```
┌─────────────────────────────────────────────────────────────────┐
│  Your App                                                       │
│                                                                 │
│  User: "I want a pod with Claude 3.5 Haiku"                      │
│                                                                 │
│  App: POST /api/pods                                            │
│       Authorization: Bearer <session-token>                      │
│       { model: "anthropic/claude-3-5-haiku" }                   │
│                                                                 │
│  Server: Creates pod                                            │
│          - Spawns OpenCode container                            │
│          - Mounts ADMIN's LLM keys at /secrets/llm/             │
│            (user never sees the actual keys)                    │
│          - Assigns subdomain: abc123.pods.permaweb.live         │
│          - Tracks usage for billing                             │
│                                                                 │
│  Response:                                                      │
│       {                                                          │
│         id: "abc123",                                            │
│         subdomain: "abc123.pods.permaweb.live",                │
│         model: "anthropic/claude-3-5-haiku",                    │
│         status: "running"                                        │
│       }                                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**What happens:**
- Server creates a Kubernetes pod with:
  - OpenCode container (port 4096)
  - HTTPSig sidecar (port 3001)
  - **Admin's LLM keys** mounted read-only (NOT the user's keys)
- Pod is bound to your wallet address
- You get a unique subdomain
- Usage is tracked per wallet for billing/analytics

### 3. Chat With Your Pod

```
┌─────────────────────────────────────────────────────────────────┐
│  Your App                          Your Pod                     │
│                                                                 │
│  User types: "Write a function that sorts an array"            │
│                                                                 │
│  App creates request:                                           │
│       { content: "Write a function that sorts an array" }       │
│                                                                 │
│  App signs request with wallet:                                 │
│       Signature: sig1=:YWJjZGVm...:                             │
│       Signature-Input: sig1=("@method" "@path" "host")...       │
│                                                                 │
│  App sends to pod:                                              │
│       POST https://abc123.pods.permaweb.live/verify             │
│       Headers: [Signature, Signature-Input, Content-Type]       │
│       Body: { content: "Write a function..." }                  │
│                                                                 │
│                              ┌───────────────────────────────┐  │
│                              │ HTTPSig Sidecar (port 3001)  │  │
│                              │                               │  │
│                              │ 1. Extract signature          │  │
│                              │ 2. Extract keyId              │  │
│                              │ 3. Compare to pod owner      │  │
│                              │    keyId == owner? ✓         │  │
│                              │ 4. Forward to OpenCode       │  │
│                              └───────────────────────────────┘  │
│                                                                 │
│                              ┌───────────────────────────────┐  │
│                              │ OpenCode (port 4096)         │  │
│                              │                               │  │
│                              │ 5. Read API key               │  │
│                              │    /secrets/llm/anthropic     │  │
│                              │ 6. Process request            │  │
│                              │ 7. Stream JSONL response      │  │
│                              └───────────────────────────────┘  │
│                                                                 │
│  App receives JSONL stream:                                     │
│       {"type":"step_start","sessionID":"ses_..."}               │
│       {"type":"text","text":"Here's a function..."}             │
│       {"type":"tool_use","tool":"write","path":"sort.ts"}       │
│       {"type":"tool_result","result":"File created"}            │
│       {"type":"text","text":"I've created sort.ts..."}          │
│       {"type":"step_finish","reason":"stop"}                    │
│                                                                 │
│  App streams response to user in real-time                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**What happens:**
1. Your app creates the request JSON
2. Your app signs it with your wallet (HTTPSig)
3. Request goes to YOUR pod's subdomain
4. HTTPSig sidecar verifies you own the pod
5. OpenCode processes with YOUR API keys
6. Response streams back as JSONL

---

## The Request Format

### Creating a Signed Request

```typescript
import { signatureHeaders } from 'http-message-sig';
import { Wallet } from 'ethers';

async function createSignedRequest(
  wallet: Wallet,
  content: string,
  podSubdomain: string
) {
  // Create the request
  const request = {
    content,
    // Optional: sessionId for conversation continuity
    // sessionId: "ses_abc123"
  };

  // Create the HTTP message signature
  const message = {
    method: 'POST',
    url: '/verify',
    protocol: 'https',
    headers: {
      host: podSubdomain,
      date: new Date().toUTCString(),
    },
  };

  // Sign with wallet
  const signer = {
    keyid: wallet.address.toLowerCase(),
    alg: 'eth-personal-sign',
    sign: async (signingString: string) => {
      const signature = await wallet.signMessage(signingString);
      // Convert hex signature to bytes
      return Buffer.from(signature.slice(2), 'hex');
    },
  };

  const headers = await signatureHeaders(message, {
    signer,
    components: ['@method', '@path', 'host', 'date'],
  });

  // Send the request
  const response = await fetch(`https://${podSubdomain}/verify`, {
    method: 'POST',
    headers: {
      date: message.headers.date,
      signature: headers.Signature,
      'signature-input': headers['Signature-Input'],
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  // Parse JSONL stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    for (const line of chunk.split('\n')) {
      if (line.trim()) {
        const event = JSON.parse(line);
        yield event;
      }
    }
  }
}
```

### Streaming the Response

```typescript
// In your app
for await (const event of createSignedRequest(wallet, 'Hello', 'abc123.pods.permaweb.live')) {
  switch (event.type) {
    case 'text':
      // Display text to user
      displayText(event.text);
      break;

    case 'tool_use':
      // Show what the AI is doing
      displayAction(`Using ${event.tool} on ${event.path}`);
      break;

    case 'tool_result':
      // Show result
      displayResult(event.result);
      break;

    case 'step_finish':
      // Conversation turn complete
      displayComplete();
      break;
  }
}
```

---

## What You Can Build

### Web App (React/Vue)

```tsx
function ChatApp() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  async function sendMessage() {
    for await (const event of createSignedRequest(wallet, input, podSubdomain)) {
      if (event.type === 'text') {
        setMessages(prev => [...prev, { role: 'assistant', content: event.text }]);
      }
    }
  }

  return (
    <div>
      {messages.map((msg, i) => (
        <div key={i}>{msg.content}</div>
      ))}
      <input value={input} onChange={e => setInput(e.target.value)} />
      <button onClick={sendMessage}>Send</button>
    </div>
  );
}
```

### Mobile App (React Native)

```typescript
// Same flow, but use mobile wallet connection
import WalletConnect from '@walletconnect/react-native';

// Sign requests with mobile wallet
// Display responses in your app
```

### CLI Tool

```bash
# Install
npm install -g permaweb-cli

# Connect wallet
permaweb connect --wallet metamask

# Create pod
permaweb pod create --model claude-3-5-haiku

# Chat
permaweb chat "Hello, how can you help me?"

# Stream output in real-time
```

### IDE Plugin (VS Code)

```typescript
// Extension that:
// 1. Connects wallet
// 2. Creates/manages pod
// 3. Sends code context to pod
// 4. Displays AI suggestions inline
```

---

## Why This Matters

### Traditional SaaS vs Permaweb OS

| Traditional SaaS | Permaweb OS |
|-----------------|--------------|
| User account + password | Wallet = identity |
| Shared infrastructure | Your own pod |
| API keys in their database | **Admin provides LLM keys** |
| They see your conversations | Only you see your conversations |
| Trust them with your data | You control your data |
| They can be subpoenaed | Decentralized, no single point of failure |
| Per-user API keys required | **No API keys needed from users** |

### Key Design: Admin-Provided LLM Keys

```
Traditional AI Platform:
  User → Brings own API key → Stored in database → Risk of exposure

Permaweb OS:
  Admin → Sets cluster-wide LLM keys → Mounted to pods securely
                                              │
  User → Creates pod → Uses admin's keys (never sees them)
                                              │
  Platform → Tracks usage per wallet → Admin bills accordingly
```

**Benefits:**
- Users don't need LLM API keys to get started
- Admin manages and rotates keys centrally
- Keys are never exposed to users (mounted read-only)
- Usage is tracked per wallet for billing
- Simple user onboarding (just connect wallet)

### Security Model

```
Traditional:
  User → Password → Server → Database (they see everything)

Permaweb OS:
  User → Wallet Signature → Your Pod
         │                      │
         │                 Admin's LLM Keys
         │                 (mounted, never exposed)
         │                      │
         └── Cryptographic proof ─┘
            that YOU made the request
```

### What's NOT Stored

- Admin's LLM API keys (mounted, never returned by API)
- Your conversations happen in your pod
- Your code lives in your pod
- No central database of your data

### What IS Stored

- Pod metadata (id, subdomain, model, owner wallet)
- Usage statistics (token counts, costs) per wallet
- Session tokens (temporary, expire)

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLUSTER ADMIN SETUP                         │
│                                                                 │
│  kubectl create secret generic llm-api-keys \                   │
│    --from-literal=openai=sk-... \                               │
│    --from-literal=anthropic=sk-ant-...                          │
│                                                                 │
│  These keys are available to ALL pods in the cluster.          │
│  Users never see or manage these keys.                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Mounted to each pod
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         YOUR POD                                │
│                                                                 │
│  ┌─────────────────┐      ┌─────────────────┐                  │
│  │ HTTPSig Sidecar │ ───→ │ OpenCode        │                  │
│  │ (port 3001)     │      │ (port 4096)     │                  │
│  │                 │      │                 │                  │
│  │ • Verify sig    │      │ • Process msg   │                  │
│  │ • Only your     │      │ • Use ADMIN's  │                  │
│  │   wallet        │      │   keys         │                  │
│  │ • Forward to    │      │ • Return JSONL  │                  │
│  │   OpenCode      │      │                 │                  │
│  └─────────────────┘      └─────────────────┘                  │
│           │                          │                         │
│           │ Only requests             │                         │
│           │ signed by YOUR wallet      │                         │
│           │                           │                         │
│  ┌─────────────────┐                 │                         │
│  │ /secrets/llm/   │ ←─ Admin's keys │                         │
│  │   anthropic     │   (read-only)   │                         │
│  │   openai        │                 │                         │
│  └─────────────────┘                 │                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Getting Started

### 0. Admin: Set Up Cluster (One-Time)

```bash
# Clone the repo
git clone https://github.com/twilson63/permaweb-os.git
cd permaweb-os

# Deploy to Kubernetes
kubectl apply -f k8s/

# Create LLM API keys secret (users will use these)
kubectl create secret generic llm-api-keys \
  --from-literal=openai=sk-YOUR-OPENAI-KEY \
  --from-literal=anthropic=sk-ant-YOUR-ANTHROPIC-KEY \
  -n web-os

# Or use DigitalOcean deployment
./scripts/deploy-digitalocean.sh
```

**Admin responsibility:**
- Deploy the cluster
- Provide LLM API keys
- Monitor usage across wallets
- Bill users based on token consumption

### 1. User: Connect Your Wallet

```bash
# Connect wallet, get session token
curl -X POST https://api.permaweb.live/auth/nonce \
  -H "Content-Type: application/json" \
  -d '{"address":"0xYourWallet"}'

# Sign the nonce with your wallet

# Get session token
curl -X POST https://api.permaweb.live/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"0xYourWallet","signature":"0x...","nonce":"..."}'
```

### 2. User: Create Your Pod

```bash
# Create pod (uses admin's LLM keys, not yours)
curl -X POST https://api.permaweb.live/pods \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-3-5-haiku"}'
```

### 3. User: Start Chatting

```typescript
// In your app
for await (const event of createSignedRequest(wallet, 'Hello!', 'abc123.pods.permaweb.live')) {
  console.log(event);
}
```

---

## The Future

- **Multi-pod workflows** - Chain pods together
- **Pod marketplace** - Share/sell pod configurations
- **Decentralized hosting** - Run pods on decentralized infrastructure
- **Permanent storage** - Store conversations on Arweave
- **Pod collaboration** - Invite others to your pod

---

## Conclusion

Permaweb OS is about **ownership**:

- You own your identity (your wallet)
- You own your pod (your container)
- You own your keys (your API access)
- You own your data (your conversations)

No middleman. No shared infrastructure. No trust required beyond cryptography.

Connect wallet → Create pod → Chat. That's it.

---

**Live Demo**: Coming soon at permaweb.live  
**GitHub**: https://github.com/twilson63/permaweb-os  
**Docs**: https://github.com/twilson63/permaweb-os/blob/main/README.md