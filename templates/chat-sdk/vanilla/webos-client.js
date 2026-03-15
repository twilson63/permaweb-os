/**
 * Web-OS Chat SDK - Vanilla JavaScript
 * 
 * A lightweight JavaScript SDK for building chat applications with Web-OS.
 * No framework dependencies - works in any browser environment.
 * 
 * @version 0.1.0
 * @license MIT
 */

(function(global) {
  'use strict';

  // ============================================
  // Types (JSDoc for IDE support)
  // ============================================

  /**
   * @typedef {Object} Session
   * @property {string} token - Auth token
   * @property {string} expiresAt - Expiration timestamp
   * @property {string} address - Wallet address
   */

  /**
   * @typedef {Object} Pod
   * @property {string} id - Pod ID
   * @property {string} status - Pod status
   * @property {string} model - Model name
   * @property {string} createdAt - Creation timestamp
   */

  /**
   * @typedef {Object} Message
   * @property {string} id - Message ID
   * @property {'user'|'assistant'|'system'} role - Message role
   * @property {string} content - Message content
   * @property {string} timestamp - Message timestamp
   */

  /**
   * @typedef {Object} WebOSClientOptions
   * @property {string} apiUrl - API URL
   * @property {Function} [onAuthChange] - Auth state change callback
   * @property {Function} [onMessage] - New message callback
   * @property {Function} [onError] - Error callback
   */

  // ============================================
  // WebOSClient Class
  // ============================================

  /**
   * Web-OS Chat Client
   * 
   * @example
   * const client = new WebOSClient({
   *   apiUrl: 'https://api.permaweb.run',
   *   onAuthChange: (session) => console.log('Auth changed:', session),
   *   onMessage: (msg) => console.log('New message:', msg)
   * });
   * 
   * // Authenticate
   * await client.connectEthereum();
   * 
   * // Create pod
   * const pod = await client.createPod();
   * 
   * // Send message
   * client.sendMessage('Hello!');
   */
  class WebOSClient {
    /**
     * Create a new WebOS client
     * @param {WebOSClientOptions} options
     */
    constructor(options) {
      this.apiUrl = options.apiUrl;
      this.onAuthChange = options.onAuthChange || (() => {});
      this.onMessage = options.onMessage || (() => {});
      this.onError = options.onError || console.error;
      
      this.session = null;
      this.ws = null;
      this.currentPodId = null;
    }

    // ============================================
    // Authentication
    // ============================================

    /**
     * Check if ArweaveJS is loaded
     * @private
     */
    _ensureArweave() {
      if (typeof Arweave === 'undefined') {
        throw new Error('ArweaveJS not loaded. Include: <script src="https://cdn.jsdelivr.net/npm/arweave@1.15.7/bundles/arweave.bundle.min.js"></script>');
      }
    }

    /**
     * Connect with Ethereum (MetaMask)
     * @returns {Promise<Session>}
     */
    async connectEthereum() {
      if (!window.ethereum) {
        throw new Error('MetaMask not installed');
      }

      try {
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
          throw new Error(verifyData.error || 'Authentication failed');
        }

        this.session = {
          token: verifyData.token,
          expiresAt: verifyData.expiresAt,
          address
        };

        this.onAuthChange(this.session);
        return this.session;
      } catch (err) {
        this.onError(err);
        throw err;
      }
    }

    /**
     * Connect with Arweave (Wander)
     * @returns {Promise<Session>}
     */
    async connectArweave() {
      this._ensureArweave();
      
      const wallet = window.wander || window.arweaveWallet;
      if (!wallet) {
        throw new Error('Wander wallet not installed');
      }

      try {
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
          throw new Error(verifyData.error || 'Authentication failed');
        }

        this.session = {
          token: verifyData.token,
          expiresAt: verifyData.expiresAt,
          address
        };

        this.onAuthChange(this.session);
        return this.session;
      } catch (err) {
        this.onError(err);
        throw err;
      }
    }

    /**
     * Get current session
     * @returns {Session|null}
     */
    getSession() {
      return this.session;
    }

    /**
     * Check if authenticated
     * @returns {boolean}
     */
    isAuthenticated() {
      if (!this.session) return false;
      return new Date(this.session.expiresAt) > new Date();
    }

    /**
     * Logout
     */
    logout() {
      this.session = null;
      this.disconnect();
      this.onAuthChange(null);
    }

    // ============================================
    // Pods
    // ============================================

    /**
     * List all pods
     * @returns {Promise<Pod[]>}
     */
    async listPods() {
      this._ensureAuth();
      const res = await fetch(`${this.apiUrl}/api/pods`, {
        headers: { Authorization: `Bearer ${this.session.token}` }
      });
      const data = await res.json();
      return data.pods || [];
    }

    /**
     * Get a specific pod
     * @param {string} podId
     * @returns {Promise<Pod>}
     */
    async getPod(podId) {
      this._ensureAuth();
      const res = await fetch(`${this.apiUrl}/api/pods/${podId}`, {
        headers: { Authorization: `Bearer ${this.session.token}` }
      });
      return res.json();
    }

    /**
     * Create a new pod
     * @param {Object} [options]
     * @param {string} [options.model] - Model to use
     * @returns {Promise<Pod>}
     */
    async createPod(options = {}) {
      this._ensureAuth();
      const res = await fetch(`${this.apiUrl}/api/pods`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.session.token}`
        },
        body: JSON.stringify({
          model: options.model || 'openrouter/anthropic/claude-3.5-sonnet'
        })
      });
      return res.json();
    }

    /**
     * Delete a pod
     * @param {string} podId
     */
    async deletePod(podId) {
      this._ensureAuth();
      await fetch(`${this.apiUrl}/api/pods/${podId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.session.token}` }
      });
    }

    // ============================================
    // Chat
    // ============================================

    /**
     * Connect to a pod's chat WebSocket
     * @param {string} podId
     */
    connect(podId) {
      this._ensureAuth();
      this.disconnect();

      this.currentPodId = podId;
      const wsUrl = this.apiUrl
        .replace('https://', 'wss://')
        .replace('http://', 'ws://');
      
      this.ws = new WebSocket(`${wsUrl}/ws?pod=${podId}&token=${this.session.token}`);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
      };
      
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.onMessage(data);
      };
      
      this.ws.onerror = (err) => {
        this.onError(err);
      };
      
      this.ws.onclose = () => {
        console.log('WebSocket closed');
      };
    }

    /**
     * Send a message
     * @param {string} content
     */
    sendMessage(content) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected');
      }
      this.ws.send(JSON.stringify({ type: 'message', content }));
    }

    /**
     * Disconnect WebSocket
     */
    disconnect() {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
        this.currentPodId = null;
      }
    }

    // ============================================
    // Private
    // ============================================

    _ensureAuth() {
      if (!this.session) {
        throw new Error('Not authenticated. Call connectEthereum() or connectArweave() first.');
      }
    }
  }

  // ============================================
  // Export
  // ============================================

  // ES Module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WebOSClient };
  } else {
    global.WebOSClient = WebOSClient;
  }

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);