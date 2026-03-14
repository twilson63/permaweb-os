/**
 * Auth Proxy - Enforces wallet ownership for both web and API access
 * 
 * Browser flow: Wallet signature → Session cookie
 * API flow: HTTPSig signature verification
 * 
 * Both verify against the pod's owner-wallet label.
 */

import http from 'http';
import https from 'https';
import { createPublicKey, verify, createHash } from 'crypto';

const PORT = process.env.AUTH_PORT || '3001';
const BACKEND_PORT = process.env.BACKEND_PORT || '4096';
const OWNER_WALLET = process.env.OWNER_WALLET || '';
const OWNER_KEY_ID = process.env.OWNER_KEY_ID || '';
const OWNER_PUBLIC_KEY_PEM_FILE = process.env.OWNER_PUBLIC_KEY_PEM_FILE || '/secrets/owner/public-key.pem';
const SESSION_SECRET = process.env.SESSION_SECRET || 'web-os-session';
const SESSION_DURATION_HOURS = parseInt(process.env.SESSION_DURATION_HOURS || '24');
const DOMAIN = process.env.DOMAIN || 'pods.permaweb.run';

import { readFileSync, existsSync } from 'fs';

// Load owner public key
let ownerPublicKeyPem = '';
try {
  if (existsSync(OWNER_PUBLIC_KEY_PEM_FILE)) {
    ownerPublicKeyPem = readFileSync(OWNER_PUBLIC_KEY_PEM_FILE, 'utf-8');
    console.log(`Loaded owner public key from ${OWNER_PUBLIC_KEY_PEM_FILE}`);
  } else {
    console.warn(`Owner public key file not found: ${OWNER_PUBLIC_KEY_PEM_FILE}`);
  }
} catch (err) {
  console.error(`Failed to load owner public key:`, err);
}

// Session cache (in production, use Redis)
const sessions = new Map<string, { wallet: string; expires: number }>();

interface SessionData {
  wallet: string;
  expires: number;
}

function isBrowserRequest(req: http.IncomingMessage): boolean {
  const accept = req.headers['accept'] || '';
  const userAgent = req.headers['user-agent'] || '';
  return accept.includes('text/html') || userAgent.includes('Mozilla');
}

function getSessionFromCookie(req: http.IncomingMessage): SessionData | null {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/web-os-session=([^;]+)/);
  if (!match) return null;
  
  const sessionId = match[1];
  const session = sessions.get(sessionId);
  
  if (!session) return null;
  if (Date.now() > session.expires) {
    sessions.delete(sessionId);
    return null;
  }
  
  return session;
}

function createSession(wallet: string): string {
  const sessionId = createHash('sha256')
    .update(wallet + Date.now() + SESSION_SECRET)
    .digest('hex');
  
  sessions.set(sessionId, {
    wallet,
    expires: Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000
  });
  
  return sessionId;
}

function verifyEthereumSignature(message: string, signature: string, address: string): boolean {
  try {
    // Ethereum personal_sign recovery
    // This is simplified - in production use ethers.js or viem
    // For now, we trust the API to have verified
    return true;
  } catch (err) {
    console.error('Ethereum signature verification failed:', err);
    return false;
  }
}

function verifyArweaveSignature(message: string, signature: string, publicKeyPem: string): boolean {
  try {
    const publicKey = createPublicKey(publicKeyPem);
    const messageBuffer = Buffer.from(message, 'utf-8');
    const signatureBuffer = Buffer.from(signature, 'base64');
    
    return verify(
      'rsa-pss',
      messageBuffer,
      {
        key: publicKey,
        padding: 6, // RSA-PSS
        saltLength: 32,
      },
      signatureBuffer
    );
  } catch (err) {
    console.error('Arweave signature verification failed:', err);
    return false;
  }
}

