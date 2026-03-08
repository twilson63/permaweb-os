const test = require("node:test");
const assert = require("node:assert/strict");
const { Wallet } = require("ethers");
const { createApp } = require("../dist/index.js");
const { AuthStore } = require("../dist/auth/store.js");
const { PodStore } = require("../dist/pods/store.js");

const startTestServer = async ({ authStore = new AuthStore() } = {}) => {
  const store = new PodStore();
  const app = createApp(store, authStore);

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

const createSession = async (server, wallet = Wallet.createRandom()) => {
  const nonceResponse = await fetch(`${server.baseUrl}/api/auth/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: wallet.address })
  });

  assert.equal(nonceResponse.status, 200);
  const challenge = await nonceResponse.json();
  const signature = await wallet.signMessage(challenge.message);

  const verifyResponse = await fetch(`${server.baseUrl}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: wallet.address, signature })
  });

  assert.equal(verifyResponse.status, 200);
  const session = await verifyResponse.json();
  return {
    session,
    wallet
  };
};

const createPod = async (server, session, name = "alpha") => {
  const response = await fetch(`${server.baseUrl}/api/pods`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({ name })
  });

  return response;
};

test("POST /api/pods creates a pod and binds owner wallet", async () => {
  const server = await startTestServer();

  try {
    const { session, wallet } = await createSession(server);
    const response = await createPod(server, session, "alpha");

    assert.equal(response.status, 201);

    const payload = await response.json();
    assert.equal(payload.name, "alpha");
    assert.equal(payload.status, "running");
    assert.equal(typeof payload.id, "string");
    assert.equal(typeof payload.createdAt, "string");
    assert.equal(typeof payload.subdomain, "string");
    assert.match(payload.subdomain, /pods\.local$/);
    assert.equal(payload.ownerWallet, wallet.address);
  } finally {
    await server.close();
  }
});

test("GET /api/pods lists created pods", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const { session: otherSession } = await createSession(server);
    await createPod(server, session, "alpha");
    await createPod(server, otherSession, "beta");

    const response = await fetch(`${server.baseUrl}/api/pods`, {
      headers: { authorization: `Bearer ${session.token}` }
    });
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(Array.isArray(payload.pods), true);
    assert.equal(payload.pods.length, 1);
    assert.equal(payload.pods[0].name, "alpha");
    assert.equal(typeof payload.pods[0].subdomain, "string");
  } finally {
    await server.close();
  }
});

test("GET /api/pods/:id returns pod status and subdomain", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const created = await createPod(server, session, "alpha");

    const pod = await created.json();
    const response = await fetch(`${server.baseUrl}/api/pods/${pod.id}`, {
      headers: { authorization: `Bearer ${session.token}` }
    });
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.id, pod.id);
    assert.equal(payload.status, "running");
    assert.equal(typeof payload.subdomain, "string");
    assert.equal(payload.ownerWallet, pod.ownerWallet);
  } finally {
    await server.close();
  }
});

test("GET /api/pods/:id returns 403 for non-owner session", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const { session: otherSession } = await createSession(server);
    const created = await createPod(server, session, "alpha");
    const pod = await created.json();

    const response = await fetch(`${server.baseUrl}/api/pods/${pod.id}`, {
      headers: { authorization: `Bearer ${otherSession.token}` }
    });

    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.error, "Forbidden");
  } finally {
    await server.close();
  }
});

test("GET /api/pods/:id returns 404 for unknown pod", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const response = await fetch(`${server.baseUrl}/api/pods/missing-id`, {
      headers: { authorization: `Bearer ${session.token}` }
    });
    assert.equal(response.status, 404);

    const payload = await response.json();
    assert.equal(payload.error, "Pod not found");
  } finally {
    await server.close();
  }
});

test("DELETE /api/pods/:id deletes pod", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const created = await createPod(server, session, "alpha");

    const pod = await created.json();
    const deleted = await fetch(`${server.baseUrl}/api/pods/${pod.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${session.token}` }
    });
    assert.equal(deleted.status, 204);

    const lookup = await fetch(`${server.baseUrl}/api/pods/${pod.id}`, {
      headers: { authorization: `Bearer ${session.token}` }
    });
    assert.equal(lookup.status, 404);
  } finally {
    await server.close();
  }
});

test("DELETE /api/pods/:id returns 403 for non-owner session", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const { session: otherSession } = await createSession(server);
    const created = await createPod(server, session, "alpha");
    const pod = await created.json();

    const response = await fetch(`${server.baseUrl}/api/pods/${pod.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${otherSession.token}` }
    });

    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.error, "Forbidden");
  } finally {
    await server.close();
  }
});

test("DELETE /api/pods/:id returns 404 for unknown pod", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const response = await fetch(`${server.baseUrl}/api/pods/missing-id`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${session.token}` }
    });

    assert.equal(response.status, 404);
    const payload = await response.json();
    assert.equal(payload.error, "Pod not found");
  } finally {
    await server.close();
  }
});

test("POST /api/auth/verify returns session token for valid signature", async () => {
  const server = await startTestServer();

  try {
    const wallet = Wallet.createRandom();
    const nonceResponse = await fetch(`${server.baseUrl}/api/auth/nonce`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: wallet.address })
    });

    assert.equal(nonceResponse.status, 200);
    const challenge = await nonceResponse.json();
    assert.equal(typeof challenge.message, "string");
    assert.equal(typeof challenge.nonce, "string");

    const signature = await wallet.signMessage(challenge.message);
    const verifyResponse = await fetch(`${server.baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: wallet.address, signature })
    });

    assert.equal(verifyResponse.status, 200);
    const session = await verifyResponse.json();
    assert.equal(typeof session.token, "string");
    assert.equal(typeof session.expiresAt, "string");
  } finally {
    await server.close();
  }
});

test("GET /api/pods returns 401 without session token", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/api/pods`);
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.error, "Unauthorized");
  } finally {
    await server.close();
  }
});

test("GET /api/pods returns pods owned by authenticated session", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const { session: otherSession } = await createSession(server);
    await createPod(server, session, "alpha");
    await createPod(server, otherSession, "beta");

    const response = await fetch(`${server.baseUrl}/api/pods`, {
      headers: { authorization: `Bearer ${session.token}` }
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(Array.isArray(payload.pods), true);
    assert.equal(payload.pods.length, 1);
    assert.equal(payload.pods[0].name, "alpha");
  } finally {
    await server.close();
  }
});

test("GET /api/pods returns 401 after session expiry", async () => {
  const authStore = new AuthStore({ sessionTtlMs: 20 });
  const server = await startTestServer({ authStore });

  try {
    const { session } = await createSession(server);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const response = await fetch(`${server.baseUrl}/api/pods`, {
      headers: { authorization: `Bearer ${session.token}` }
    });

    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.error, "Unauthorized");
  } finally {
    await server.close();
  }
});

test("POST /api/auth/verify rejects invalid signature", async () => {
  const server = await startTestServer();

  try {
    const wallet = Wallet.createRandom();
    const otherWallet = Wallet.createRandom();
    const nonceResponse = await fetch(`${server.baseUrl}/api/auth/nonce`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: wallet.address })
    });

    assert.equal(nonceResponse.status, 200);
    const challenge = await nonceResponse.json();
    const invalidSignature = await otherWallet.signMessage(challenge.message);

    const verifyResponse = await fetch(`${server.baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: wallet.address, signature: invalidSignature })
    });

    assert.equal(verifyResponse.status, 401);
    const payload = await verifyResponse.json();
    assert.equal(payload.error, "Invalid or expired signature challenge");
  } finally {
    await server.close();
  }
});
