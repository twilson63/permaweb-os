# Wallet Authentication

This document describes the wallet authentication system in Web OS, supporting both Ethereum and Arweave wallets.

## Supported Wallet Types

| Wallet Type | Address Format | Signature Algorithm |
|------------|----------------|---------------------|
| Ethereum | `0x` + 40 hex chars (42 total) | ECDSA secp256k1 (eth-personal-sign) |
| Arweave | Base64URL, 43 chars | RSA-PSS-SHA256 |

## Authentication Flow

### 1. Request Challenge

```
POST /api/auth/nonce
Content-Type: application/json

{
  "address": "vh-N1V...ABC"  // Arweave or Ethereum address
}

Response:
{
  "message": "Sign in to Web OS\n\nAddress: vh-N1V...ABC\nNonce: abc123\nIssued At: 2026-03-12T...",
  "nonce": "abc123...",
  "walletType": "arweave" | "ethereum"
}
```

The `message` field contains the exact string the user must sign with their wallet.

### 2. Sign Challenge

#### Ethereum Signing

```javascript
// Using ethers.js
const signature = await signer.signMessage(challengeMessage);
```

#### Arweave Signing

```javascript
// Using Arweave wallet (e.g., ArConnect, arweave.app)
const signature = await window.arweaveWallet.signMessage(
  challengeMessage,
  { name: 'RSA-PSS', saltLength: 32 }
);

// Alternatively, use signature algorithm directly
const signature = await window.arweaveWallet.signature(challengeMessage);
```

**Note:** Arweave signatures must be Base64URL-encoded.

### 3. Verify Signature

```
POST /api/auth/verify
Content-Type: application/json

{
  "address": "vh-N1V...ABC",
  "signature": "base64url-encoded-signature",
  "jwk": { ... }  // Optional: for Arweave, pre-resolved public key
}

Response:
{
  "token": "bearer-token-base64url",
  "expiresAt": "2026-03-13T..."
}
```

#### Optional JWK for Arweave

For Arweave wallets, you can optionally provide the JWK public key to avoid gateway lookups:

```javascript
// Get public key from Arweave wallet
const jwk = await window.arweaveWallet.getActiveAddress();
// Note: Arweave wallets typically only expose address, not full JWK
// If you have the JWK:
{
  "kty": "RSA",
  "n": "base64url-modulus",
  "e": "AQAB"
}
```

If JWK is not provided, the server will resolve the public key from Arweave gateway.

### 4. Use Session Token

Include the session token in subsequent requests:

```
GET /api/pods
Authorization: Bearer <token>
```

## Address Validation

### Ethereum

- Must start with `0x`
- Followed by exactly 40 hexadecimal characters
- Case-insensitive (normalized to lowercase)
- Example: `0x1234567890123456789012345678901234567890`

### Arweave

- Exactly 43 characters
- Base64URL character set: `A-Za-z0-9_-`
- Case-sensitive
- Example: `vh-N1VH0rFF5FPKKp0D4VW9SaFmMRv0YcWGaZtNlNxA`

## Signature Verification Details

### Ethereum (ECDSA secp256k1)

1. Challenge message is signed using `personal_sign`
2. Server recovers address from signature using `ethers.verifyMessage`
3. Recovered address must match claimed address (case-insensitive)

### Arweave (RSA-PSS-SHA256)

1. Challenge message is signed using RSA-PSS with SHA-256
2. Signature is Base64URL-encoded
3. Server resolves public key:
   - Option A: JWK provided in verify request
   - Option B: Query Arweave gateway for wallet's public key
4. Verify signature using RSA-PSS-SHA256 with salt length matching digest

## Public Key Resolution (Arweave)

When JWK is not provided, the server resolves the public key from Arweave:

1. Query `{gateway}/tx/{address}` for wallet's owner field
2. Owner field is the Base64URL-encoded modulus (n)
3. Exponent (e) is assumed to be `AQAB` (65537, standard for Arweave)
4. Construct JWK from owner field
5. Cache result for 1 hour

## HTTPSig Support

