/**
 * @fileoverview Express API composition for auth, pods, usage, and provider discovery.
 * @author Web OS contributors
 * @exports createApp
 */

import express from "express";
import cors from "cors";
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
import { registerLlmRoutes } from "./llm/routes";
import { PodStore } from "./pods/store";
import { UsageStore } from "./usage/store";
import {
  httpMetricsMiddleware,
  authAttemptsTotal,
  authFailuresTotal,
  tokensUsedTotal,
  podsTotal,
  podsByStatus,
  activeWebsockets,
  getMetrics,
  getMetricsContentType
} from "./metrics";

/**
 * API server entry point.
 *
 * This module wires authentication, pod lifecycle, usage accounting, and GitHub
 * OAuth endpoints into a single Express app instance.
 */

/**
 * Creates the API application with injectable stores and OAuth exchange helper.
 *
 * @param store - Pod persistence store.
 * @param authStore - Authentication challenge/session store.
 * @param llmSecretStore - Provider secret discovery store.
 * @param usageStore - Usage tracking store.
 * @param exchangeGitHubCode - Injectable GitHub code exchange implementation.
 * @returns Configured Express application.
 */
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
  /**
   * One-time OAuth state map used for CSRF protection during GitHub connect.
   * Values expire after 10 minutes and are removed after callback handling.
   */
  const githubOAuthStates = new Map<string, { sessionToken: string; expiresAtMs: number }>();

  // Enable CORS for all origins (allows browser-based clients)
  app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Wallet-Type']
  }));

  app.use(express.json());

  // HTTP metrics middleware - tracks request duration and counts
  app.use(httpMetricsMiddleware);

  const requireSession = createSessionAuthMiddleware(authStore);

  // Register LLM key management routes
  registerLlmRoutes(app, { requireSession });

  /**
   * Prometheus metrics endpoint.
   * Exposes metrics for scraping by Prometheus server.
   */
  app.get("/metrics", async (_req, res) => {
    try {
      const metrics = await getMetrics();
      res.set("Content-Type", getMetricsContentType());
      res.send(metrics);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to collect metrics";
      res.status(500).json({ error: message });
    }
  });

  /**
   * Issues a wallet signature challenge to begin session authentication.
   * Supports Ethereum (0x...) and Arweave (43-char base64url) addresses.
   */
  app.post("/api/auth/nonce", (req, res) => {
    const address = typeof req.body?.address === "string" ? req.body.address : "";

    if (!address) {
      authFailuresTotal.labels("missing_address").inc();
      res.status(400).json({ error: "Wallet address is required" });
      return;
    }

    authAttemptsTotal.labels("wallet").inc();

    try {
      const challenge = authStore.createChallenge(address);
      res.json({
        message: challenge.message,
        nonce: challenge.nonce,
        walletType: challenge.walletType
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create challenge";
      authFailuresTotal.labels("challenge_creation_failed").inc();
      res.status(400).json({ error: message });
    }
  });

  /**
   * Verifies a signed wallet challenge and returns a bearer session token.
   * Supports Ethereum (eth-personal-sign) and Arweave (transaction signature) signatures.
   *
   * For Arweave wallets:
   * - If using transaction signing, send: { address, message, signature, owner, walletType: 'arweave' }
   * - If using signMessage (deprecated), send: { address, signature, jwk, walletType: 'arweave' }
   * For Ethereum wallets:
   * - Send: { address, signature, walletType: 'ethereum' }
   */
  app.post("/api/auth/verify", async (req, res) => {
    const address = typeof req.body?.address === "string" ? req.body.address : "";
    const signature = typeof req.body?.signature === "string" ? req.body.signature : "";
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    const owner = typeof req.body?.owner === "string" ? req.body.owner : "";
    const jwk = req.body?.jwk; // Optional: for Arweave signMessage (deprecated)

    if (!address || !signature) {
      authFailuresTotal.labels("missing_credentials").inc();
      res.status(400).json({ error: "Address and signature are required" });
      return;
    }

    authAttemptsTotal.labels("wallet").inc();

    try {
      // For Arweave transaction signing, verify the transaction signature
      if (owner && message) {
        console.log('[Auth] Arweave transaction signature verification');
        
        // Extract transaction data from request
        const txData = {
          reward: typeof req.body?.reward === "string" ? req.body.reward : undefined,
          lastTx: typeof req.body?.lastTx === "string" ? req.body.lastTx : undefined,
          dataSize: typeof req.body?.dataSize === "string" ? req.body.dataSize : undefined,
          dataRoot: typeof req.body?.dataRoot === "string" ? req.body.dataRoot : undefined,
          tags: req.body?.tags
        };
        
        // Verify the transaction signature using AuthStore
        const isValid = await authStore.verifyArweaveTransactionSignature(
          message,
          signature,
          owner,
          address,
          txData
        );
        
        if (!isValid) {
          authFailuresTotal.labels("invalid_signature").inc();
          res.status(401).json({ error: "Invalid transaction signature" });
          return;
        }
        
        // Verify the message matches the challenge
        const challenge = authStore.getChallenge(address);
        
        if (!challenge || challenge.message !== message) {
          authFailuresTotal.labels("challenge_mismatch").inc();
          res.status(401).json({ error: "Message does not match challenge" });
          return;
        }
        
        if (challenge.expiresAt < Date.now()) {
          authFailuresTotal.labels("challenge_expired").inc();
          res.status(401).json({ error: "Challenge expired" });
          return;
        }
        
        // Create session
        authStore.deleteChallenge(address);
        const session = authStore.createSessionSync(address);
        res.json(session);
        return;
      }
      
      // Standard verification (Ethereum or Arweave signMessage)
      const session = await authStore.verifySignature(address, signature, jwk ? { jwk } : undefined);

      if (!session) {
        authFailuresTotal.labels("invalid_signature").inc();
        res.status(401).json({ error: "Invalid or expired signature challenge" });
        return;
      }

      res.json(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to verify signature";
      console.error('[Auth] Verification error:', error);
      authFailuresTotal.labels("verification_error").inc();
      res.status(400).json({ error: message });
    }
  });

  /**
   * Starts GitHub OAuth by creating a short-lived state token and redirecting
   * the authenticated user to GitHub's authorization page.
   */
  app.get("/api/auth/github", requireSession, (req, res: Response<unknown, SessionLocals>) => {
    authAttemptsTotal.labels("github").inc();

    const oauthConfig = getGitHubOAuthConfig();

    if (!oauthConfig) {
      authFailuresTotal.labels("github_not_configured").inc();
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

  /**
   * Handles GitHub OAuth callback by validating state and exchanging the
   * temporary authorization code for an access token.
   */
  app.get("/api/auth/github/callback", async (req, res) => {
    const oauthConfig = getGitHubOAuthConfig();

    if (!oauthConfig) {
      authFailuresTotal.labels("github_not_configured").inc();
      res.status(500).json({ error: "GitHub OAuth is not configured" });
      return;
    }

    const error = typeof req.query.error === "string" ? req.query.error : "";

    if (error) {
      authFailuresTotal.labels("github_auth_denied").inc();
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
      authFailuresTotal.labels("github_missing_params").inc();
      res.status(400).json({ error: "Missing GitHub OAuth code or state" });
      return;
    }

    const stateRecord = githubOAuthStates.get(state);
    githubOAuthStates.delete(state);

    if (!stateRecord || stateRecord.expiresAtMs <= Date.now()) {
      authFailuresTotal.labels("github_expired_state").inc();
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
        authFailuresTotal.labels("github_token_exchange_failed").inc();
        res.status(401).json({ error: "GitHub token exchange failed" });
        return;
      }

      const stored = authStore.setGitHubToken(stateRecord.sessionToken, githubToken);

      if (!stored) {
        authFailuresTotal.labels("session_expired").inc();
        res.status(401).json({ error: "Session expired" });
        return;
      }

      res.json({ connected: true });
    } catch (_error) {
      authFailuresTotal.labels("github_callback_error").inc();
      res.status(500).json({ error: "Failed to complete GitHub OAuth flow" });
    }
  });

  /**
   * Gets the wallet address from authenticated response locals.
   *
   * @param res - Express response carrying session locals.
   * @returns Authenticated wallet address.
   */
  const getSessionAddress = (res: Response<unknown, SessionLocals>): string => {
    return res.locals.session.address;
  };

  /**
   * Creates a pod for the authenticated wallet owner.
   */
  app.post("/api/pods", requireSession, (req, res: Response<unknown, SessionLocals>) => {
    const modelSelection = resolveModelSelection(req.body?.model);

    if (!modelSelection) {
      res.status(400).json({
        error: "Unsupported model selection",
        supportedModels: listSupportedModels()
      });
      return;
    }

    try {
      const pod = store.create(getSessionAddress(res), req.body, modelSelection);
      // Update pod metrics
      podsTotal.inc();
      podsByStatus.labels("running").inc();
      res.status(201).json(pod);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create pod";
      res.status(400).json({ error: message });
    }
  });

  /**
   * Lists pods owned by the authenticated wallet.
   */
  app.get("/api/pods", requireSession, (_req, res: Response<unknown, SessionLocals>) => {
    res.json({ pods: store.list(getSessionAddress(res)) });
  });

  /**
   * Lists LLM providers that currently have configured API keys.
   */
  app.get("/api/llm/providers", requireSession, (_req, res: Response<unknown, SessionLocals>) => {
    res.json({ providers: llmSecretStore.listConfiguredProviders() });
  });

  /**
   * Records token usage and cost data for an authenticated wallet.
   */
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
      const wallet = getSessionAddress(res);
      const usage = usageStore.create(wallet, {
        model,
        promptTokens,
        completionTokens
      });

      // Track token metrics
      tokensUsedTotal.labels(wallet, model, "prompt").inc(promptTokens);
      tokensUsedTotal.labels(wallet, model, "completion").inc(completionTokens);

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

  /**
   * Returns usage summary and raw records for an authenticated wallet.
   */
  app.get("/api/usage", requireSession, (_req, res: Response<unknown, SessionLocals>) => {
    const ownerWallet = getSessionAddress(res);
    res.json({
      summary: usageStore.summarize(ownerWallet),
      records: usageStore.list(ownerWallet)
    });
  });

  /**
   * Returns one pod after verifying ownership.
   */
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

  /**
   * Deletes one pod after verifying ownership.
   */
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

    // Update pod metrics
    podsTotal.dec();
    if (pod.status) {
      podsByStatus.labels(pod.status).dec();
    }

    res.status(204).send();
  });

  /**
   * Simple health probe endpoint.
   */
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
};

/**
 * Default application instance used in local runtime mode.
 */
const app = createApp();
const port = Number(process.env.PORT) || 3000;

/**
 * Starts the HTTP listener when this file is executed directly.
 */
if (require.main === module) {
  app.listen(port, () => {
    console.log(`api listening on port ${port}`);
  });
}
