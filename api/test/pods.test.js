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

test("GET /api/pods lists created pods", async () => {
  const server = await startTestServer();

  try {
    await fetch(`${server.baseUrl}/api/pods`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alpha" })
    });

    await fetch(`${server.baseUrl}/api/pods`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "beta" })
    });

    const response = await fetch(`${server.baseUrl}/api/pods`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(Array.isArray(payload.pods), true);
    assert.equal(payload.pods.length, 2);
    assert.equal(payload.pods[0].name, "alpha");
    assert.equal(payload.pods[1].name, "beta");
    assert.equal(typeof payload.pods[0].subdomain, "string");
  } finally {
    await server.close();
  }
});

test("GET /api/pods/:id returns pod status and subdomain", async () => {
  const server = await startTestServer();

  try {
    const created = await fetch(`${server.baseUrl}/api/pods`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alpha" })
    });

    const pod = await created.json();
    const response = await fetch(`${server.baseUrl}/api/pods/${pod.id}`);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.id, pod.id);
    assert.equal(payload.status, "running");
    assert.equal(typeof payload.subdomain, "string");
  } finally {
    await server.close();
  }
});

test("GET /api/pods/:id returns 404 for unknown pod", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/api/pods/missing-id`);
    assert.equal(response.status, 404);

    const payload = await response.json();
    assert.equal(payload.error, "Pod not found");
  } finally {
    await server.close();
  }
});
