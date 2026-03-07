import express from "express";
import { AuthStore } from "./auth/store";
import { PodStore } from "./pods/store";

export const createApp = (store: PodStore = new PodStore(), authStore: AuthStore = new AuthStore()) => {
  const app = express();

  app.use(express.json());

  app.post("/api/auth/nonce", (req, res) => {
    const address = typeof req.body?.address === "string" ? req.body.address : "";

    if (!address) {
      res.status(400).json({ error: "Wallet address is required" });
      return;
    }

    try {
      const challenge = authStore.createChallenge(address);
      res.json({ message: challenge.message, nonce: challenge.nonce });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create challenge";
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/auth/verify", (req, res) => {
    const address = typeof req.body?.address === "string" ? req.body.address : "";
    const signature = typeof req.body?.signature === "string" ? req.body.signature : "";

    if (!address || !signature) {
      res.status(400).json({ error: "Address and signature are required" });
      return;
    }

    try {
      const session = authStore.verifySignature(address, signature);

      if (!session) {
        res.status(401).json({ error: "Invalid or expired signature challenge" });
        return;
      }

      res.json(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to verify signature";
      res.status(400).json({ error: message });
    }
  });

  app.post("/api/pods", (req, res) => {
    const pod = store.create(req.body);
    res.status(201).json(pod);
  });

  app.get("/api/pods", (_req, res) => {
    res.json({ pods: store.list() });
  });

  app.get("/api/pods/:id", (req, res) => {
    const pod = store.get(req.params.id);

    if (!pod) {
      res.status(404).json({ error: "Pod not found" });
      return;
    }

    res.json(pod);
  });

  app.delete("/api/pods/:id", (req, res) => {
    const deleted = store.delete(req.params.id);

    if (!deleted) {
      res.status(404).json({ error: "Pod not found" });
      return;
    }

    res.status(204).send();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
};

const app = createApp();
const port = Number(process.env.PORT) || 3000;

if (require.main === module) {
  app.listen(port, () => {
    console.log(`api listening on port ${port}`);
  });
}
