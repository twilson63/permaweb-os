# Arweave Wallet Authentication Plan

## Overview

Add Arweave wallet support to Permaweb OS authentication, enabling users to sign in with Arweave wallets (ArConnect, Arweave.app, or keyfile) alongside the existing Ethereum support.

## Current State

```typescript
// api/src/auth/store.ts - ONLY Ethereum supported
const recoveredAddress = utils.verifyMessage(challenge.message, signature);
if (recoveredAddress.toLowerCase() !== addressKey) {
  return null;
}
```

**Gap:** Ethereum's `personal_sign` only. No Arweave RSA-PSS signature verification.

## Arweave Signature Fundamentals

| Aspect | Ethereum | Arweave |
|--------|----------|---------|
| Address format | `0x...` (40 hex chars) | Base64URL (43 chars, no prefix) |
| Key type | ECDSA (secp256k1) | RSA (2048-bit) or Ed25519 |
| Signature algorithm | ECDSA + Keccak256 | RSA-PSS (RSA) or EdDSA (Ed25519) |
| Signing API | `personal_sign(message, privateKey)` | Arweave SDK `sign(message, key)` |
| Verification | Recover address from signature | Verify with public key (JWK) |
| Wallet extension | `window.ethereum` | `window.arweaveWallet` |

## Implementation Plan

### Phase 1: Core Verification (2-3 days)

#### 1.1 Install Arweave Dependencies

```bash
cd api
npm install arweave
npm install @noble/ed25519  # For Ed25519 wallets
```

#### 1.2 Create Arweave Signature Verifier

```typescript
// api/src/auth/arweaveVerifier.ts
import Arweave from 'arweave';

export interface ArweaveVerificationResult {
  valid: boolean;
  address: string | null;
  error?: string;
}

/**
 * Verifies an Arweave signature against a message.
 * 
 * @param message - The original message that was signed
 * @param signature - Base64URL-encoded signature
 * @param address - Expected Arweave address (owner)
 * @returns Verification result
 */
export async function verifyArweaveSignature(
  message: string,
  signature: string,
  address: string
): Promise<ArweaveVerificationResult> {
  const arweave = Arweave.init({});
  
  try {
    // Get public key (JWK) from address
    const publicKey = await getPublicKeyFromAddress(address);
    
    // Verify signature using RSA-PSS
    const valid = await arweave.crypto.verify(
      publicKey,
      arweave.utils.stringToBuffer(message),
      arweave.utils.b64UrlToBuffer(signature)
    );
    
    return { valid, address: valid ? address : null };
  } catch (error) {
    return {
      valid: false,
      address: null,
      error: error instanceof Error ? error.message : 'Verification failed'
    };
  }
}

/**
 * Derives the public key (JWK) from an Arweave address.
 * The address IS the SHA-256 hash of the RSA public key modulus.
 */
async function getPublicKeyFromAddress(address: string): Promise<Uint8Array> {
  // For ArConnect/wallet extensions, we need to use their API
  // For keyfile-based auth, the public key is in the JWK
  // This requires the signature to include the public key or be fetched
  // See: https://docs.arweave.org/developers/server/http-api#public-key
  const response = await fetch(`https://arweave.net/wallet/${address}/public_key`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch public key');
  }
  
  const publicKeyB64 = await response.text();
  return Arweave.utils.b64UrlToBuffer(publicKeyB64);
}
```

#### 1.3 Address Type Detection

```typescript
// api/src/auth/addressDetector.ts

/**
 * Detects wallet type from address format.
 */
export type WalletType = 'ethereum' | 'arweave';

export function detectWalletType(address: string): WalletType {
  const trimmed = address.trim();
  
  // Ethereum: 0x followed by 40 hex chars
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return 'ethereum';
  }
  
  // Arweave: 43-char Base64URL (no 0x prefix)
  if (/^[a-zA-Z0-9_-]{43}$/.test(trimmed)) {
    return 'arweave';
  }
  
  throw new Error('Unknown address format');
}
```

#### 1.4 Update Auth Store

```typescript
// api/src/auth/store.ts - Updated verifySignature method