The HTTPSig sidecar supports Arweave signatures via the `arweave-rsa-pss-sha256` algorithm:

```http
Signature: keyId="vh-N1V...ABC", alg="arweave-rsa-pss-sha256", 
          created=1234567890, headers="(request-target) content-digest", 
          signature=base64url-encoded-signature
```

### Supported Algorithms

| Algorithm | Description |
|-----------|-------------|
| `eth-personal-sign` | Ethereum personal_sign (ECDSA secp256k1) |
| `arweave-rsa-pss-sha256` | Arweave RSA-PSS-SHA256 |
| `rsa-v1_5-sha256` | RSA PKCS#1 v1.5 with SHA-256 |
| `rsa-pss-sha256` | RSA-PSS with SHA-256 |
| `rsa-pss-sha512` | RSA-PSS with SHA-512 |
| `ecdsa-p256-sha256` | ECDSA P-256 with SHA-256 |
| `ecdsa-p384-sha384` | ECDSA P-384 with SHA-384 |

## Implementation Details

### Backend (api/)

- `auth/arweave.ts`: Arweave address validation, JWK handling, signature verification
- `auth/store.ts`: Challenge creation and verification for both wallet types
- `index.ts`: REST endpoints for `/api/auth/nonce` and `/api/auth/verify`

### Sidecar (opencode-sidecar/)

- `httpSig.ts`: HTTPSig verification including Arweave algorithm support

### Frontend (frontend/)

- Connect wallet using ArConnect, MetaMask, or similar
- Detect wallet type based on address format
- Sign challenge with appropriate method
- Submit signature to `/api/auth/verify`

## Error Handling

### Invalid Address

```json
{
  "error": "Invalid wallet address. Must be Ethereum (0x...) or Arweave (43-char base64url)"
}
```

### Invalid or Expired Challenge

```json
{
  "error": "Invalid or expired signature challenge"
}
```

### Signature Verification Failed

```json
{
  "error": "Invalid signature"
}
```

## Security Considerations

1. **Challenge Expiry**: Challenges expire after 5 minutes by default
2. **Session Expiry**: Sessions expire after 24 hours by default
3. **Replay Protection**: Signatures are tracked to prevent replay attacks
4. **Address Normalization**: Ethereum addresses normalized to lowercase for comparison
5. **Public Key Caching**: Arweave public keys cached for 1 hour to reduce gateway load

## Testing

```bash
# Run API tests
cd api && npm test

# Run sidecar tests
cd opencode-sidecar && npm test
```

## Example: Arweave Wallet Integration

```javascript
// Frontend code for Arweave wallet connection
async function signInWithArweave() {
  // 1. Get challenge from server
  const address = await window.arweaveWallet.getActiveAddress();
  const nonceResp = await fetch('/api/auth/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address })
  });
  const { message } = await nonceResp.json();
  
  // 2. Sign challenge with wallet
  const signature = await window.arweaveWallet.signMessage(message, {
    name: 'RSA-PSS',
    saltLength: 32
  });
  
  // 3. Verify signature with server
  const verifyResp = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature })
  });
  const { token, expiresAt } = await verifyResp.json();
  
  // 4. Store token for subsequent requests
  localStorage.setItem('sessionToken', token);
  return { token, expiresAt };
}
```

## Example: Ethereum Wallet Integration

```javascript
// Frontend code for Ethereum wallet connection
async function signInWithEthereum() {
  // 1. Connect wallet (MetaMask, etc.)
  const accounts = await window.ethereum.request({ 
    method: 'eth_requestAccounts' 
  });
  const address = accounts[0];
  
  // 2. Get challenge from server
  const nonceResp = await fetch('/api/auth/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address })
  });
  const { message } = await nonceResp.json();
  
  // 3. Sign challenge (ethers.js)
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const signature = await signer.signMessage(message);
  
  // 4. Verify signature with server
  const verifyResp = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature })
  });
  const { token, expiresAt } = await verifyResp.json();
  
  // 5. Store token for subsequent requests
  localStorage.setItem('sessionToken', token);
  return { token, expiresAt };
}
```