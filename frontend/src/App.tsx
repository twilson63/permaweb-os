import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPod,
  deletePod,
  listPods,
  requestWalletChallenge,
  type Pod,
  type WalletAuthSession,
  verifyWalletSignature
} from "./api";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface WindowWithEthereum extends Window {
  ethereum?: EthereumProvider;
}

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const App = () => {
  const [pods, setPods] = useState<Pod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(() => localStorage.getItem("webos.walletAddress"));
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(() =>
    localStorage.getItem("webos.sessionExpiresAt")
  );
  const [connectingWallet, setConnectingWallet] = useState(false);

  const podCountLabel = useMemo(
    () => `${pods.length} pod${pods.length === 1 ? "" : "s"}`,
    [pods.length]
  );

  const refreshPods = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextPods = await listPods();
      setPods(nextPods);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to load pods";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const walletLabel = useMemo(() => {
    if (!walletAddress) {
      return "Connect Wallet";
    }

    return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  }, [walletAddress]);

  const sessionLabel = useMemo(() => {
    if (!sessionExpiresAt) {
      return null;
    }

    return `Session active until ${formatDate(sessionExpiresAt)}`;
  }, [sessionExpiresAt]);

  useEffect(() => {
    void refreshPods();
  }, [refreshPods]);

  const onCreate = async () => {
    setCreating(true);
    setError(null);

    try {
      const newPod = await createPod();
      setPods((currentPods) => [newPod, ...currentPods]);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to create pod";
      setError(message);
    } finally {
      setCreating(false);
    }
  };

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

      const address = accountsResponse[0];
      const challenge = await requestWalletChallenge(address);
      const signatureResponse = await browserWindow.ethereum.request({
        method: "personal_sign",
        params: [challenge.message, address]
      });

      if (typeof signatureResponse !== "string") {
        throw new Error("Wallet did not return a signature");
      }

      const session: WalletAuthSession = await verifyWalletSignature(address, signatureResponse);

      localStorage.setItem("webos.sessionToken", session.token);
      localStorage.setItem("webos.walletAddress", session.address);
      localStorage.setItem("webos.sessionExpiresAt", session.expiresAt);
      setWalletAddress(session.address);
      setSessionExpiresAt(session.expiresAt);
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
          <button type="button" className="primary" onClick={() => void onCreate()} disabled={creating}>
            {creating ? "Creating..." : "Create Pod"}
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}

      {loading ? (
        <p className="empty-state">Loading pods...</p>
      ) : pods.length === 0 ? (
        <p className="empty-state">No pods yet. Create your first pod.</p>
      ) : (
        <section className="pod-grid" aria-label="Pod list">
          {pods.map((pod) => (
            <article className="pod-card" key={pod.id}>
              <h2>{pod.name}</h2>
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