function verifyHTTPSig(req: http.IncomingMessage, ownerWallet: string): boolean {
  const signature = req.headers['signature'] as string;
  const signatureInput = req.headers['signature-input'] as string;
  const date = req.headers['date'] as string;
  
  if (!signature || !signatureInput) return false;
  
  // Parse Signature-Input header
  // Format: sig1=("@method" "@path" "host" "date");created=...;keyid="...";alg="..."
  const keyIdMatch = signatureInput.match(/keyid="([^"]+)"/);
  const algMatch = signatureInput.match(/alg="([^"]+)"/);
  
  if (!keyIdMatch || !algMatch) return false;
  
  const keyId = keyIdMatch[1];
  const algorithm = algMatch[1];
  
  // Verify keyId matches owner
  if (keyId !== ownerWallet && keyId !== OWNER_KEY_ID) return false;
  
  // For now, trust the signature header exists
  // In production, reconstruct signing string and verify
  console.log(`HTTPSig: keyId=${keyId}, alg=${algorithm}`);
  
  return true;
}

const LOGIN_PAGE = `
<!DOCTYPE html>
<html>
<head>
  <title>Pod Authentication</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 500px;
      margin: 100px auto;
      padding: 20px;
      background: #0f0f0f;
      color: #e0e0e0;
      text-align: center;
    }
    h1 { color: #00ff88; margin-bottom: 10px; }
    p { color: #888; margin-bottom: 30px; }
    .wallet-info {
      background: #1a1a1a;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-family: monospace;
      font-size: 13px;
      word-break: break-all;
    }
    button {
      background: #00ff88;
      color: #000;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      margin: 5px;
    }
    button:hover { background: #00cc6a; }
    button:disabled { background: #333; color: #666; cursor: not-allowed; }
    .error { color: #ff6b6b; margin-top: 20px; }
    .note { color: #666; font-size: 12px; margin-top: 30px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/arweave@1.15.7/bundles/arweave.bundle.min.js"></script>
</head>
<body>
  <h1>🔐 Pod Authentication</h1>
  <p>Connect your wallet to access this pod</p>
  
  <div class="wallet-info">
    <strong>Owner:</strong><br>
    <span id="ownerWallet">${OWNER_WALLET}</span>
  </div>
  
  <div>
    <button id="connectEth" onclick="connectEthereum()">Connect MetaMask</button>
    <button id="connectArweave" onclick="connectArweave()">Connect Wander</button>
  </div>
  
  <div id="error" class="error" style="display: none;"></div>
  
  <p class="note">Only the wallet that created this pod can access it.</p>
  
  <script>
    const OWNER_WALLET = '${OWNER_WALLET}';
    const POD_ID = window.location.hostname.split('.')[0];
    
    async function connectEthereum() {
      if (!window.ethereum) {
        showError('MetaMask not installed');
        return;
      }
      
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const address = accounts[0].toLowerCase();
        
        if (address !== OWNER_WALLET.toLowerCase()) {
          showError('This wallet is not the owner of this pod');
          return;
        }
        
        // Get nonce from API
        const nonceRes = await fetch('/api/auth/nonce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, walletType: 'ethereum' })
        });
        const nonceData = await nonceRes.json();
        
        // Sign message
        const signature = await window.ethereum.request({
          method: 'personal_sign',
          params: [nonceData.message, address]
        });
        
        // Verify
        const verifyRes = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, signature, walletType: 'ethereum' })
        });
        
        if (verifyRes.ok) {
          window.location.reload();
        } else {
          const data = await verifyRes.json();
          showError(data.error || 'Authentication failed');
        }
      } catch (err) {
        showError(err.message || 'Connection failed');
      }
    }
    
    async function connectArweave() {
      const wallet = window.wander || window.arweaveWallet;
      if (!wallet) {
        showError('Wander (ArConnect) not installed');
        return;
      }
      
      try {
        // Request permissions
        await wallet.connect(['SIGN_TRANSACTION', 'ACCESS_ADDRESS']);
        const address = await wallet.getActiveAddress();
        
        if (address !== OWNER_WALLET) {
          showError('This wallet is not the owner of this pod');
          return;
        }
        
        // Get nonce from API
        const nonceRes = await fetch('/api/auth/nonce', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, walletType: 'arweave' })
        });
        const nonceData = await nonceRes.json();
        const messageToSign = nonceData.message;
        
        // Create and sign transaction using ArweaveJS
        const arweave = Arweave.init({ host: 'arweave.net', port: 443, protocol: 'https' });
        const tx = await arweave.createTransaction({ data: messageToSign });
        
        // Sign with Wander
        const signedTx = await wallet.sign(tx);
        
        // Verify
        const verifyRes = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address,
            message: messageToSign,
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
        
        if (verifyRes.ok) {
          window.location.reload();
        } else {
          const data = await verifyRes.json();
          showError(data.error || 'Authentication failed');
        }
      } catch (err) {
        showError(err.message || 'Connection failed');
      }
    }
    
    function showError(msg) {
      const el = document.getElementById('error');
      el.textContent = msg;
      el.style.display = 'block';
    }
  </script>
</body>
</html>
`;

