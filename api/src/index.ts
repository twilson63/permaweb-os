import express from "express";
import { randomBytes } from "crypto";
import { Response } from "express";
import {
  buildGitHubAuthorizeUrl,
  exchangeGitHubCodeForToken,
  getGitHubOAuthConfig
} from "./auth/githubOAuth";
import { createSessionAuthMiddleware, SessionLocals } from "./auth/middleware";
import { AuthStore } from "./auth/store";
import { listSupportedModels, resolveModelSelection } from "./llm/modelRegistry";
import { LlmSecretStore } from "./llm/secretStore";
import { PodStore } from "./pods/store";
import { UsageStore } from "./usage/store";

export const createApp = (
  store: PodStore = new PodStore(),
  authStore: AuthStore = new AuthStore(),
  llmSecretStore: LlmSecretStore = new LlmSecretStore(),
  usageStore: UsageStore = new UsageStore(),
  {
    exchangeGitHubCode = exchangeGitHubCodeForToken
  }: {
    exchangeGitHubCode?: (input: {
      clientId: string;
      clientSecret: string;
      code: string;
      redirectUri: string;
    }) => Promise<string | null>;
  } = {}
) => {
  const app = express();
  const githubOAuthStates = new Map<string, { sessionToken: string; expiresAtMs: number }>();

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

  app.get("/api/auth/github", requireSession, (req, res: Response<unknown, SessionLocals>) => {
    const oauthConfig = getGitHubOAuthConfig();

    if (!oauthConfig) {
      res.status(500).json({ error: "GitHub OAuth is not configured" });
      return;
    }

    const sessionToken = res.locals.session.token;
    const state = randomBytes(16).toString("base64url");
    const redirectUri = process.env.GITHUB_REDIRECT_URI?.trim() ||
      `${req.protocol}://${req.get("host")}/api/auth/github/callback`;

    githubOAuthStates.set(state, {
      sessionToken,
      expiresAtMs: Date.now() + 10 * 60 * 1000
    });

    const authorizeUrl = buildGitHubAuthorizeUrl({
      clientId: oauthConfig.clientId,
      redirectUri,
      state
    });

    res.redirect(authorizeUrl);
  });

  app.get("/api/auth/github/callback", async (req, res) => {
    const oauthConfig = getGitHubOAuthConfig();

    if (!oauthConfig) {
      res.status(500).json({ error: "GitHub OAuth is not configured" });
      return;
    }

    const error = typeof req.query.error === "string" ? req.query.error : "";

    if (error) {
      const description =
        typeof req.query.error_description === "string"
          ? req.query.error_description
          : "GitHub authorization failed";
      res.status(400).json({ error: description });
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!code || !state) {
      res.status(400).json({ error: "Missing GitHub OAuth code or state" });
      return;
    }

    const stateRecord = githubOAuthStates.get(state);
    githubOAuthStates.delete(state);

    if (!stateRecord || stateRecord.expiresAtMs <= Date.now()) {
      res.status(401).json({ error: "Invalid or expired GitHub OAuth state" });
      return;
    }

    const redirectUri = process.env.GITHUB_REDIRECT_URI?.trim() ||
      `${req.protocol}://${req.get("host")}/api/auth/github/callback`;

    try {
      const githubToken = await exchangeGitHubCode({
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        code,
        redirectUri
      });

      if (!githubToken) {
        res.status(401).json({ error: "GitHub token exchange failed" });
        return;
      }

      const stored = authStore.setGitHubToken(stateRecord.sessionToken, githubToken);

      if (!stored) {
        res.status(401).json({ error: "Session expired" });
        return;
      }

      res.json({ connected: true });
    } catch (_error) {
      res.status(500).json({ error: "Failed to complete GitHub OAuth flow" });
    }
  });

  const getSessionAddress = (res: Response<unknown, SessionLocals>): string => {
    return res.locals.session.address;
  };

  app.post("/api/pods", requireSession, (req, res: Response<unknown, SessionLocals>) => {
    const modelSelection = resolveModelSelection(req.body?.model);

    if (!modelSelection) {
      res.status(400).json({
        error: "Unsupported model selection",
        supportedModels: listSupportedModels()
      });
      return;
    }

    const pod = store.create(getSessionAddress(res), req.body, modelSelection);
    res.status(201).json(pod);
  });

  app.get("/api/pods", requireSession, (_req, res: Response<unknown, SessionLocals>) => {
    res.json({ pods: store.list(getSessionAddress(res)) });
  });

  app.get("/api/llm/providers", requireSession, (_req, res: Response<unknown, SessionLocals>) => {
    res.json({ providers: llmSecretStore.listConfiguredProviders() });
  });

  app.post("/api/usage", requireSession, (req, res: Response<unknown, SessionLocals>) => {
    const model = typeof req.body?.model === "string" ? req.body.model : "";
    const promptTokens = req.body?.promptTokens;
    const completionTokens = req.body?.completionTokens;

    if (!model || !Number.isInteger(promptTokens) || !Number.isInteger(completionTokens)) {
      res.status(400).json({
        error: "model, promptTokens, and completionTokens are required"
      });
      return;
    }

    try {
      const usage = usageStore.create(getSessionAddress(res), {
        model,
        promptTokens,
        completionTokens
      });

      res.status(201).json(usage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create usage record";
      if (message === "Unsupported model selection") {
        res.status(400).json({ error: message, supportedModels: listSupportedModels() });
        return;
      }

      res.status(400).json({ error: message });
    }
  });

  app.get("/api/usage", requireSession, (_req, res: Response<unknown, SessionLocals>) => {
    const ownerWallet = getSessionAddress(res);
    res.json({
      summary: usageStore.summarize(ownerWallet),
      records: usageStore.list(ownerWallet)
    });
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
