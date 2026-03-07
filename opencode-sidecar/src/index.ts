import { createServer, IncomingMessage, ServerResponse } from "node:http";

const port = Number(process.env.PORT) || 3001;

function hasHttpSignatureHeader(req: IncomingMessage): boolean {
  const signature = req.headers["signature"];
  return typeof signature === "string" && signature.length > 0;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.url === "/verify" && req.method === "POST") {
    if (!hasHttpSignatureHeader(req)) {
      sendJson(res, 401, { error: "missing signature header" });
      return;
    }

    sendJson(res, 501, { error: "httpsig verification not implemented" });
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(port, () => {
  console.log(`opencode-sidecar listening on port ${port}`);
});
