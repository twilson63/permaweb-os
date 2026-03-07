import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { verifyHttpMessageSignature } from "./httpSig";

const port = Number(process.env.PORT) || 3001;

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

const server = createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.url === "/verify" && req.method === "POST") {
    if (!hasHttpSignatureHeader(req)) {
      sendJson(res, 401, { error: "missing signature header" });
      return;
    }

    const ownerPublicKeyPem = process.env.OWNER_PUBLIC_KEY_PEM;
    const ownerKeyId = process.env.OWNER_KEY_ID || "owner";

    if (!ownerPublicKeyPem) {
      sendJson(res, 500, { error: "missing OWNER_PUBLIC_KEY_PEM configuration" });
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
        if (keyId !== ownerKeyId) {
          return undefined;
        }

        return ownerPublicKeyPem;
      },
    );

    if (!verified) {
      sendJson(res, 401, { error: "invalid signature" });
      return;
    }

    sendJson(res, 200, { status: "verified", keyId: ownerKeyId });
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(port, () => {
  console.log(`opencode-sidecar listening on port ${port}`);
});
