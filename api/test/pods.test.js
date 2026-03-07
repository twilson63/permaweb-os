const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../dist/index.js");
const { PodStore } = require("../dist/pods/store.js");

const startTestServer = async () => {
  const store = new PodStore();
  const app = createApp(store);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      resolve({
        baseUrl,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
};

test("POST /api/pods creates a pod and returns subdomain", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/api/pods`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alpha" })
    });

    assert.equal(response.status, 201);

    const payload = await response.json();
    assert.equal(payload.name, "alpha");
    assert.equal(payload.status, "running");
    assert.equal(typeof payload.id, "string");
    assert.equal(typeof payload.createdAt, "string");
    assert.equal(typeof payload.subdomain, "string");
    assert.match(payload.subdomain, /pods\.local$/);
  } finally {
    await server.close();
  }
});
