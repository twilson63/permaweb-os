const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const manifest = readFileSync('k8s/stale-pod-cleanup.yaml', 'utf8');
const deployScript = readFileSync('scripts/deploy.sh', 'utf8');
const orchestrator = readFileSync('api/src/pods/orchestrator.ts', 'utf8');
const authProxy = readFileSync('auth-proxy/src/index.ts', 'utf8');

test('stale pod cleanup cronjob is source-controlled and scheduled hourly', () => {
  assert.match(manifest, /kind:\s*CronJob/);
  assert.match(manifest, /name:\s*stale-pod-cleanup/);
  assert.match(manifest, /schedule:\s*"0 \* \* \* \*"/);
  assert.match(manifest, /IDLE_TTL_HOURS[\s\S]*value:\s*"24"/);
});

test('cleanup job deletes pod runtime resources but preserves PVCs', () => {
  for (const resource of ['pod', 'service', 'ingress', 'configmap', 'rolebinding', 'role', 'serviceaccount']) {
    assert.match(manifest, new RegExp(`kubectl delete ${resource}`));
  }

  assert.doesNotMatch(manifest, /delete\s+(persistentvolumeclaim|pvc)\b/i);
});

test('cleanup manifest is included in standard deploy flow', () => {
  assert.match(deployScript, /stale-pod-cleanup\.yaml/);
});

test('user pods are annotated and granted own-pod activity RBAC', () => {
  assert.match(orchestrator, /web-os\.io\/last-used-at/);
  assert.match(orchestrator, /serviceAccountName:\s*podName/);
  assert.match(orchestrator, /resourceNames:\s*\[podName\]/);
  assert.match(orchestrator, /verbs:\s*\['get', 'patch'\]/);
});

test('auth proxy patches last-used annotation before proxying traffic', () => {
  assert.match(authProxy, /ACTIVITY_ANNOTATION\s*=\s*'web-os\.io\/last-used-at'/);
  assert.match(authProxy, /method:\s*'PATCH'/);
  assert.match(authProxy, /application\/merge-patch\+json/);
  assert.match(authProxy, /markPodActivity\(\);/);
});
