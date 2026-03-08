const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { tmpdir } = require("node:os");
const { Wallet } = require("ethers");
const { createApp } = require("../dist/index.js");
const { AuthStore } = require("../dist/auth/store.js");
const { LlmSecretStore } = require("../dist/llm/secretStore.js");
const { PodStore } = require("../dist/pods/store.js");
const { UsageStore } = require("../dist/usage/store.js");

const startTestServer = async ({
  authStore = new AuthStore(),
  llmSecretStore = new LlmSecretStore(),
  usageStore = new UsageStore(),
  appOptions
} = {}) => {
  const store = new PodStore();
  const app = createApp(store, authStore, llmSecretStore, usageStore, appOptions);

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

const withGitHubOAuthEnv = async (fn) => {
  const prevClientId = process.env.GITHUB_CLIENT_ID;
  const prevClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const prevRedirectUri = process.env.GITHUB_REDIRECT_URI;

  process.env.GITHUB_CLIENT_ID = "test-client-id";
  process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
  process.env.GITHUB_REDIRECT_URI = "http://127.0.0.1/callback";

  try {
    await fn();
  } finally {
    if (prevClientId === undefined) {
      delete process.env.GITHUB_CLIENT_ID;
    } else {
      process.env.GITHUB_CLIENT_ID = prevClientId;
    }

    if (prevClientSecret === undefined) {
      delete process.env.GITHUB_CLIENT_SECRET;
    } else {
      process.env.GITHUB_CLIENT_SECRET = prevClientSecret;
    }

    if (prevRedirectUri === undefined) {
      delete process.env.GITHUB_REDIRECT_URI;
    } else {
      process.env.GITHUB_REDIRECT_URI = prevRedirectUri;
    }
  }
};

const createUsage = async (server, session, input) => {
  return fetch(`${server.baseUrl}/api/usage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify(input)
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

const createPod = async (server, session, input = "alpha") => {
  const body = typeof input === "string" ? { name: input } : input;
  const response = await fetch(`${server.baseUrl}/api/pods`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify(body)
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

test("GET /api/llm/providers returns configured providers without key values", async () => {
  const secretsDir = mkdtempSync(join(tmpdir(), "web-os-llm-secrets-"));
  writeFileSync(join(secretsDir, "openai"), "sk-test-openai\n", "utf-8");
  writeFileSync(join(secretsDir, "anthropic"), "sk-ant-test\n", "utf-8");

  const server = await startTestServer({ llmSecretStore: new LlmSecretStore(secretsDir) });

  try {
    const { session } = await createSession(server);
    const response = await fetch(`${server.baseUrl}/api/llm/providers`, {
      headers: { authorization: `Bearer ${session.token}` }
    });

    assert.equal(response.status, 200);
    const raw = await response.text();
    assert.equal(raw.includes("sk-test-openai"), false);
    assert.equal(raw.includes("sk-ant-test"), false);

    const payload = JSON.parse(raw);
    assert.deepEqual(payload.providers, ["anthropic", "openai"]);
  } finally {
    await server.close();
    rmSync(secretsDir, { recursive: true, force: true });
  }
});

test("POST /api/pods accepts model selection and stores provider key path", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const response = await createPod(server, session, {
      name: "alpha",
      model: "anthropic/claude-3-5-haiku"
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.llm.model, "anthropic/claude-3-5-haiku");
    assert.equal(payload.llm.provider, "anthropic");
    assert.equal(payload.llm.keyPath, "/secrets/llm/anthropic");
  } finally {
    await server.close();
  }
});

test("POST /api/pods maps different model providers to different key files", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const openaiResponse = await createPod(server, session, {
      name: "openai-pod",
      model: "openai/gpt-4o-mini"
    });
    const anthropicResponse = await createPod(server, session, {
      name: "anthropic-pod",
      model: "anthropic/claude-3-7-sonnet"
    });

    assert.equal(openaiResponse.status, 201);
    assert.equal(anthropicResponse.status, 201);

    const openaiPod = await openaiResponse.json();
    const anthropicPod = await anthropicResponse.json();

    assert.equal(openaiPod.llm.provider, "openai");
    assert.equal(openaiPod.llm.keyPath, "/secrets/llm/openai");
    assert.equal(anthropicPod.llm.provider, "anthropic");
    assert.equal(anthropicPod.llm.keyPath, "/secrets/llm/anthropic");
  } finally {
    await server.close();
  }
});

test("POST /api/pods rejects unsupported model selection", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const response = await createPod(server, session, {
      name: "alpha",
      model: "invalid/model"
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error, "Unsupported model selection");
    assert.equal(Array.isArray(payload.supportedModels), true);
    assert.equal(payload.supportedModels.includes("openai/gpt-4o-mini"), true);
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

test("POST /api/usage creates a usage record with calculated cost", async () => {
  const server = await startTestServer();

  try {
    const { session, wallet } = await createSession(server);
    const response = await createUsage(server, session, {
      model: "openai/gpt-4o-mini",
      promptTokens: 1000,
      completionTokens: 2000
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.ownerWallet, wallet.address);
    assert.equal(payload.model, "openai/gpt-4o-mini");
    assert.equal(payload.promptTokens, 1000);
    assert.equal(payload.completionTokens, 2000);
    assert.equal(payload.totalTokens, 3000);
    assert.equal(payload.costUsd, 0.00135);
  } finally {
    await server.close();
  }
});

test("GET /api/usage aggregates records by wallet", async () => {
  const server = await startTestServer();

  try {
    const { session } = await createSession(server);
    const { session: otherSession } = await createSession(server);

    await createUsage(server, session, {
      model: "openai/gpt-4o-mini",
      promptTokens: 1000,
      completionTokens: 1000
    });
    await createUsage(server, session, {
      model: "openai/gpt-4o-mini",
      promptTokens: 500,
      completionTokens: 500
    });
    await createUsage(server, otherSession, {
      model: "openai/gpt-4o-mini",
      promptTokens: 999,
      completionTokens: 999
    });

    const response = await fetch(`${server.baseUrl}/api/usage`, {
      headers: { authorization: `Bearer ${session.token}` }
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.summary.requestCount, 2);
    assert.equal(payload.summary.promptTokens, 1500);
    assert.equal(payload.summary.completionTokens, 1500);
    assert.equal(payload.summary.totalTokens, 3000);
    assert.equal(payload.summary.totalCostUsd, 0.001125);
    assert.equal(payload.records.length, 2);
  } finally {
    await server.close();
  }
});

test("usage records persist across UsageStore restarts", async () => {
  const usagePath = join(mkdtempSync(join(tmpdir(), "web-os-usage-")), "usage-store.json");
  const usageStore = new UsageStore(usagePath);
  const server = await startTestServer({ usageStore });
  let closed = false;

  try {
    const wallet = Wallet.createRandom();
    const { session } = await createSession(server, wallet);
    const created = await createUsage(server, session, {
      model: "anthropic/claude-3-5-haiku",
      promptTokens: 1000,
      completionTokens: 1000
    });

    assert.equal(created.status, 201);
    await server.close();
    closed = true;

    const restartedServer = await startTestServer({ usageStore: new UsageStore(usagePath) });
    try {
      const { session: restartedSession } = await createSession(restartedServer, wallet);
      const response = await fetch(`${restartedServer.baseUrl}/api/usage`, {
        headers: { authorization: `Bearer ${restartedSession.token}` }
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.summary.requestCount, 1);
      assert.equal(payload.summary.totalTokens, 2000);
      assert.equal(payload.summary.totalCostUsd, 0.0048);
      assert.equal(payload.records.length, 1);
      assert.equal(payload.records[0].model, "anthropic/claude-3-5-haiku");
    } finally {
      await restartedServer.close();
    }
  } finally {
    if (!closed) {
      await server.close();
    }
    rmSync(dirname(usagePath), { recursive: true, force: true });
  }
});

test("GET /api/auth/github redirects to GitHub authorize URL", async () => {
  await withGitHubOAuthEnv(async () => {
    const server = await startTestServer();

    try {
      const { session } = await createSession(server);
      const response = await fetch(`${server.baseUrl}/api/auth/github`, {
        headers: { authorization: `Bearer ${session.token}` },
        redirect: "manual"
      });

      assert.equal(response.status, 302);
      const location = response.headers.get("location");
      assert.equal(typeof location, "string");
      assert.match(location, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
      assert.match(location, /client_id=test-client-id/);
      assert.match(location, /scope=repo\+read%3Auser/);
      assert.match(location, /state=/);
    } finally {
      await server.close();
    }
  });
});

test("GET /api/auth/github/callback stores GitHub token in session", async () => {
  await withGitHubOAuthEnv(async () => {
    const authStore = new AuthStore();
    const server = await startTestServer({
      authStore,
      appOptions: {
        exchangeGitHubCode: async ({ code }) => {
          assert.equal(code, "oauth-code");
          return "gho_test_token";
        }
      }
    });

    try {
      const { session } = await createSession(server);
      const redirectResponse = await fetch(`${server.baseUrl}/api/auth/github`, {
        headers: { authorization: `Bearer ${session.token}` },
        redirect: "manual"
      });

      assert.equal(redirectResponse.status, 302);
      const location = redirectResponse.headers.get("location");
      const state = new URL(location).searchParams.get("state");
      assert.equal(typeof state, "string");

      const callback = await fetch(
        `${server.baseUrl}/api/auth/github/callback?code=oauth-code&state=${encodeURIComponent(state)}`
      );

      assert.equal(callback.status, 200);
      const payload = await callback.json();
      assert.equal(payload.connected, true);
      assert.equal(authStore.getGitHubToken(session.token), "gho_test_token");
    } finally {
      await server.close();
    }
  });
});
