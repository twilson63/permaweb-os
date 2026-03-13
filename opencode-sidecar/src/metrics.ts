/**
 * @fileoverview Prometheus metrics module for HTTPSig Sidecar.
 * @module metrics
 * @description Provides production-ready observability metrics for the HTTPSig sidecar.
 */

import client from "prom-client";

/**
 * Prometheus registry for sidecar metrics.
 */
const register = client.register;

/**
 * Enable default metrics (GC, memory, CPU, etc.)
 */
client.collectDefaultMetrics({ register });

// ============================================================================
// HTTPSig Verification Metrics
// ============================================================================

/**
 * Counter for HTTPSig signature verification attempts.
 * Label: result - one of success, failure.
 */
export const httpsigVerificationsTotal = new client.Counter({
  name: "webos_httpsig_verifications_total",
  help: "Total number of HTTPSig signature verifications",
  labelNames: ["result"],
});

/**
 * Histogram for HTTPSig verification latency.
 * Measures time spent verifying signatures.
 */
export const httpsigVerificationDurationSeconds = new client.Histogram({
  name: "webos_httpsig_verification_duration_seconds",
  help: "HTTPSig signature verification latency in seconds",
  labelNames: [],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

// ============================================================================
// Proxy Metrics
// ============================================================================

/**
 * Counter for proxied requests to OpenCode.
 * Labels: status - HTTP status code category (2xx, 4xx, 5xx).
 */
export const proxyRequestsTotal = new client.Counter({
  name: "webos_proxy_requests_total",
  help: "Total number of requests proxied to OpenCode",
  labelNames: ["status"],
});

// ============================================================================
// Replay Protection Metrics
// ============================================================================

/**
 * Counter for rejected replayed requests.
 * Tracks requests blocked due to replay attack protection.
 */
export const replayRejectionsTotal = new client.Counter({
  name: "webos_replay_rejections_total",
  help: "Total number of replayed requests rejected",
  labelNames: ["reason"],
});

// ============================================================================
// Metrics Export
// ============================================================================

/**
 * Returns the Prometheus metrics in text format.
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