import { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

const defaultOpenCodeBaseUrl = process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4096";

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

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
}

export interface ForwardRequestOptions {
  req: IncomingMessage;
  res: ServerResponse;
  openCodeBaseUrl?: string;
}

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
