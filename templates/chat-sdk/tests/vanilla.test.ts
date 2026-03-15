import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockWebSocket } from './setup';

// Mock window.ethereum BEFORE importing the module
const mockEthereum = {
  request: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
};

vi.stubGlobal('window', {
  ethereum: mockEthereum,
  wander: null,
  arweaveWallet: null
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock WebSocket
vi.stubGlobal('WebSocket', MockWebSocket);

// Import after mocks are set up
const WebOSClient = require('../vanilla/webos-client.js').WebOSClient;

describe('WebOSClient - Vanilla SDK', () => {
  let client: typeof WebOSClient;

  describe('Authentication', () => {
    describe('connectEthereum', () => {
      it('should throw error if MetaMask is not installed', async () => {
        (window as any).ethereum = undefined;
        
        await expect(client.connectEthereum())
          .rejects.toThrow('MetaMask not installed');
      });

      it('should authenticate successfully with Ethereum', async () => {
        // Mock ethereum.request
        mockEthereum.request
          .mockResolvedValueOnce(['0x1234567890abcdef1234567890abcdef12345678']) // eth_requestAccounts
          .mockResolvedValueOnce('0xsignature'); // personal_sign

        // Mock API responses
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              message: 'Sign in to Web OS\n\nAddress: 0x1234...\nNonce: abc123',
              nonce: 'abc123'
            })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              token: 'test-token',
              expiresAt: new Date(Date.now() + 86400000).toISOString()
            })
          });

        const session = await client.connectEthereum();

        expect(session.token).toBe('test-token');
        expect(session.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
        expect(client.isAuthenticated()).toBe(true);
      });

      it('should handle authentication failure', async () => {
        mockEthereum.request
          .mockResolvedValueOnce(['0x1234567890abcdef1234567890abcdef12345678'])
          .mockResolvedValueOnce('0xsignature');

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ message: 'test', nonce: '123' })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ error: 'Invalid signature' })
          });

        await expect(client.connectEthereum())
          .rejects.toThrow('Invalid signature');
        
        expect(client.isAuthenticated()).toBe(false);
      });
    });

    describe('connectArweave', () => {
      it('should throw error if ArweaveJS is not loaded', async () => {
        (global as any).Arweave = undefined;
        
        await expect(client.connectArweave())
          .rejects.toThrow('ArweaveJS not loaded');
      });

      it('should throw error if Wander is not installed', async () => {
        (global as any).Arweave = { init: vi.fn() };
        (window as any).wander = undefined;
        (window as any).arweaveWallet = undefined;
        
        await expect(client.connectArweave())
          .rejects.toThrow('Wander wallet not installed');
      });

      it('should authenticate successfully with Arweave', async () => {
        // Mock Arweave
        const mockArweave = {
          init: vi.fn(() => ({
            createTransaction: vi.fn().mockResolvedValue({
              signature: 'test-signature',
              owner: 'test-owner',
              reward: '1000',
              last_tx: 'anchor',
              data_size: '100',
              data_root: 'root',
              tags: []
            })
          }))
        };
        (global as any).Arweave = mockArweave;

        // Mock Wander wallet
        const mockWallet = {
          connect: vi.fn().mockResolvedValue(undefined),
          getActiveAddress: vi.fn().mockResolvedValue('ARWEAVE_ADDRESS'),
          sign: vi.fn().mockResolvedValue({
            signature: 'test-signature',
            owner: 'test-owner',
            reward: '1000',
            last_tx: 'anchor',
            data_size: '100',
            data_root: 'root',
            tags: []
          })
        };
        (window as any).wander = mockWallet;

        // Mock API responses
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              message: 'Sign in to Web OS',
              nonce: 'test-nonce'
            })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              token: 'test-token',
              expiresAt: new Date(Date.now() + 86400000).toISOString()
            })
          });

        const session = await client.connectArweave();

        expect(session.token).toBe('test-token');
        expect(mockWallet.connect).toHaveBeenCalledWith(['SIGN_TRANSACTION', 'ACCESS_ADDRESS']);
        expect(mockWallet.sign).toHaveBeenCalled();
      });
    });

    describe('getSession', () => {
      it('should return null when not authenticated', () => {
        expect(client.getSession()).toBeNull();
      });

      it('should return session when authenticated', async () => {
        mockEthereum.request
          .mockResolvedValueOnce(['0x1234567890abcdef1234567890abcdef12345678'])
          .mockResolvedValueOnce('0xsignature');

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ message: 'test', nonce: '123' })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              token: 'test-token',
              expiresAt: new Date(Date.now() + 86400000).toISOString()
            })
          });

        await client.connectEthereum();
        const session = client.getSession();

        expect(session).not.toBeNull();
        expect(session?.token).toBe('test-token');
      });
    });

    describe('isAuthenticated', () => {
      it('should return false when not authenticated', () => {
        expect(client.isAuthenticated()).toBe(false);
      });

      it('should return true when authenticated and not expired', async () => {
        mockEthereum.request
          .mockResolvedValueOnce(['0x1234'])
          .mockResolvedValueOnce('0xsignature');

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ message: 'test', nonce: '123' })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              token: 'test-token',
              expiresAt: new Date(Date.now() + 86400000).toISOString()
            })
          });

        await client.connectEthereum();
        expect(client.isAuthenticated()).toBe(true);
      });

      it('should return false when session is expired', async () => {
        mockEthereum.request
          .mockResolvedValueOnce(['0x1234'])
          .mockResolvedValueOnce('0xsignature');

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ message: 'test', nonce: '123' })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              token: 'test-token',
              expiresAt: new Date(Date.now() - 1000).toISOString() // Expired
            })
          });

        await client.connectEthereum();
        expect(client.isAuthenticated()).toBe(false);
      });
    });

    describe('logout', () => {
      it('should clear session and call onAuthChange', async () => {
        const onAuthChange = vi.fn();
        client = new WebOSClient({
          apiUrl: 'https://api.test.com',
          onAuthChange
        });

        mockEthereum.request
          .mockResolvedValueOnce(['0x1234'])
          .mockResolvedValueOnce('0xsignature');

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ message: 'test', nonce: '123' })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              token: 'test-token',
              expiresAt: new Date(Date.now() + 86400000).toISOString()
            })
          });

        await client.connectEthereum();
        expect(client.isAuthenticated()).toBe(true);

        client.logout();
        
        expect(client.isAuthenticated()).toBe(false);
        expect(onAuthChange).toHaveBeenCalledWith(null);
      });
    });
  });

  describe('Pods', () => {
    beforeEach(async () => {
      // Authenticate first
      mockEthereum.request
        .mockResolvedValueOnce(['0x1234'])
        .mockResolvedValueOnce('0xsignature');

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: 'test', nonce: '123' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            token: 'test-token',
            expiresAt: new Date(Date.now() + 86400000).toISOString()
          })
        });

      await client.connectEthereum();
      mockFetch.mockReset();
    });

    describe('listPods', () => {
      it('should return list of pods', async () => {
        const mockPods = [
          { id: 'pod-1', status: 'running', model: 'claude-3.5-sonnet' },
          { id: 'pod-2', status: 'stopped', model: 'gpt-4' }
        ];

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ pods: mockPods })
        });

        const pods = await client.listPods();

        expect(pods).toHaveLength(2);
        expect(pods[0].id).toBe('pod-1');
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.test.com/api/pods',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer test-token'
            })
          })
        );
      });

      it('should return empty array when no pods', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ pods: [] })
        });

        const pods = await client.listPods();
        expect(pods).toEqual([]);
      });
    });

    describe('createPod', () => {
      it('should create a pod with default model', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'new-pod-123',
            status: 'running',
            model: 'openrouter/anthropic/claude-3.5-sonnet'
          })
        });

        const pod = await client.createPod();

        expect(pod.id).toBe('new-pod-123');
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.test.com/api/pods',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('claude-3.5-sonnet')
          })
        );
      });

      it('should create a pod with custom model', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'new-pod-456',
            status: 'running',
            model: 'gpt-4'
          })
        });

        const pod = await client.createPod({ model: 'gpt-4' });

        expect(pod.model).toBe('gpt-4');
        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.test.com/api/pods',
          expect.objectContaining({
            body: expect.stringContaining('gpt-4')
          })
        );
      });
    });

    describe('deletePod', () => {
      it('should delete a pod', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true });

        await client.deletePod('pod-to-delete');

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.test.com/api/pods/pod-to-delete',
          expect.objectContaining({
            method: 'DELETE',
            headers: expect.objectContaining({
              Authorization: 'Bearer test-token'
            })
          })
        );
      });
    });
  });

  describe('Chat', () => {
    beforeEach(async () => {
      // Authenticate
      mockEthereum.request
        .mockResolvedValueOnce(['0x1234'])
        .mockResolvedValueOnce('0xsignature');

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: 'test', nonce: '123' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            token: 'test-token',
            expiresAt: new Date(Date.now() + 86400000).toISOString()
          })
        });

      await client.connectEthereum();
    });

    describe('connect', () => {
      it('should connect to WebSocket', () => {
        const onMessage = vi.fn();
        client = new WebOSClient({
          apiUrl: 'https://api.test.com',
          onMessage
        });
        client.session = { token: 'test', expiresAt: new Date(Date.now() + 86400000).toISOString(), address: '0x1234' };

        client.connect('pod-123');

        expect(client.currentPodId).toBe('pod-123');
      });

      it('should throw if not authenticated', () => {
        const unauthenticatedClient = new WebOSClient({ apiUrl: 'https://api.test.com' });
        
        expect(() => unauthenticatedClient.connect('pod-123'))
          .toThrow('Not authenticated');
      });
    });

    describe('sendMessage', () => {
      it('should send message via WebSocket', () => {
        const onMessage = vi.fn();
        client = new WebOSClient({
          apiUrl: 'https://api.test.com',
          onMessage
        });
        client.session = { token: 'test', expiresAt: new Date(Date.now() + 86400000).toISOString(), address: '0x1234' };
        client.connect('pod-123');

        // Mock WebSocket
        const mockWs = (client as any).ws;
        mockWs.readyState = WebSocket.OPEN;

        client.sendMessage('Hello!');

        expect(mockWs.send).toHaveBeenCalledWith(
          JSON.stringify({ type: 'message', content: 'Hello!' })
        );
      });

      it('should throw if WebSocket not connected', () => {
        client = new WebOSClient({ apiUrl: 'https://api.test.com' });
        client.session = { token: 'test', expiresAt: new Date(Date.now() + 86400000).toISOString(), address: '0x1234' };
        // Don't connect WebSocket

        expect(() => client.sendMessage('Hello!'))
          .toThrow('WebSocket not connected');
      });
    });

    describe('disconnect', () => {
      it('should close WebSocket', () => {
        client = new WebOSClient({ apiUrl: 'https://api.test.com' });
        client.session = { token: 'test', expiresAt: new Date(Date.now() + 86400000).toISOString(), address: '0x1234' };
        client.connect('pod-123');
        
        expect(client.currentPodId).toBe('pod-123');

        client.disconnect();

        expect(client.currentPodId).toBeNull();
        expect(client.ws).toBeNull();
      });
    });
  });
});