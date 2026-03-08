import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { verifyHttpMessageSignature } from "./httpSig";
import { forwardRequestToOpenCode } from "./opencode";

const defaultPort = Number(process.env.PORT) || 3001;

interface SidecarConfig {
  ownerKeyId?: string;
  ownerPublicKeyPem?: string;
  openCodeBaseUrl?: string;
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

export function createSidecarServer(config: SidecarConfig = {}) {
  const ownerKeyId = config.ownerKeyId ?? process.env.OWNER_KEY_ID ?? "owner";
  const ownerPublicKeyPem = config.ownerPublicKeyPem ?? process.env.OWNER_PUBLIC_KEY_PEM;
  const openCodeBaseUrl = config.openCodeBaseUrl ?? process.env.OPENCODE_BASE_URL;

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

      try {
        await forwardRequestToOpenCode({ req, res, openCodeBaseUrl });
      } catch (error) {
        if (res.headersSent) {
          res.destroy(error instanceof Error ? error : undefined);
          return;
        }

        const message = error instanceof Error ? error.message : "failed to reach OpenCode";
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
