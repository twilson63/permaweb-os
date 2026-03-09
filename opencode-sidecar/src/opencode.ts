import { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

/**
 * Reverse-proxy helpers used to forward requests to a local OpenCode daemon.
 */

/**
 * Base URL of the upstream OpenCode server.
 */
const defaultOpenCodeBaseUrl = process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4096";

/**
 * Request headers that should never be forwarded by proxies.
 */
const hopByHopRequestHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

/**
 * Response headers stripped before relaying back to clients.
 */
const hopByHopResponseHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Converts Node request headers into Fetch API headers while removing
 * hop-by-hop entries and transport-managed headers.
 *
 * @param req - Incoming Node HTTP request.
 * @returns Sanitized fetch-compatible headers.
 */
function toRequestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, rawValue] of Object.entries(req.headers)) {
    if (rawValue === undefined || hopByHopRequestHeaders.has(name)) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        headers.append(name, value);
      }
      continue;
    }

    headers.set(name, rawValue);
  }

  return headers;
}

/**
 * Copies upstream response headers/status onto the downstream response.
 *
 * @param res - Outgoing Node response.
 * @param upstreamResponse - Response received from upstream fetch call.
 */
function writeResponseHeaders(res: ServerResponse, upstreamResponse: Response): void {
  for (const [name, value] of upstreamResponse.headers.entries()) {
    if (hopByHopResponseHeaders.has(name)) {
      continue;
    }

    res.setHeader(name, value);
  }

  res.statusCode = upstreamResponse.status;
  res.statusMessage = upstreamResponse.statusText;
}

/**
 * Reads and buffers an incoming request body.
 *
 * @param req - Incoming Node HTTP request.
 * @returns Full body as a Buffer.
 */
async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Options used when forwarding one request to OpenCode.
 */
export interface ForwardRequestOptions {
  req: IncomingMessage;
  res: ServerResponse;
  openCodeBaseUrl?: string;
}

/**
 * Forwards the incoming request to OpenCode and streams the response back.
 *
 * @param options - Forwarding request/response context.
 */
export async function forwardRequestToOpenCode(options: ForwardRequestOptions): Promise<void> {
  const { req, res } = options;
  const openCodeBaseUrl = options.openCodeBaseUrl ?? defaultOpenCodeBaseUrl;
  const method = req.method ?? "POST";
  const upstreamUrl = new URL(req.url ?? "/", openCodeBaseUrl).toString();
  const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(req);

  const upstreamResponse = await fetch(upstreamUrl, {
    method,
    headers: toRequestHeaders(req),
    body: body as any,
  });

  writeResponseHeaders(res, upstreamResponse);

  if (!upstreamResponse.body) {
    res.end();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const stream = Readable.fromWeb(upstreamResponse.body as any);

    stream.on("error", reject);
    res.on("error", reject);
    res.on("close", resolve);
    stream.pipe(res);
  });
}
