import { vi } from 'vitest';

// Mock fetch globally
(global as any).fetch = vi.fn();

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(public url: string) {}

  send(data: string) {
    // Mock send
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }

  simulateMessage(data: any) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  simulateOpen() {
    this.onopen?.(new Event('open'));
  }

  simulateError(error: Error) {
    this.onerror?.(new Event('error'));
  }
}

(global as any).WebSocket = MockWebSocket;

// Mock window.ethereum BEFORE any code runs
const mockEthereum = {
  request: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
};

// Ensure window exists and has ethereum
if (typeof (global as any).window === 'undefined') {
  (global as any).window = {};
}
(global as any).window.ethereum = mockEthereum;
(global as any).window.wander = null;
(global as any).window.arweaveWallet = null;

export { mockEthereum, MockWebSocket };