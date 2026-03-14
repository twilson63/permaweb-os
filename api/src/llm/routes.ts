/**
 * @fileoverview LLM API key management endpoints.
 * @module llm/routes
 * 
 * Provides endpoints for wallet-scoped LLM key management:
 * - POST /api/llm/keys - Register/update an API key
 * - GET /api/llm/keys - List configured providers
 * - DELETE /api/llm/keys/:provider - Remove a provider key
 */

import { Request, Response, RequestHandler } from "express";
import { SecretManager, getSecretManager } from "./secret-manager";
import { LlmProvider, isSupportedLlmProvider, SUPPORTED_LLM_PROVIDERS } from "../pods/secret-naming";

/**
 * Options for LLM routes.
 */
export interface LlmRoutesOptions {
  secretManager?: SecretManager;
  requireSession?: RequestHandler;
}

/**
 * Registers LLM key management routes on an Express app.
 * 
 * @param app - Express application
 * @param options - Optional configuration
 */
export function registerLlmRoutes(
  app: import("express").Application,
  options: LlmRoutesOptions = {}
): void {
  const secretManager = options.secretManager || getSecretManager();
  const requireSession = options.requireSession || ((req: Request, res: Response, next: Function) => {
    // If no middleware provided, require Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    // Without session middleware, we can't validate the token
    // This is a fallback - should always use requireSession middleware
    res.status(401).json({ error: "Session middleware required" });
    return;
  });

  /**
   * POST /api/llm/keys
   * Register or update an LLM API key for the authenticated wallet.
   */
  app.post("/api/llm/keys", requireSession, async (req: Request, res: Response) => {
    // Get wallet address from session (requires auth middleware)
    const walletAddress = res.locals.session?.address;
    
    if (!walletAddress) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { provider, apiKey } = req.body || {};
    
    if (!provider || typeof provider !== "string") {
      res.status(400).json({
        error: "Provider is required",
        supportedProviders: SUPPORTED_LLM_PROVIDERS
      });
      return;
    }

    if (!isSupportedLlmProvider(provider)) {
      res.status(400).json({
        error: `Unsupported provider: ${provider}`,
        supportedProviders: SUPPORTED_LLM_PROVIDERS
      });
      return;
    }

    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
      res.status(400).json({ error: "API key is required and cannot be empty" });
      return;
    }

    try {
      const result = await secretManager.registerKey(
        walletAddress,
        provider as LlmProvider,
        apiKey.trim()
      );

      if (!result.success) {
        res.status(500).json({ error: result.error || "Failed to register key" });
        return;
      }

      res.status(201).json({
        success: true,
        provider,
        secretName: result.secretName,
        created: result.created
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to register key";
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/llm/keys
   * List configured LLM providers for the authenticated wallet.
   */
  app.get("/api/llm/keys", requireSession, async (_req: Request, res: Response) => {
    const walletAddress = res.locals.session?.address;
    
    if (!walletAddress) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const providers = await secretManager.listConfiguredProviders(walletAddress);
      res.json({
        providers,
        supportedProviders: SUPPORTED_LLM_PROVIDERS
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list providers";
      res.status(500).json({ error: message });
    }
  });

  /**
   * DELETE /api/llm/keys/:provider
   * Remove an LLM API key for the authenticated wallet.
   */
  app.delete("/api/llm/keys/:provider", requireSession, async (req: Request, res: Response) => {
    const walletAddress = res.locals.session?.address;
    
    if (!walletAddress) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { provider } = req.params;

    if (!isSupportedLlmProvider(provider)) {
      res.status(400).json({
        error: `Unsupported provider: ${provider}`,
        supportedProviders: SUPPORTED_LLM_PROVIDERS
      });
      return;
    }

    try {
      const removed = await secretManager.removeKey(walletAddress, provider as LlmProvider);

      if (!removed) {
        res.status(404).json({ error: `No key found for provider: ${provider}` });
        return;
      }

      res.json({ success: true, provider });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove key";
      res.status(500).json({ error: message });
    }
  });
}