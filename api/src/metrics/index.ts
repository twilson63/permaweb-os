/**
 * @fileoverview Prometheus metrics module for Web OS API.
 * @module metrics
 * @description Provides production-ready observability metrics following Prometheus best practices.
 */

import client from "prom-client";

/**
 * Prometheus registry for Web OS metrics.
 * Uses default global registry for compatibility with Prometheus scrapers.
 */
const register = client.register;

/**
 * Enable default metrics (GC, memory, CPU, etc.)
 * These are standard Node.js metrics every 10 seconds.
 */
client.collectDefaultMetrics({ register });

// ============================================================================
// Pod Metrics
// ============================================================================

/**
 * Total number of pods currently managed by the system.
 * This is a gauge because the count can go up or down.
 */
export const podsTotal = new client.Gauge({
  name: "webos_pods_total",
  help: "Total number of pods currently managed",
});

/**
 * Pods grouped by their current status/phase.
 * Label: status - one of running, pending, failed, terminated.
 */
export const podsByStatus = new client.Gauge({
  name: "webos_pods_by_status",
  help: "Number of pods grouped by current status/phase",
  labelNames: ["status"],
});

// ============================================================================
// HTTP Metrics
// ============================================================================

/**
 * HTTP request counter by method, path, and status code.
 * This is a counter as request counts only increase.
 */
export const httpRequestsTotal = new client.Counter({
  name: "webos_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"],
});

/**
 * HTTP request duration histogram.
 * Buckets chosen for web API latency expectations (ms scale).
 */
export const httpRequestDurationSeconds = new client.Histogram({
  name: "webos_http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "path"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// ============================================================================
// Authentication Metrics
// ============================================================================

/**
 * Authentication attempt counter by type.
 * Types: wallet, github.
 */
export const authAttemptsTotal = new client.Counter({
  name: "webos_auth_attempts_total",
  help: "Total number of authentication attempts",
  labelNames: ["type"],
});

/**
 * Authentication failure counter by reason.
 * Reasons: invalid_signature, expired_challenge, invalid_code, etc.
 */
export const authFailuresTotal = new client.Counter({
  name: "webos_auth_failures_total",
  help: "Total number of authentication failures",
  labelNames: ["reason"],
});

// ============================================================================
// Token Usage Metrics
// ============================================================================

/**
 * Token usage counter by wallet and model.
 * Tracks prompt tokens consumed.
 */
export const tokensUsedTotal = new client.Counter({
  name: "webos_tokens_used_total",
  help: "Total tokens used by wallet and model",
  labelNames: ["wallet", "model", "type"],
});

// ============================================================================
// WebSocket Metrics
// ============================================================================

/**
 * Active WebSocket connection gauge.
 * Current number of open WebSocket connections.
 */
export const activeWebsockets = new client.Gauge({
  name: "webos_active_websockets",
  help: "Number of active WebSocket connections",
});

// ============================================================================
// Pod Store Integration
// ============================================================================

import { PodStore } from "../pods/store";

/**
 * Updates pod metrics from the PodStore.
 * Should be called periodically or after pod operations.
 *
 * @param store - The pod store to read metrics from.
 */
export function updatePodMetrics(store: PodStore): void {
  // This would need PodStore to expose enumeration methods
  // For now, we rely on explicit updates in pod operations
}

// ============================================================================
// Middleware
// ============================================================================

import { Request, Response, NextFunction } from "express";

/**
 * Path normalizer to avoid high cardinality from dynamic path segments.
 * Converts paths like /api/pods/abc-123-def to /api/pods/:id
 */
function normalizePath(path: string): string {
  // Normalize UUID-style IDs in paths
  return path
    .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "/:id")
    .replace(/\/[a-f0-9]{32}/gi, "/:id")
    .replace(/\/[a-f0-9]{64}/gi, "/:id")
    // Normalize Ethereum addresses
    .replace(/\/0x[a-fA-F0-9]{40}/g, "/:address");
}

/**
 * Express middleware for tracking HTTP metrics.
 * Records request duration and counts for all requests.
 */
export function httpMetricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  const normalizedPath = normalizePath(req.path);

  // Track response finish
  res.on("finish", () => {
    const duration = (Date.now() - start) / 1000;
    const statusCode = res.statusCode.toString();

    httpRequestsTotal.labels(req.method, normalizedPath, statusCode).inc();
    httpRequestDurationSeconds.labels(req.method, normalizedPath).observe(duration);
  });

  next();
}

// ============================================================================
// Metrics Endpoint
// ============================================================================

/**
 * Returns the Prometheus metrics in text format.
 * Suitable for /metrics endpoint handler.
 */
export async function getMetrics(): Promise<string> {
  return register.metrics();
}

/**
 * Returns the content type for the metrics response.
 */
export function getMetricsContentType(): string {
  return register.contentType;
}

export { register };