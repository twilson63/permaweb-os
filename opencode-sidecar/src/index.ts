import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { verifyHttpMessageSignature } from "./httpSig";

const defaultPort = Number(process.env.PORT) || 3001;
const OPENCODE_BIN = process.env.OPENCODE_BIN || "/Users/tron/.opencode/bin/opencode";
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || ""; // Empty = use default

interface SidecarConfig {
  ownerKeyId?: string;
  ownerPublicKeyPem?: string;
  openCodeBin?: string;
  openCodeModel?: string;
}

function hasHttpSignatureHeader(req: IncomingMessage): boolean {
  const signature = req.headers["signature"];
  return typeof signature === "string" && signature.length > 0;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function toHeaderRecord(req: IncomingMessage): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};

  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers[name] = value;
    }
  }

  return headers;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString();
}

async function runOpenCode(
  content: string,
  model?: string,
  sessionId?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["run", "--format", "json"];

    // Only add model if specified
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

    // Write the message to stdin
    const message = JSON.stringify({ content });
    proc.stdin?.write(message);
    proc.stdin?.end();
  });
}

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

      // Read the request body
      let body: string;
      try {
        body = await readRequestBody(req);
      } catch (err) {
        sendJson(res, 400, { error: "failed to read request body" });
        return;
      }

      // Parse the request
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

      // Run OpenCode
      try {
        const output = await runOpenCode(
          request.content,
          request.model || openCodeModel,
          request.sessionId
        );

        // Stream JSONL response
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

if (require.main === module) {
  const server = createSidecarServer();

  server.listen(defaultPort, () => {
    console.log(`opencode-sidecar listening on port ${defaultPort}`);
  });
}