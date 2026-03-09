import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { verifyHttpMessageSignature } from "./httpSig";

/**
 * Sidecar server entry point.
 *
 * This service verifies HTTP signatures and then executes OpenCode CLI requests
 * on behalf of authorized callers.
 */

const defaultPort = Number(process.env.PORT) || 3001;
const OPENCODE_BIN = process.env.OPENCODE_BIN || "/Users/tron/.opencode/bin/opencode";
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || ""; // Empty = use default

/**
 * Runtime overrides for sidecar behavior.
 */
interface SidecarConfig {
  ownerKeyId?: string;
  ownerPublicKeyPem?: string;
  openCodeBin?: string;
  openCodeModel?: string;
}

/**
 * Checks whether a request contains an HTTP `Signature` header.
 *
 * @param req - Incoming HTTP request.
 * @returns `true` when a non-empty signature header is present.
 */
function hasHttpSignatureHeader(req: IncomingMessage): boolean {
  const signature = req.headers["signature"];
  return typeof signature === "string" && signature.length > 0;
}

/**
 * Sends a JSON response with status code and serialized payload.
 *
 * @param res - Outgoing server response.
 * @param statusCode - HTTP status code.
 * @param body - JSON-serializable payload.
 */
function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Normalizes Node request headers into a simple object map.
 *
 * @param req - Incoming HTTP request.
 * @returns Header record containing only defined entries.
 */
function toHeaderRecord(req: IncomingMessage): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};

  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers[name] = value;
    }
  }

  return headers;
}

/**
 * Reads the full request body into a UTF-8 string.
 *
 * @param req - Incoming HTTP request stream.
 * @returns Request body text.
 */
async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString();
}

/**
 * Runs the OpenCode CLI and returns its NDJSON output.
 *
 * @param content - Prompt content sent to OpenCode stdin.
 * @param model - Optional model override.
 * @param sessionId - Optional OpenCode session ID for context continuity.
 * @returns Raw stdout output emitted by OpenCode.
 */
async function runOpenCode(
  content: string,
  model?: string,
  sessionId?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["run", "--format", "json"];

    /** Only pass model flag when an explicit value is available. */
    if (model && model.trim()) {
      args.push("--model", model);
    }

    if (sessionId) {
      args.push("--session", sessionId);
    }

    const proc = spawn(OPENCODE_BIN, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`OpenCode exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });

    /** OpenCode reads one JSON payload from stdin for each request. */
    const message = JSON.stringify({ content });
    proc.stdin?.write(message);
    proc.stdin?.end();
  });
}

/**
 * Creates the sidecar HTTP server instance.
 *
 * @param config - Optional runtime overrides.
 * @returns Configured Node HTTP server.
 */
export function createSidecarServer(config: SidecarConfig = {}) {
  const ownerKeyId = config.ownerKeyId ?? process.env.OWNER_KEY_ID ?? "owner";
  const ownerPublicKeyPem = config.ownerPublicKeyPem ?? process.env.OWNER_PUBLIC_KEY_PEM;
  const openCodeBin = config.openCodeBin ?? OPENCODE_BIN;
  const openCodeModel = config.openCodeModel ?? OPENCODE_MODEL;

  return createServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (req.url === "/verify" && req.method === "POST") {
      if (!hasHttpSignatureHeader(req)) {
        sendJson(res, 401, { error: "missing signature header" });
        return;
      }

      const verified = await verifyHttpMessageSignature(
        {
          method: req.method,
          url: req.url,
          headers: toHeaderRecord(req),
          protocol: "http",
        },
        async (keyId) => {
          if (keyId !== ownerKeyId || !ownerPublicKeyPem) {
            return undefined;
          }

          return ownerPublicKeyPem;
        },
        ownerKeyId,
      );

      if (!verified) {
        sendJson(res, 401, { error: "invalid signature" });
        return;
      }

      /** Read and parse the JSON request payload after signature validation. */
      let body: string;
      try {
        body = await readRequestBody(req);
      } catch (err) {
        sendJson(res, 400, { error: "failed to read request body" });
        return;
      }

      let request: { content?: string; model?: string; sessionId?: string };
      try {
        request = JSON.parse(body);
      } catch {
        sendJson(res, 400, { error: "invalid JSON" });
        return;
      }

      if (!request.content) {
        sendJson(res, 400, { error: "missing content" });
        return;
      }

      try {
        const output = await runOpenCode(
          request.content,
          request.model || openCodeModel,
          request.sessionId
        );

        /** Relay OpenCode's newline-delimited JSON stream to the caller. */
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.end(output);
      } catch (err) {
        const message = err instanceof Error ? err.message : "OpenCode failed";
        sendJson(res, 502, { error: "upstream unavailable", message });
      }

      return;
    }

    sendJson(res, 404, { error: "not found" });
  });
}

/**
 * Starts the sidecar when run directly from the command line.
 */
if (require.main === module) {
  const server = createSidecarServer();

  server.listen(defaultPort, () => {
    console.log(`opencode-sidecar listening on port ${defaultPort}`);
  });
}