import { detectWalletType, WalletType } from './addressDetector';
import { verifyArweaveSignature } from './arweaveVerifier';

export class AuthStore {
  // ... existing code ...
  
  async verifySignature(address: string, signature: string): Promise<SessionRecord | null> {
    const walletType = detectWalletType(address);
    
    if (walletType === 'ethereum') {
      return this.verifyEthereumSignature(address, signature);
    } else if (walletType === 'arweave') {
      return this.verifyArweaveSignatureAsync(address, signature);
    }
    
    return null;
  }
  
  private verifyEthereumSignature(address: string, signature: string): SessionRecord | null {
    // Existing Ethereum verification
    const normalizedAddress = this.normalizeAddress(address);
    const addressKey = normalizedAddress.toLowerCase();
    const challenge = this.challenges.get(addressKey);
    
    if (!challenge || challenge.expiresAt < Date.now()) {
      this.challenges.delete(addressKey);
      return null;
    }
    
    const recoveredAddress = utils.verifyMessage(challenge.message, signature);
    
    if (recoveredAddress.toLowerCase() !== addressKey) {
      return null;
    }
    
    this.challenges.delete(addressKey);
    return this.createSession(normalizedAddress);
  }
  
  private async verifyArweaveSignatureAsync(address: string, signature: string): Promise<SessionRecord | null> {
    const normalizedAddress = address.trim();
    const challenge = this.challenges.get(normalizedAddress);
    
    if (!challenge || challenge.expiresAt < Date.now()) {
      this.challenges.delete(normalizedAddress);
      return null;
    }
    
    const result = await verifyArweaveSignature(challenge.message, signature, normalizedAddress);
    
    if (!result.valid) {
      return null;
    }
    
    this.challenges.delete(normalizedAddress);
    return this.createSession(normalizedAddress, 'arweave');
  }
  
  private createSession(address: string, walletType: WalletType = 'ethereum'): SessionRecord {
    const token = randomBytes(32).toString('base64url');
    const expiresAtMs = Date.now() + this.sessionTtlMs;
    
    this.sessions.set(token, {
      address,
      walletType,
      expiresAtMs
    });
    
    return {
      token,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }
  
  private normalizeAddress(address: string, walletType?: WalletType): string {
    const type = walletType || detectWalletType(address);
    
    if (type === 'ethereum') {
      const trimmed = address.trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
        throw new Error('Invalid Ethereum address');
      }
      return trimmed;
    }
    
    if (type === 'arweave') {
      const trimmed = address.trim();
      if (!/^[a-zA-Z0-9_-]{43}$/.test(trimmed)) {
        throw new Error('Invalid Arweave address');
      }
      return trimmed;
    }
    
    throw new Error('Unsupported wallet type');
  }
}
```

### Phase 2: Frontend Integration (2 days)

#### 2.1 ArConnect Detection

```typescript
// frontend/src/wallets/arweave.ts

declare global {
  interface Window {
    arweaveWallet?: {
      connect: (permissions: string[]) => Promise<void>;
      disconnect: () => Promise<void>;
      getActiveAddress: () => Promise<string>;
      sign: (data: Uint8Array, options?: SignOptions) => Promise<Uint8Array>;
      signature: (data: Uint8Array, options?: SignOptions) => Promise<Signature>;
    };
  }
}

interface SignOptions {
  algorithm: string;
  hashAlgorithm?: string;
}

interface Signature {
  data: Uint8Array;
}

export async function isArConnectInstalled(): Promise<boolean> {
  return typeof window.arweaveWallet !== 'undefined';
}

export async function connectArweaveWallet(): Promise<string> {
  if (!await isArConnectInstalled()) {
    throw new Error('ArConnect not installed. Please install from arconnect.io');
  }
  
  // Request permissions
  await window.arweaveWallet!.connect([
    'ACCESS_ADDRESS',
    'ACCESS_PUBLIC_KEY',
    'SIGNATURE'
  ]);
  
  const address = await window.arweaveWallet!.getActiveAddress();
  return address;
}

