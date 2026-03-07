import { useCallback, useEffect, useMemo, useState } from "react";
import { createPod, deletePod, listPods, type Pod } from "./api";

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

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Pod Lifecycle</h1>
          <p>{podCountLabel}</p>
        </div>
        <div className="header-actions">
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
