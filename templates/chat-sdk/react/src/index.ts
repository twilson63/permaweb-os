/**
 * Web-OS Chat SDK
 * 
 * A TypeScript SDK for building chat applications that interface with Web-OS pods.
 * Supports both Ethereum (MetaMask) and Arweave (Wander) wallet authentication.
 * 
 * @module @web-os/chat-sdk
 */

import Arweave from 'arweave';

// Types
export interface AuthConfig {
  apiUrl: string;
  walletType: 'ethereum' | 'arweave';
}

export interface Session {
  token: string;
  expiresAt: string;
  address: string;
}

export interface Pod {
  id: string;
  status: 'running' | 'stopped' | 'pending';
  model: string;
  createdAt: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// Error types
export class WebOSError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'WebOSError';
  }
}

export class AuthenticationError extends WebOSError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR');
  }
}

export class PodError extends WebOSError {
  constructor(message: string) {
    super(message, 'POD_ERROR');
  }
}

/**
 * Web-OS Chat SDK Client
 * 
 * @example
 * ```typescript
 * const client = new WebOSChatClient({
 *   apiUrl: 'https://api.permaweb.run'
 * });
 * 
 * // Authenticate with Ethereum
 * await client.authenticate.ethereum();
 * 
 * // Create a pod
 * const pod = await client.pods.create();
 * 
 * // Send a message
 * const response = await client.chat.send('Hello, world!');
 * ```
 */
export class WebOSChatClient {
  private apiUrl: string;
  private session: Session | null = null;
  private ws: WebSocket | null = null;

  constructor(config: { apiUrl: string }) {
    this.apiUrl = config.apiUrl;
  }

  // ============================================
  // Authentication
  // ============================================

  /**
   * Authenticate with Ethereum (MetaMask)
   */
  async authenticateWithEthereum(): Promise<Session> {
    if (!window.ethereum) {
      throw new AuthenticationError('MetaMask not installed');
    }

    // Get wallet address
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address = accounts[0].toLowerCase();

    // Get auth challenge
    const nonceRes = await fetch(`${this.apiUrl}/api/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, walletType: 'ethereum' })
    });
    const nonceData = await nonceRes.json();

    // Sign challenge
    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [nonceData.message, address]
    });

    // Verify signature
    const verifyRes = await fetch(`${this.apiUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, signature, walletType: 'ethereum' })
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.token) {
      throw new AuthenticationError(verifyData.error || 'Authentication failed');
    }

    this.session = {
      token: verifyData.token,
      expiresAt: verifyData.expiresAt,
      address
    };

    return this.session;
  }

  /**
   * Authenticate with Arweave (Wander)
   */
  async authenticateWithArweave(): Promise<Session> {
    const wallet = (window as any).wander || (window as any).arweaveWallet;
    if (!wallet) {
      throw new AuthenticationError('Wander wallet not installed');
    }

    // Request permissions
    await wallet.connect(['SIGN_TRANSACTION', 'ACCESS_ADDRESS']);
    const address = await wallet.getActiveAddress();

    // Get auth challenge
    const nonceRes = await fetch(`${this.apiUrl}/api/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, walletType: 'arweave' })
    });
    const nonceData = await nonceRes.json();
    const message = nonceData.message;

    // Create and sign Arweave transaction
    const arweave = Arweave.init({ host: 'arweave.net', port: 443, protocol: 'https' });
    const tx = await arweave.createTransaction({ data: message });
    const signedTx = await wallet.sign(tx);

    // Verify signature
    const verifyRes = await fetch(`${this.apiUrl}/api/auth/verify`, {
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
    const verifyData = await verifyRes.json();

    if (!verifyData.token) {
      throw new AuthenticationError(verifyData.error || 'Authentication failed');
    }

    this.session = {
      token: verifyData.token,
      expiresAt: verifyData.expiresAt,
      address
    };

    return this.session;
  }

  /**
   * Get current session
   */
  getSession(): Session | null {
    return this.session;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    if (!this.session) return false;
    return new Date(this.session.expiresAt) > new Date();
  }

  /**
   * Logout
   */
  logout(): void {
    this.session = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ============================================
  // Pods
  // ============================================

  pods = {
    /**
     * List all pods for the authenticated user
     */
    list: async (): Promise<Pod[]> => {
      this.ensureAuth();
      const res = await fetch(`${this.apiUrl}/api/pods`, {
        headers: { Authorization: `Bearer ${this.session!.token}` }
      });
      const data = await res.json();
      return data.pods || [];
    },

    /**
     * Get a specific pod
     */
    get: async (podId: string): Promise<Pod> => {
      this.ensureAuth();
      const res = await fetch(`${this.apiUrl}/api/pods/${podId}`, {
        headers: { Authorization: `Bearer ${this.session!.token}` }
      });
      return res.json();
    },

    /**
     * Create a new pod
     */
    create: async (options?: { model?: string }): Promise<Pod> => {
      this.ensureAuth();
      const res = await fetch(`${this.apiUrl}/api/pods`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.session!.token}`
        },
        body: JSON.stringify({ model: options?.model || 'openrouter/anthropic/claude-3.5-sonnet' })
      });
      return res.json();
    },

    /**
     * Delete a pod
     */
    delete: async (podId: string): Promise<void> => {
      this.ensureAuth();
      await fetch(`${this.apiUrl}/api/pods/${podId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.session!.token}` }
      });
    }
  };

  // ============================================
  // Chat
  // ============================================

  chat = {
    /**
     * Connect to a pod's chat WebSocket
     */
    connect: (podId: string, onMessage: (message: Message) => void): WebSocket => {
      this.ensureAuth();
      
      const wsUrl = this.apiUrl
        .replace('https://', 'wss://')
        .replace('http://', 'ws://');
      
      this.ws = new WebSocket(`${wsUrl}/ws?pod=${podId}&token=${this.session!.token}`);
      
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        onMessage(data);
      };
      
      return this.ws;
    },

    /**
     * Send a message
     */
    send: (content: string): void => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new PodError('WebSocket not connected');
      }
      this.ws.send(JSON.stringify({ type: 'message', content }));
    },

    /**
     * Disconnect WebSocket
     */
    disconnect: (): void => {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    }
  };

  // ============================================
  // Private Helpers
  // ============================================

  private ensureAuth(): void {
    if (!this.session) {
      throw new AuthenticationError('Not authenticated. Call authenticateWithEthereum() or authenticateWithArweave() first.');
    }
  }
}

// Export singleton for convenience
export const createClient = (config: { apiUrl: string }) => new WebOSChatClient(config);

// Type declarations for window extensions
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
    };
    wander?: any;
    arweaveWallet?: any;
  }
}