export async function signWithArweave(message: string): Promise<string> {
  if (!window.arweaveWallet) {
    throw new Error('ArConnect not connected');
  }
  
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  
  // Use RSA-PSS for Arweave signatures
  const signature = await window.arweaveWallet.signature(data, {
    algorithm: 'RSA-PSS',
    hashAlgorithm: 'SHA-256'
  });
  
  // Return Base64URL encoded signature
  return btoa(String.fromCharCode(...signature.data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
```

#### 2.2 Unified Wallet Hook

```typescript
// frontend/src/hooks/useWallet.ts

import { useState, useCallback } from 'react';
import { detectWalletType } from '../wallets/detector';
import { connectEthereumWallet, signWithEthereum } from '../wallets/ethereum';
import { connectArweaveWallet, signWithArweave } from '../wallets/arweave';

export type WalletType = 'ethereum' | 'arweave';

interface WalletState {
  address: string | null;
  type: WalletType | null;
  isConnected: boolean;
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    type: null,
    isConnected: false
  });
  
  const connect = useCallback(async (preferredType?: WalletType) => {
    // If preferred type specified, try that first
    if (preferredType === 'arweave') {
      try {
        const address = await connectArweaveWallet();
        setWallet({ address, type: 'arweave', isConnected: true });
        return;
      } catch (e) {
        console.warn('Arweave connection failed, trying Ethereum:', e);
      }
    }
    
    if (preferredType === 'ethereum' || !preferredType) {
      try {
        const address = await connectEthereumWallet();
        setWallet({ address, type: 'ethereum', isConnected: true });
        return;
      } catch (e) {
        console.warn('Ethereum connection failed:', e);
      }
    }
    
    // Auto-detect available wallets
    if (await isArConnectInstalled()) {
      const address = await connectArweaveWallet();
      setWallet({ address, type: 'arweave', isConnected: true });
    } else if (await isMetaMaskInstalled()) {
      const address = await connectEthereumWallet();
      setWallet({ address, type: 'ethereum', isConnected: true });
    } else {
      throw new Error('No supported wallet found. Please install MetaMask or ArConnect.');
    }
  }, []);
  
  const sign = useCallback(async (message: string): Promise<string> => {
    if (!wallet.address || !wallet.type) {
      throw new Error('Wallet not connected');
    }
    
    if (wallet.type === 'ethereum') {
      return signWithEthereum(message);
    } else if (wallet.type === 'arweave') {
      return signWithArweave(message);
    }
    
    throw new Error('Unknown wallet type');
  }, [wallet]);
  
  const disconnect = useCallback(async () => {
    if (wallet.type === 'arweave' && window.arweaveWallet) {
      await window.arweaveWallet.disconnect();
    }
    setWallet({ address: null, type: null, isConnected: false });
  }, [wallet.type]);
  
  return {
    ...wallet,
    connect,
    sign,
    disconnect
  };
}
```

#### 2.3 Auth Flow Integration

```typescript
// frontend/src/auth/login.ts

import { useWallet } from '../hooks/useWallet';

export async function login(wallet: ReturnType<typeof useWallet>) {
  // 1. Get nonce from server
  const nonceRes = await fetch('https://api.permaweb.live/api/auth/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: wallet.address })
  });
  
  const { message, nonce } = await nonceRes.json();
  
  // 2. Sign the challenge message
  const signature = await wallet.sign(message);
  
  // 3. Verify and get session
  const verifyRes = await fetch('https://api.permaweb.live/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: wallet.address,
      signature,
      nonce
    })
  });
  
  const { token, expiresAt } = await verifyRes.json();
  
  return { token, expiresAt };
}
```

### Phase 3: UI Components (1 day)

#### 3.1 Wallet Connect Modal

```tsx
// frontend/src/components/WalletConnectModal.tsx

