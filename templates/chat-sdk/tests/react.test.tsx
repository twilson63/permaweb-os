import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ChatProvider, useChat, AuthButton, PodList, CreatePodButton, ChatMessages, ChatInput } from '../react/src/react';

// Mock fetch
const mockFetch = vi.fn();
(global as any).fetch = mockFetch;

// Mock window.ethereum
const mockEthereum = {
  request: vi.fn()
};
(global as any).window = {
  ethereum: mockEthereum,
  wander: null,
  arweaveWallet: null
};

// Mock Arweave
vi.mock('arweave', () => ({
  default: {
    init: vi.fn(() => ({
      createTransaction: vi.fn().mockResolvedValue({
        signature: 'test-signature',
        owner: 'test-owner'
      })
    }))
  }
}));

// Test component to access context
function TestComponent() {
  const { session, loading, error } = useChat();
  return (
    <div>
      <div data-testid="session">{session ? session.address : 'null'}</div>
      <div data-testid="loading">{loading ? 'true' : 'false'}</div>
      <div data-testid="error">{error || 'null'}</div>
    </div>
  );
}

describe('ChatProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('should render children', () => {
    render(
      <ChatProvider apiUrl="https://api.test.com">
        <div>Test Child</div>
      </ChatProvider>
    );

    expect(screen.getByText('Test Child')).toBeInTheDocument();
  });

  it('should provide context values', () => {
    render(
      <ChatProvider apiUrl="https://api.test.com">
        <TestComponent />
      </ChatProvider>
    );

    expect(screen.getByTestId('session').textContent).toBe('null');
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('error').textContent).toBe('null');
  });
});

describe('AuthButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('should show connect buttons when not authenticated', () => {
    render(
      <ChatProvider apiUrl="https://api.test.com">
        <AuthButton />
      </ChatProvider>
    );

    expect(screen.getByText('🦊 Connect MetaMask')).toBeInTheDocument();
    expect(screen.getByText('🔗 Connect Wander')).toBeInTheDocument();
  });

  it('should show disconnect button when authenticated', async () => {
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

    render(
      <ChatProvider apiUrl="https://api.test.com">
        <AuthButton />
      </ChatProvider>
    );

    // Click MetaMask connect
    await userEvent.click(screen.getByText('🦊 Connect MetaMask'));

    await waitFor(() => {
      expect(screen.getByText('Disconnect')).toBeInTheDocument();
    });
  });

  it('should handle Ethereum authentication', async () => {
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

    render(
      <ChatProvider apiUrl="https://api.test.com">
        <AuthButton />
      </ChatProvider>
    );

    await userEvent.click(screen.getByText('🦊 Connect MetaMask'));

    await waitFor(() => {
      expect(mockEthereum.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  it('should handle Arweave authentication', async () => {
    // Mock Wander wallet
    const mockWallet = {
      connect: vi.fn().mockResolvedValue(undefined),
      getActiveAddress: vi.fn().mockResolvedValue('ARWEAVE_ADDRESS'),
      sign: vi.fn().mockResolvedValue({
        signature: 'test-signature',
        owner: 'test-owner'
      })
    };
    (global as any).window.wander = mockWallet;
    (global as any).window.arweaveWallet = null;

    // Mock Arweave
    vi.doMock('arweave', () => ({
      default: {
        init: () => ({
          createTransaction: vi.fn().mockResolvedValue({
            signature: 'test-signature',
            owner: 'test-owner'
          })
        })
      }
    }));

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

    render(
      <ChatProvider apiUrl="https://api.test.com">
        <AuthButton />
      </ChatProvider>
    );

    await userEvent.click(screen.getByText('🔗 Connect Wander'));

    await waitFor(() => {
      expect(mockWallet.connect).toHaveBeenCalled();
    });
  });
});

describe('PodList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('should show loading state', async () => {
    mockEthereum.request.mockResolvedValue(['0x1234']);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'test', nonce: '123' })
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        token: 'test-token',
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      })
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ pods: [] })
    });

    render(
      <ChatProvider apiUrl="https://api.test.com">
        <PodList />
      </ChatProvider>
    );

    // Initially shows empty state
    expect(screen.getByText(/No pods yet|Loading/i)).toBeInTheDocument();
  });

  it('should show pods when available', async () => {
    mockEthereum.request.mockResolvedValue(['0x1234']);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'test', nonce: '123' })
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        token: 'test-token',
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      })
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        pods: [
          { id: 'pod-12345678-1234', status: 'running' },
          { id: 'pod-87654321-4321', status: 'stopped' }
        ]
      })
    });

    render(
      <ChatProvider apiUrl="https://api.test.com">
        <PodList />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('pod-1234')).toBeInTheDocument();
      expect(screen.getByText('pod-8765')).toBeInTheDocument();
    });
  });

  it('should call onSelect when pod is clicked', async () => {
    const onSelect = vi.fn();
    mockEthereum.request.mockResolvedValue(['0x1234']);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'test', nonce: '123' })
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        token: 'test-token',
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      })
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        pods: [{ id: 'pod-12345678', status: 'running' }]
      })
    });

    render(
      <ChatProvider apiUrl="https://api.test.com">
        <PodList onSelect={onSelect} />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('pod-1234')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('pod-1234'));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('CreatePodButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('should be disabled when not authenticated', () => {
    render(
      <ChatProvider apiUrl="https://api.test.com">
        <CreatePodButton />
      </ChatProvider>
    );

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('should create pod when clicked', async () => {
    mockEthereum.request.mockResolvedValue(['0x1234']);
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'new-pod-123',
          status: 'running'
        })
      });

    render(
      <ChatProvider apiUrl="https://api.test.com">
        <CreatePodButton />
      </ChatProvider>
    );

    // First authenticate
    await waitFor(() => {
      expect(screen.getByRole('button')).not.toBeDisabled();
    });

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/api/pods',
        expect.objectContaining({
          method: 'POST'
        })
      );
    });
  });
});

describe('ChatMessages', () => {
  it('should show placeholder when no pod selected', () => {
    render(
      <ChatProvider apiUrl="https://api.test.com">
        <ChatMessages />
      </ChatProvider>
    );

    expect(screen.getByText('Select a pod to start chatting')).toBeInTheDocument();
  });
});

describe('ChatInput', () => {
  it('should render input field', () => {
    render(
      <ChatProvider apiUrl="https://api.test.com">
        <ChatInput />
      </ChatProvider>
    );

    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
  });

  it('should be disabled when no pod selected', () => {
    render(
      <ChatProvider apiUrl="https://api.test.com">
        <ChatInput />
      </ChatProvider>
    );

    expect(screen.getByPlaceholderText('Type a message...')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});

describe('useChat hook', () => {
  it('should throw error when used outside provider', () => {
    // Suppress React error boundary warning
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => {
      function BadComponent() {
        useChat();
        return null;
      }
      render(<BadComponent />);
    }).toThrow('useChat must be used within a ChatProvider');
    
    spy.mockRestore();
  });
});