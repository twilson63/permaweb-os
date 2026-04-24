import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPod,
  deletePod,
  listPods,
  requestWalletChallenge,
  type Pod,
  verifyWalletSignature
} from "./api";
import { authStore } from "./auth/store";

/**
 * Main frontend screen for wallet authentication and pod lifecycle management.
 */

/**
 * Minimal browser wallet interface used by this page.
 */
interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/**
 * Window extension for Ethereum-injected browser wallets (for example MetaMask).
 */
interface WindowWithEthereum extends Window {
  ethereum?: EthereumProvider;
}

/**
 * Static list of LLM models offered in the create pod dialog.
 */
const SUPPORTED_MODELS = [
  "opencode/big-pickle",
  "openai/gpt-4.1-mini",
  "openai/gpt-4o-mini",
  "anthropic/claude-3-5-haiku",
  "anthropic/claude-3-7-sonnet"
];

/**
 * Formats ISO dates for human-readable rendering.
 *
 * @param value - ISO date string.
 * @returns Locale-formatted date string, or original value if invalid.
 */
const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

/**
 * Root React application component.
 *
 * Coordinates wallet auth, session state, and pod CRUD flows.
 */
const App = () => {
  const initialSession = authStore.getSession();
  const [pods, setPods] = useState<Pod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(SUPPORTED_MODELS[0]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(initialSession?.address ?? null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(initialSession?.expiresAt ?? null);
  const [connectingWallet, setConnectingWallet] = useState(false);

  const podCountLabel = useMemo(
    () => `${pods.length} pod${pods.length === 1 ? "" : "s"}`,
    [pods.length]
  );

  /**
   * Reloads pod data from the API while handling unauthorized sessions.
   */
  const refreshPods = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextPods = await listPods();
      setPods(nextPods);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to load pods";
      if (message === "Unauthorized") {
        authStore.clearSession();
        setWalletAddress(null);
        setSessionExpiresAt(null);
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Compact wallet button label that shows connection state.
   */
  const walletLabel = useMemo(() => {
    if (!walletAddress) {
      return "Connect Wallet";
    }

    return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  }, [walletAddress]);

  /**
   * User-facing session expiry text for the header.
   */
  const sessionLabel = useMemo(() => {
    if (!sessionExpiresAt) {
      return null;
    }

    return `Session active until ${formatDate(sessionExpiresAt)}`;
  }, [sessionExpiresAt]);

  /**
   * Initial pod fetch on mount.
   */
  useEffect(() => {
    void refreshPods();
  }, [refreshPods]);

  /**
   * Creates a pod using the currently selected model.
   */
  const onCreate = async () => {
    setCreating(true);
    setError(null);

    try {
      const newPod = await createPod({ model: selectedModel });
      setPods((currentPods) => [newPod, ...currentPods]);
      setCreateDialogOpen(false);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to create pod";
      setError(message);
    } finally {
      setCreating(false);
    }
  };

  /**
   * Deletes a pod and optimistically updates local state.
   *
   * @param id - Pod identifier to delete.
   */
  const onDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);

    try {
      await deletePod(id);
      setPods((currentPods) => currentPods.filter((pod) => pod.id !== id));
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to delete pod";
      setError(message);
    } finally {
      setDeletingId(null);
    }
  };

  /**
   * Connects an Ethereum wallet and completes challenge/response login.
   */
  const onConnectWallet = async () => {
    setConnectingWallet(true);
    setError(null);

    try {
      const browserWindow = window as WindowWithEthereum;

      if (!browserWindow.ethereum) {
        throw new Error("No Ethereum wallet found. Install MetaMask or compatible wallet.");
      }

      const accountsResponse = await browserWindow.ethereum.request({ method: "eth_requestAccounts" });

      if (!Array.isArray(accountsResponse) || accountsResponse.length === 0 || typeof accountsResponse[0] !== "string") {
        throw new Error("Wallet did not return an account");
      }

      /** Use the first selected account as the active wallet identity. */
      const address = accountsResponse[0];
      const challenge = await requestWalletChallenge(address);
      const signatureResponse = await browserWindow.ethereum.request({
        method: "personal_sign",
        params: [challenge.message, address]
      });

      if (typeof signatureResponse !== "string") {
        throw new Error("Wallet did not return a signature");
      }

      const session = await verifyWalletSignature(address, signatureResponse);
      authStore.setSession({
        token: session.token,
        address,
        expiresAt: session.expiresAt
      });
      setWalletAddress(address);
      setSessionExpiresAt(session.expiresAt);
      await refreshPods();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Wallet connection failed";
      setError(message);
    } finally {
      setConnectingWallet(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Pod Lifecycle</h1>
          <p>{podCountLabel}</p>
          {sessionLabel ? <p>{sessionLabel}</p> : null}
        </div>
        <div className="header-actions">
          <button type="button" className={walletAddress ? "secondary" : "primary"} onClick={() => void onConnectWallet()} disabled={connectingWallet}>
            {connectingWallet ? "Connecting..." : walletLabel}
          </button>
          <button type="button" onClick={() => void refreshPods()} disabled={loading}>
            Refresh
          </button>
          <button type="button" className="primary" onClick={() => setCreateDialogOpen(true)} disabled={creating}>
            Create Pod
          </button>
        </div>
      </header>

      {createDialogOpen ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => setCreateDialogOpen(false)}>
          <section
            aria-label="Create pod"
            className="create-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Create Pod</h2>
            <p>Choose the language model for this pod.</p>
            <label htmlFor="model">Model</label>
            <select id="model" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              {SUPPORTED_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <div className="dialog-actions">
              <button type="button" onClick={() => setCreateDialogOpen(false)} disabled={creating}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={() => void onCreate()} disabled={creating}>
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {loading ? (
        <p className="empty-state">Loading pods...</p>
      ) : pods.length === 0 ? (
        <p className="empty-state">No pods yet. Create your first pod.</p>
      ) : (
        <section className="pod-grid" aria-label="Pod list">
          {pods.map((pod) => (
            <article className="pod-card" key={pod.id}>
              <div className="pod-card-header">
                <h2>{pod.name}</h2>
                {pod.llm?.provider ? <span className="provider-badge">{pod.llm.provider}</span> : null}
              </div>
              <dl>
                <div>
                  <dt>ID</dt>
                  <dd>{pod.id}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{pod.status}</dd>
                </div>
                <div>
                  <dt>Subdomain</dt>
                  <dd>{pod.subdomain}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{pod.llm?.model ?? "-"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(pod.createdAt)}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="danger"
                onClick={() => void onDelete(pod.id)}
                disabled={deletingId === pod.id}
              >
                {deletingId === pod.id ? "Deleting..." : "Delete Pod"}
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
};

export default App;