import { useState } from 'react';
import { useWallet } from '../hooks/useWallet';

interface Props {
  onClose: () => void;
  onConnected: () => void;
}

export function WalletConnectModal({ onClose, onConnected }: Props) {
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { connect } = useWallet();
  
  const handleConnect = async (type: 'ethereum' | 'arweave') => {
    setConnecting(type);
    setError(null);
    
    try {
      await connect(type);
      onConnected();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setConnecting(null);
    }
  };
  
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Connect Wallet</h2>
        
        <button
          className="wallet-option"
          onClick={() => handleConnect('arweave')}
          disabled={connecting !== null}
        >
          <img src="/arconnect-logo.svg" alt="ArConnect" />
          <span>
            {connecting === 'arweave' ? 'Connecting...' : 'ArConnect (Arweave)'}
          </span>
        </button>
        
        <button
          className="wallet-option"
          onClick={() => handleConnect('ethereum')}
          disabled={connecting !== null}
        >
          <img src="/metamask-logo.svg" alt="MetaMask" />
          <span>
            {connecting === 'ethereum' ? 'Connecting...' : 'MetaMask (Ethereum)'}
          </span>
        </button>
        
        {error && <p className="error">{error}</p>}
        
        <button className="close" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
```

### Phase 4: Testing (1-2 days)

#### 4.1 Unit Tests

```typescript
// api/src/auth/__tests__/arweaveVerifier.test.ts

import { verifyArweaveSignature } from '../arweaveVerifier';
import Arweave from 'arweave';

describe('Arweave Signature Verification', () => {
  let arweave: Arweave;
  let testKey: JWKInterface;
  let testAddress: string;
  
  beforeAll(async () => {
    arweave = Arweave.init({});
    testKey = await arweave.wallets.generate();
    testAddress = await arweave.wallets.jwkToAddress(testKey);
  });
  
  it('should verify a valid Arweave signature', async () => {
    const message = 'Sign in to Web OS\n\nAddress: ' + testAddress + '\nNonce: abc123';
    const messageBuffer = arweave.utils.stringToBuffer(message);
    
    const signature = await arweave.crypto.sign(testKey, messageBuffer);
    const signatureB64 = arweave.utils.bufferTob64Url(signature);
    
    const result = await verifyArweaveSignature(message, signatureB64, testAddress);
    
    expect(result.valid).toBe(true);
    expect(result.address).toBe(testAddress);
  });
  
  it('should reject an invalid signature', async () => {
    const message = 'Sign in to Web OS';
    const wrongSignature = 'invalid_signature_b64url';
    
    const result = await verifyArweaveSignature(message, wrongSignature, testAddress);
    
    expect(result.valid).toBe(false);
    expect(result.address).toBeNull();
  });
  
  it('should reject signature from wrong address', async () => {
    const otherKey = await arweave.wallets.generate();
    const otherAddress = await arweave.wallets.jwkToAddress(otherKey);
    
    const message = 'Sign in to Web OS\n\nAddress: ' + otherAddress + '\nNonce: abc123';
    const messageBuffer = arweave.utils.stringToBuffer(message);
    
    const signature = await arweave.crypto.sign(otherKey, messageBuffer);
    const signatureB64 = arweave.utils.bufferTob64Url(signature);
    
    const result = await verifyArweaveSignature(message, signatureB64, testAddress);
    
    expect(result.valid).toBe(false);
  });
});
```

#### 4.2 Integration Tests

```typescript
// api/src/auth/__tests__/authFlow.test.ts

import request from 'supertest';
import { createApp } from '../index';
import { AuthStore } from '../store';

describe('Authentication Flow', () => {
  let app: Express;
  let authStore: AuthStore;
  
  beforeEach(() => {
    authStore = new AuthStore();
    app = createApp(undefined, authStore);
  });
  
  describe('Ethereum', () => {
    it('should authenticate with Ethereum wallet', async () => {
      // Generate test wallet
      const wallet = ethers.Wallet.createRandom();
      const address = wallet.address;
      
      // Get nonce
      const nonceRes = await request(app)
        .post('/api/auth/nonce')
        .send({ address });
      
      expect(nonceRes.status).toBe(200);
      expect(nonceRes.body.message).toBeDefined();
      
      // Sign message
      const signature = await wallet.signMessage(nonceRes.body.message);
      
      // Verify
      const verifyRes = await request(app)
        .post('/api/auth/verify')
        .send({ address, signature });
      
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.token).toBeDefined();
    });
  });
  
  describe('Arweave', () => {
    it('should authenticate with Arweave wallet', async () => {
      // Generate test Arweave wallet
      const arweave = Arweave.init({});
      const jwk = await arweave.wallets.generate();
      const address = await arweave.wallets.jwkToAddress(jwk);
      
      // Get nonce
      const nonceRes = await request(app)
        .post('/api/auth/nonce')
        .send({ address });
      
      expect(nonceRes.status).toBe(200);
      expect(nonceRes.body.message).toBeDefined();
      
      // Sign message with Arweave key
      const messageBuffer = arweave.utils.stringToBuffer(nonceRes.body.message);
      const signature = await arweave.crypto.sign(jwk, messageBuffer);
      const signatureB64 = arweave.utils.bufferTob64Url(signature);
      
      // Verify
      const verifyRes = await request(app)
        .post('/api/auth/verify')
        .send({ address, signature: signatureB64 });
      
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.token).toBeDefined();
    });
  });
});
```

### Phase 5: Documentation Updates (0.5 days)

Update docs to reflect multi-wallet support:

- [ ] `getting-started.mdx` — Add ArConnect setup
- [ ] `security-model.mdx` — Document both Ethereum and Arweave signature flows
- [ ] `frontend-quickstart.mdx` — Add Arweave wallet connection examples
- [ ] `api-reference.mdx` — Update `/api/auth/nonce` and `/api/auth/verify` docs

---

## Timeline

| Phase | Description | Duration | Dependencies |
|-------|-------------|----------|--------------|
| Phase 1 | Core Verification | 2-3 days | None |
| Phase 2 | Frontend Integration | 2 days | Phase 1 |
| Phase 3 | UI Components | 1 day | Phase 2 |
| Phase 4 | Testing | 1-2 days | Phase 1-3 |
| Phase 5 | Documentation | 0.5 days | All |
| **Total** | | **6.5-8.5 days** | |

## Files to Create/Modify

### Create
- `api/src/auth/arweaveVerifier.ts`
- `api/src/auth/addressDetector.ts`
- `api/src/auth/__tests__/arweaveVerifier.test.ts`
- `frontend/src/wallets/arweave.ts`
- `frontend/src/wallets/detector.ts`
- `frontend/src/components/WalletConnectModal.tsx`

### Modify
- `api/src/auth/store.ts` — Add Arweave verification
- `api/src/auth/middleware.ts` — Support wallet type in session
- `frontend/src/hooks/useWallet.ts` — Add Arweave support
- `frontend/src/auth/login.ts` — Handle both wallet types

## Security Considerations

1. **Public Key Fetching**: Arweave public keys must be fetched from the network or provided with the signature. Consider caching to reduce latency.

2. **Signature Algorithm**: Arweave supports both RSA-PSS and Ed25519. Detect which algorithm the wallet uses and verify accordingly.

3. **Address Validation**: Strict validation of address format before any operations.

4. **Challenge Expiry**: Challenges should expire quickly (5 minutes) to prevent replay attacks.

5. **Session Binding**: Sessions should store the wallet type to prevent cross-chain signature confusion.

## Future Enhancements

- [ ] Support for RSA keyfile upload (non-wallet authentication)
- [ ] Support for Ed25519 Arweave wallets
- [ ] Wallet aggregation (link multiple wallets to one account)
- [ ] Session revocation endpoint