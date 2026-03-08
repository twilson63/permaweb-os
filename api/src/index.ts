import express from "express";
import { Response } from "express";
import { createSessionAuthMiddleware, SessionLocals } from "./auth/middleware";
import { AuthStore } from "./auth/store";
import { PodStore } from "./pods/store";

export const createApp = (store: PodStore = new PodStore(), authStore: AuthStore = new AuthStore()) => {
  const app = express();

  app.use(express.json());

  const requireSession = createSessionAuthMiddleware(authStore);

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

  const getSessionAddress = (res: Response<unknown, SessionLocals>): string => {
    return res.locals.session.address;
  };

  app.post("/api/pods", requireSession, (req, res: Response<unknown, SessionLocals>) => {
    const pod = store.create(getSessionAddress(res), req.body);
    res.status(201).json(pod);
  });

  app.get("/api/pods", requireSession, (_req, res: Response<unknown, SessionLocals>) => {
    res.json({ pods: store.list(getSessionAddress(res)) });
  });

  app.get("/api/pods/:id", requireSession, (req, res: Response<unknown, SessionLocals>) => {
    const pod = store.get(req.params.id);

    if (!pod) {
      res.status(404).json({ error: "Pod not found" });
      return;
    }

    if (pod.ownerWallet !== getSessionAddress(res)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json(pod);
  });

  app.delete("/api/pods/:id", requireSession, (req, res: Response<unknown, SessionLocals>) => {
    const pod = store.get(req.params.id);

    if (!pod) {
      res.status(404).json({ error: "Pod not found" });
      return;
    }

    if (pod.ownerWallet !== getSessionAddress(res)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

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