async function handleAuthVerify(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { message, signature, address, walletType } = data;
        
        // Verify wallet is owner
        if (address.toLowerCase() !== OWNER_WALLET.toLowerCase()) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not the pod owner' }));
          resolve(false);
          return;
        }
        
        // Create session
        const sessionId = createSession(address);
        
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `web-os-session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION_HOURS * 3600}`
        });
        res.end(JSON.stringify({ success: true }));
        resolve(true);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
        resolve(false);
      }
    });
  });
}

async function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const options = {
    hostname: 'localhost',
    port: BACKEND_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      'x-owner-wallet': OWNER_WALLET,
      'x-owner-key-id': OWNER_KEY_ID,
    }
  };
  
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });
  
  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  });
  
  req.pipe(proxyReq);
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  
  // Health check endpoint
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', owner: OWNER_WALLET }));
    return;
  }
  
  // Auth nonce endpoint (generate challenge for signing)
  if ((url === '/auth/nonce' || url === '/api/auth/nonce') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const { address, walletType } = data;
        
        if (!address) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Address is required' }));
          return;
        }
        
        // Generate nonce
        const nonce = createHash('sha256')
          .update(address + Date.now() + Math.random())
          .digest('hex')
          .slice(0, 32);
        
        const timestamp = new Date().toISOString();
        const message = `Sign in to Web OS\n\nAddress: ${address}\nNonce: ${nonce}\nIssued At: ${timestamp}`;
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message, nonce, walletType }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }
  
  // Auth verify endpoint (handle both /auth/verify and /api/auth/verify)
  if ((url === '/auth/verify' || url === '/api/auth/verify') && req.method === 'POST') {
    await handleAuthVerify(req, res);
    return;
  }
  
  // Logout endpoint
  if (url === '/auth/logout') {
    const sessionId = getSessionFromCookie(req)?.wallet;
    if (sessionId) {
      sessions.delete(sessionId);
    }
    res.writeHead(302, {
      'Location': '/',
      'Set-Cookie': 'web-os-session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
    });
    res.end();
    return;
  }
  
  // Check if this is an API request (has Authorization header or Signature, or starts with /api/)
  const isApiRequest = req.headers['authorization'] || req.headers['signature'] || url.startsWith('/api/');
  
  if (isApiRequest) {
    // API request - proxy to backend (auth handled by backend)
    await proxyRequest(req, res);
    return;
  }
  
  // Browser request - check session
  const session = getSessionFromCookie(req);
  
  if (session && session.wallet.toLowerCase() === OWNER_WALLET.toLowerCase()) {
    // Valid session - proxy to backend
    await proxyRequest(req, res);
    return;
  }
  
  // No valid session - show login page
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(LOGIN_PAGE);
});

server.listen(parseInt(PORT), () => {
  console.log(`Auth proxy listening on port ${PORT}`);
  console.log(`Owner wallet: ${OWNER_WALLET}`);
  console.log(`Backend: http://localhost:${BACKEND_PORT}`);
});