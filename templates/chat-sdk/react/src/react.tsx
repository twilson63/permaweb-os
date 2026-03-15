/**
 * Web-OS Chat React Components
 * 
 * React components for building chat interfaces with Web-OS
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WebOSChatClient, Pod, Message, Session } from './index';

// Context
interface ChatContextValue {
  client: WebOSChatClient | null;
  session: Session | null;
  pods: Pod[];
  currentPod: Pod | null;
  messages: Message[];
  loading: boolean;
  error: string | null;
  connectEthereum: () => Promise<void>;
  connectArweave: () => Promise<void>;
  disconnect: () => void;
  selectPod: (podId: string) => void;
  createPod: (model?: string) => Promise<void>;
  sendMessage: (content: string) => void;
}

export const ChatContext = React.createContext<ChatContextValue | null>(null);

// Provider
interface ChatProviderProps {
  apiUrl: string;
  children: React.ReactNode;
}

export function ChatProvider({ apiUrl, children }: ChatProviderProps) {
  const [client] = useState(() => new WebOSChatClient({ apiUrl }));
  const [session, setSession] = useState<Session | null>(null);
  const [pods, setPods] = useState<Pod[]>([]);
  const [currentPod, setCurrentPod] = useState<Pod | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Check for existing session
    const existingSession = client.getSession();
    if (existingSession) {
      setSession(existingSession);
      loadPods(existingSession);
    }
  }, [client]);

  const loadPods = async (sess: Session) => {
    try {
      const podList = await client.pods.list();
      setPods(podList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pods');
    }
  };

  const connectEthereum = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sess = await client.authenticateWithEthereum();
      setSession(sess);
      await loadPods(sess);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }, [client]);

  const connectArweave = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sess = await client.authenticateWithArweave();
      setSession(sess);
      await loadPods(sess);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }, [client]);

  const disconnect = useCallback(() => {
    client.logout();
    setSession(null);
    setPods([]);
    setCurrentPod(null);
    setMessages([]);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [client]);

  const selectPod = useCallback((podId: string) => {
    const pod = pods.find(p => p.id === podId);
    if (!pod) return;
    
    setCurrentPod(pod);
    setMessages([]);
    
    // Connect WebSocket
    wsRef.current = client.chat.connect(podId, (msg) => {
      setMessages(prev => [...prev, msg]);
    });
  }, [client, pods]);

  const createPod = useCallback(async (model?: string) => {
    if (!session) return;
    
    setLoading(true);
    setError(null);
    try {
      const newPod = await client.pods.create({ model });
      setPods(prev => [...prev, newPod]);
      selectPod(newPod.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pod');
    } finally {
      setLoading(false);
    }
  }, [client, session, selectPod]);

  const sendMessage = useCallback((content: string) => {
    if (!currentPod) return;
    client.chat.send(content);
    
    // Add user message optimistically
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);
  }, [client, currentPod]);

  const value: ChatContextValue = {
    client,
    session,
    pods,
    currentPod,
    messages,
    loading,
    error,
    connectEthereum,
    connectArweave,
    disconnect,
    selectPod,
    createPod,
    sendMessage
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

// Hook
export function useChat() {
  const context = React.useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}

// Components
export function AuthButton() {
  const { session, connectEthereum, connectArweave, disconnect, loading } = useChat();
  
  if (session) {
    return (
      <div className="webos-auth-connected">
        <span className="webos-address">
          {session.address.slice(0, 8)}...{session.address.slice(-6)}
        </span>
        <button onClick={disconnect} className="webos-btn webos-btn-secondary">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="webos-auth-buttons">
      <button 
        onClick={connectEthereum} 
        disabled={loading}
        className="webos-btn webos-btn-primary"
      >
        🦊 Connect MetaMask
      </button>
      <button 
        onClick={connectArweave} 
        disabled={loading}
        className="webos-btn webos-btn-primary"
      >
        🔗 Connect Wander
      </button>
    </div>
  );
}

export function PodList({ onSelect }: { onSelect?: (pod: Pod) => void }) {
  const { pods, currentPod, selectPod, loading } = useChat();

  if (loading) {
    return <div className="webos-loading">Loading pods...</div>;
  }

  if (pods.length === 0) {
    return <div className="webos-empty">No pods yet. Create one to get started!</div>;
  }

  return (
    <div className="webos-pod-list">
      {pods.map(pod => (
        <div
          key={pod.id}
          className={`webos-pod-item ${currentPod?.id === pod.id ? 'active' : ''}`}
          onClick={() => {
            selectPod(pod.id);
            onSelect?.(pod);
          }}
        >
          <div className="webos-pod-name">{pod.id.slice(0, 8)}</div>
          <div className="webos-pod-status">{pod.status}</div>
        </div>
      ))}
    </div>
  );
}

export function CreatePodButton({ model }: { model?: string }) {
  const { createPod, loading, session } = useChat();

  return (
    <button
      onClick={() => createPod(model)}
      disabled={loading || !session}
      className="webos-btn webos-btn-primary webos-create-pod"
    >
      + New Pod
    </button>
  );
}

export function ChatMessages() {
  const { messages, currentPod } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!currentPod) {
    return (
      <div className="webos-chat-placeholder">
        Select a pod to start chatting
      </div>
    );
  }

  return (
    <div className="webos-chat-messages">
      {messages.map((msg, i) => (
        <div key={msg.id || i} className={`webos-message ${msg.role}`}>
          <div className="webos-message-header">
            {msg.role === 'user' ? 'You' : 'Assistant'}
          </div>
          <div className="webos-message-content">
            {msg.content}
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}

export function ChatInput({ placeholder = 'Type a message...' }: { placeholder?: string }) {
  const { sendMessage, currentPod } = useChat();
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() && currentPod) {
      sendMessage(value.trim());
      setValue('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="webos-chat-input">
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={!currentPod}
        className="webos-input"
      />
      <button 
        type="submit" 
        disabled={!currentPod || !value.trim()}
        className="webos-btn webos-btn-primary"
      >
        Send
      </button>
    </form>
  );
}

// Full Chat Component
export function ChatWidget({ apiUrl }: { apiUrl: string }) {
  return (
    <ChatProvider apiUrl={apiUrl}>
      <div className="webos-chat-widget">
        <header className="webos-header">
          <h1>🌐 Web-OS Chat</h1>
          <AuthButton />
        </header>
        
        <div className="webos-main">
          <aside className="webos-sidebar">
            <CreatePodButton />
            <PodList />
          </aside>
          
          <main className="webos-chat-area">
            <ChatMessages />
            <ChatInput />
          </main>
        </div>
      </div>
    </ChatProvider>
  );
}

// CSS (to be imported by user)
export const styles = `
.webos-chat-widget {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0a0a;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.webos-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
}

.webos-header h1 {
  font-size: 1.25rem;
  color: #00ff88;
  margin: 0;
}

.webos-auth-buttons {
  display: flex;
  gap: 0.5rem;
}

.webos-auth-connected {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.webos-address {
  font-family: monospace;
  font-size: 0.875rem;
  background: #2a2a2a;
  padding: 0.5rem 1rem;
  border-radius: 4px;
}

.webos-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.webos-sidebar {
  width: 250px;
  background: #1a1a1a;
  border-right: 1px solid #333;
  padding: 1rem;
}

.webos-pod-list {
  margin-top: 1rem;
}

.webos-pod-item {
  padding: 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 0.25rem;
}

.webos-pod-item:hover {
  background: #2a2a2a;
}

.webos-pod-item.active {
  background: #2a2a2a;
  border-left: 3px solid #00ff88;
}

.webos-pod-name {
  font-weight: 500;
}

.webos-pod-status {
  font-size: 0.75rem;
  color: #888;
}

.webos-chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.webos-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.webos-message {
  margin-bottom: 1rem;
  max-width: 70%;
}

.webos-message.user {
  margin-left: auto;
}

.webos-message-header {
  font-size: 0.75rem;
  color: #888;
  margin-bottom: 0.25rem;
}

.webos-message-content {
  background: #2a2a2a;
  padding: 0.75rem 1rem;
  border-radius: 8px;
}

.webos-message.user .webos-message-content {
  background: #00ff8820;
}

.webos-chat-input {
  display: flex;
  gap: 0.5rem;
  padding: 1rem;
  background: #1a1a1a;
  border-top: 1px solid #333;
}

.webos-input {
  flex: 1;
  padding: 0.75rem 1rem;
  background: #2a2a2a;
  border: 1px solid #333;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 1rem;
}

.webos-input:focus {
  outline: none;
  border-color: #00ff88;
}

.webos-btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.webos-btn-primary {
  background: #00ff88;
  color: #000;
}

.webos-btn-primary:hover {
  background: #00cc6a;
}

.webos-btn-primary:disabled {
  background: #333;
  color: #666;
  cursor: not-allowed;
}

.webos-btn-secondary {
  background: #2a2a2a;
  color: #e0e0e0;
}

.webos-btn-secondary:hover {
  background: #3a3a3a;
}

.webos-loading,
.webos-empty,
.webos-chat-placeholder {
  padding: 2rem;
  text-align: center;
  color: #888;
}
`;