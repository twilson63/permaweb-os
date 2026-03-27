# PVC Migration Plan: Persistent Storage with Scale-to-Zero

## Overview

Migrate pods from ephemeral storage (emptyDir) to persistent volumes (PVC) to enable safe scale-to-zero without data loss.

## Current State

- **Pods:** 16 running, using `emptyDir` for `/workspace`
- **Data location:** Container filesystem (lost on pod deletion)
- **Cost:** $108/month (pods run 24/7)
- **Risk:** Data loss on pod restart/deletion

## Target State

- **Pods:** Can scale to 0 when idle, data persists in PVC
- **Data location:** Persistent Volume Claim (block storage)
- **Cost:** ~$32-52/month (pods scaled down when idle)
- **Risk:** No data loss on scale-to-zero

---

## Phase 1: PVC Infrastructure Setup

### Step 1.1: Verify StorageClass Available

**Action:** Check DigitalOcean block storage is available in cluster.

```bash
kubectl get storageclass
```

**Expected Output:**
```
NAME                            PROVISIONER                 AGE
do-block-storage                dobs.csi.digitalocean.com   Xd
```

**Success Criteria:**
- [ ] `do-block-storage` StorageClass exists
- [ ] PROVISIONER is `dobs.csi.digitalocean.com`

---

### Step 1.2: Create Test PVC

**Action:** Create a test PVC to verify dynamic provisioning works.

```yaml
# k8s/test-pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-workspace
  namespace: web-os
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: do-block-storage
```

```bash
kubectl apply -f k8s/test-pvc.yaml
kubectl get pvc -n web-os test-workspace
```

**Expected Output:**
```
NAME              STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS       AGE
test-workspace    Bound    pvc-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx   1Gi        RWO            do-block-storage    Xs
```

**Success Criteria:**
- [ ] PVC status is `Bound`
- [ ] Volume is provisioned automatically
- [ ] No errors in `kubectl describe pvc test-workspace -n web-os`

---

### Step 1.3: Verify PVC Mount in Test Pod

**Action:** Create test pod with PVC mounted, verify data persistence.

```yaml
# k8s/test-pod-pvc.yaml
apiVersion: v1
kind: Pod
metadata:
  name: test-pvc-pod
  namespace: web-os
spec:
  containers:
  - name: test
    image: busybox
    command: ['sh', '-c', 'sleep 3600']
    volumeMounts:
    - name: workspace
      mountPath: /workspace
  volumes:
  - name: workspace
    persistentVolumeClaim:
      claimName: test-workspace
```

```bash
kubectl apply -f k8s/test-pod-pvc.yaml
kubectl wait --for=condition=ready pod/test-pvc-pod -n web-os --timeout=60s
```

**Test Data Persistence:**
```bash
# Write data
kubectl exec test-pvc-pod -n web-os -- sh -c "echo 'test-data-$(date)' > /workspace/test.txt"

# Verify write
kubectl exec test-pvc-pod -n web-os -- cat /workspace/test.txt

# Delete pod (simulating scale-to-zero)
kubectl delete pod test-pvc-pod -n web-os

# Recreate pod
kubectl apply -f k8s/test-pod-pvc.yaml
kubectl wait --for=condition=ready pod/test-pvc-pod -n web-os --timeout=60s

# Verify data survived
kubectl exec test-pvc-pod -n web-os -- cat /workspace/test.txt
```

**Expected Output:**
```
test-data-<timestamp>
```
(Data should match what was written before deletion)

**Success Criteria:**
- [ ] Pod starts successfully with PVC mounted
- [ ] Can write to `/workspace`
- [ ] Data survives pod deletion and recreation
- [ ] No permission errors

---

### Step 1.4: Cleanup Test Resources

```bash
kubectl delete pod test-pvc-pod -n web-os
kubectl delete pvc test-workspace -n web-os
rm k8s/test-pvc.yaml k8s/test-pod-pvc.yaml
```

**Success Criteria:**
- [ ] All test resources deleted
- [ ] No orphaned volumes (check `kubectl get pv`)

---

## Phase 2: Update Pod Template

### Step 2.1: Create PVC Template

**Action:** Create template for user workspace PVCs.

```yaml
# k8s/workspace-pvc-template.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: workspace-{{WALLET_ADDRESS}}
  namespace: web-os
  labels:
    app: opencode-pod
    wallet: {{WALLET_ADDRESS}}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: do-block-storage
```

**Success Criteria:**
- [ ] Template file created
- [ ] Placeholders documented

---

### Step 2.2: Update Pod Deployment Template

**Action:** Modify pod template to include PVC volume.

```yaml
# k8s/pod-template-with-pvc.yaml (changes from current)
spec:
  template:
    spec:
      volumes:
      - name: workspace
        persistentVolumeClaim:
          claimName: workspace-{{WALLET_ADDRESS}}
      containers:
      - name: opencode
        volumeMounts:
        - name: workspace
          mountPath: /workspace
      - name: auth-proxy
        volumeMounts:
        - name: workspace
          mountPath: /workspace
          readOnly: false
```

**Success Criteria:**
- [ ] New template file created
- [ ] Template validated with `kubectl --dry-run`

---

### Step 2.3: Create Migration Script

**Action:** Create script to migrate existing pods to PVC.

```bash
# scripts/migrate-pod-to-pvc.sh
#!/bin/bash
set -e

WALLET=$1
POD_ID=$2

if [ -z "$WALLET" ] || [ -z "$POD_ID" ]; then
  echo "Usage: $0 <wallet-address> <pod-id>"
  exit 1
fi

echo "=== Migrating pod $POD_ID for wallet $WALLET ==="

# Step 1: Check if pod exists
if ! kubectl get pod $POD_ID -n web-os &>/dev/null; then
  echo "ERROR: Pod $POD_ID not found"
  exit 1
fi

# Step 2: Check if PVC already exists
if kubectl get pvc workspace-$WALLET -n web-os &>/dev/null; then
  echo "PVC workspace-$WALLET already exists, skipping creation"
else
  echo "Creating PVC..."
  cat k8s/workspace-pvc-template.yaml | \
    sed "s/{{WALLET_ADDRESS}}/$WALLET/g" | \
    kubectl apply -f -
  
  # Wait for PVC to bind
  kubectl wait --for=condition=bound pvc/workspace-$WALLET -n web-os --timeout=60s
fi

# Step 3: Backup data from pod
echo "Backing up data from pod..."
kubectl exec $POD_ID -n web-os -- tar czf /tmp/workspace-backup.tar.gz -C /workspace . 2>/dev/null || true
kubectl cp web-os/$POD_ID:/tmp/workspace-backup.tar.gz /tmp/workspace-$WALLET-backup.tar.gz 2>/dev/null || true

# Step 4: Record current config
echo "Recording pod configuration..."
kubectl get pod $POD_ID -n web-os -o yaml > /tmp/pod-$POD_ID-config.yaml

echo "=== Migration preparation complete ==="
echo "PVC: workspace-$WALLET"
echo "Backup: /tmp/workspace-$WALLET-backup.tar.gz"
echo "Config: /tmp/pod-$POD_ID-config.yaml"
echo ""
echo "To complete migration:"
echo "1. Delete old pod: kubectl delete pod $POD_ID -n web-os"
echo "2. Recreate with PVC using API"
```

**Success Criteria:**
- [ ] Script created and executable
- [ ] Handles errors gracefully
- [ ] Creates backup before migration

---

## Phase 3: API Changes

### Step 3.1: Add PVC Creation to Pod Creation API

**Action:** Update pod creation to create PVC for new pods.

```typescript
// api/src/pods/create-pvc.ts

export async function createWorkspacePvc(wallet: string): Promise<string> {
  const pvcName = `workspace-${wallet}`;
  
  // Check if PVC already exists
  const existing = await k8sClient.readNamespacedPersistentVolumeClaim(pvcName, 'web-os');
  if (existing) {
    return pvcName;
  }
  
  // Create PVC
  const pvc = {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name: pvcName,
      namespace: 'web-os',
      labels: {
        app: 'opencode-pod',
        wallet: wallet
      }
    },
    spec: {
      accessModes: ['ReadWriteOnce'],
      resources: {
        requests: {
          storage: '1Gi'
        }
      },
      storageClassName: 'do-block-storage'
    }
  };
  
  await k8sClient.createNamespacedPersistentVolumeClaim('web-os', pvc);
  
  // Wait for PVC to bind
  await waitForPvcBound(pvcName);
  
  return pvcName;
}

async function waitForPvcBound(pvcName: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const pvc = await k8sClient.readNamespacedPersistentVolumeClaim(pvcName, 'web-os');
    if (pvc.status.phase === 'Bound') {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`PVC ${pvcName} did not bind within 30s`);
}
```

**Success Criteria:**
- [ ] Function creates PVC for new wallets
- [ ] Function returns existing PVC if already exists
- [ ] Waits for PVC to bind before returning
- [ ] Unit tests pass

---

### Step 3.2: Update Pod Creation to Use PVC

**Action:** Modify pod creation to mount PVC.

```typescript
// api/src/pods/create.ts (modifications)

async function createPod(wallet: string, model: string): Promise<string> {
  const podId = generatePodId();
  
  // Create PVC for wallet (idempotent)
  await createWorkspacePvc(wallet);
  
  // Create pod with PVC mounted
  const pod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podId,
      namespace: 'web-os',
      labels: {
        app: 'opencode-pod',
        wallet: wallet,
        model: model
      }
    },
    spec: {
      volumes: [
        {
          name: 'workspace',
          persistentVolumeClaim: {
            claimName: `workspace-${wallet}`
          }
        },
        {
          name: 'llm-secret',
          secret: {
            secretName: getLlmSecretName(wallet)
          }
        }
      ],
      containers: [
        {
          name: 'opencode',
          image: 'permaweb/opencode:latest',
          volumeMounts: [
            {
              name: 'workspace',
              mountPath: '/workspace'
            },
            {
              name: 'llm-secret',
              mountPath: '/secrets',
              readOnly: true
            }
          ],
          // ... rest of container spec
        },
        {
          name: 'auth-proxy',
          image: 'permaweb/auth-proxy:latest',
          volumeMounts: [
            {
              name: 'workspace',
              mountPath: '/workspace',
              readOnly: false
            }
          ],
          // ... rest of container spec
        }
      ]
    }
  };
  
  await k8sClient.createNamespacedPod('web-os', pod);
  return podId;
}
```

**Success Criteria:**
- [ ] New pods created with PVC
- [ ] PVC mounted at `/workspace` in both containers
- [ ] LLM secrets still mounted correctly
- [ ] Integration tests pass

---

### Step 3.3: Add Migration Endpoint

**Action:** Create API endpoint to migrate existing pods.

```typescript
// api/src/pods/migrate.ts

router.post('/api/pods/:podId/migrate', async (req, res) => {
  const { podId } = req.params;
  const wallet = req.wallet; // From auth middleware
  
  try {
    // Step 1: Get current pod
    const pod = await k8sClient.readNamespacedPod(podId, 'web-os');
    
    // Step 2: Check if already migrated
    const hasPvc = pod.spec.volumes?.some(v => 
      v.persistentVolumeClaim?.claimName === `workspace-${wallet}`
    );
    
    if (hasPvc) {
      return res.json({ status: 'already-migrated', podId });
    }
    
    // Step 3: Create PVC
    await createWorkspacePvc(wallet);
    
    // Step 4: Copy data from pod to PVC
    // (Use kubectl exec or implement in code)
    
    // Step 5: Delete old pod
    await k8sClient.deleteNamespacedPod(podId, 'web-os');
    
    // Step 6: Create new pod with PVC (will use existing PVC)
    const newPodId = await createPod(wallet, pod.metadata.labels.model);
    
    res.json({ 
      status: 'migrated', 
      oldPodId: podId, 
      newPodId 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**Success Criteria:**
- [ ] Endpoint created
- [ ] Handles already-migrated pods
- [ ] Preserves data during migration
- [ ] Returns new pod ID

---

## Phase 4: Testing

### Step 4.1: Test New Pod Creation with PVC

**Action:** Create new pod and verify PVC is created and mounted.

```bash
# Create new pod via API
curl -X POST https://api.permaweb.run/api/pods \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4"}'

# Check PVC was created
kubectl get pvc -n web-os | grep workspace

# Check pod has PVC mounted
kubectl describe pod <pod-id> -n web-os | grep -A5 "Volumes:"
kubectl describe pod <pod-id> -n web-os | grep -A5 "workspace"
```

**Success Criteria:**
- [ ] PVC created automatically
- [ ] PVC status is `Bound`
- [ ] Pod volumeMounts show `/workspace` -> PVC
- [ ] Pod starts successfully

---

### Step 4.2: Test Data Persistence

**Action:** Write data, delete pod, recreate, verify data.

```bash
POD_ID=<new-pod-id>

# Write test file
kubectl exec $POD_ID -n web-os -c opencode -- sh -c "echo 'persistence-test-$(date)' > /workspace/test.txt"

# Read to verify
kubectl exec $POD_ID -n web-os -c opencode -- cat /workspace/test.txt

# Delete pod
kubectl delete pod $POD_ID -n web-os

# Recreate via API
curl -X POST https://api.permaweb.run/api/pods \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4"}'

# Verify data survived
kubectl exec <new-pod-id> -n web-os -c opencode -- cat /workspace/test.txt
```

**Success Criteria:**
- [ ] Data written successfully
- [ ] Pod deleted and recreated
- [ ] Data persists after recreation
- [ ] File contents match original

---

### Step 4.3: Test Migration of Existing Pod

**Action:** Migrate one existing pod to PVC.

```bash
# Pick an existing pod
POD_ID=$(kubectl get pods -n web-os -l app=opencode-pod --no-headers | head -1 | awk '{print $1}')
WALLET=<wallet-address> # Extract from pod labels

# Run migration script
./scripts/migrate-pod-to-pvc.sh $WALLET $POD_ID

# Verify PVC created
kubectl get pvc workspace-$WALLET -n web-os

# Delete old pod
kubectl delete pod $POD_ID -n web-os

# Recreate via API (will use existing PVC)
curl -X POST https://api.permaweb.run/api/pods \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4"}'

# Verify new pod uses PVC
kubectl describe pod <new-pod-id> -n web-os | grep -A5 "Volumes:"
```

**Success Criteria:**
- [ ] Migration script runs without error
- [ ] PVC created for wallet
- [ ] Data backed up to `/tmp/workspace-$WALLET-backup.tar.gz`
- [ ] New pod mounts PVC
- [ ] User data preserved

---

## Phase 5: Rollout

### Step 5.1: Deploy Updated API

**Action:** Deploy API with PVC support.

```bash
# Build and push new image
cd api
docker build -t permaweb/api:v2-pvc .
docker push permaweb/api:v2-pvc

# Update deployment
kubectl set image deployment/api api=permaweb/api:v2-pvc -n web-os

# Wait for rollout
kubectl rollout status deployment/api -n web-os
```

**Success Criteria:**
- [ ] New API image deployed
- [ ] No errors in API logs
- [ ] Health check passes
- [ ] Existing pods still work (backward compatible)

---

### Step 5.2: Migrate Pods Gradually

**Action:** Migrate pods one by one, verifying each.

```bash
# List all pods
kubectl get pods -n web-os -l app=opencode-pod -o custom-columns=NAME:.metadata.name,WALLET:.metadata.labels.wallet

# For each pod:
# 1. Verify it's working
# 2. Run migration
# 3. Verify new pod works
# 4. Proceed to next

# Migration script
for pod in $(kubectl get pods -n web-os -l app=opencode-pod --no-headers | awk '{print $1}'); do
  wallet=$(kubectl get pod $pod -n web-os -o jsonpath='{.metadata.labels.wallet}')
  
  echo "Migrating $pod (wallet: $wallet)..."
  
  # Skip if already has PVC
  if kubectl get pvc workspace-$wallet -n web-os &>/dev/null; then
    echo "Already migrated, skipping"
    continue
  fi
  
  # Migrate
  ./scripts/migrate-pod-to-pvc.sh $wallet $pod
  
  # Delete and recreate
  kubectl delete pod $pod -n web-os
  
  # Wait for recreation (or trigger via API)
  sleep 30
  
  # Verify new pod
  new_pod=$(kubectl get pods -n web-os -l wallet=$wallet --no-headers | awk '{print $1}')
  kubectl exec $new_pod -n web-os -c opencode -- ls /workspace
  
  echo "Migration of $pod complete"
done
```

**Success Criteria:**
- [ ] All pods migrated successfully
- [ ] All PVCs created and bound
- [ ] All pods running with PVC
- [ ] No user data lost

---

## Phase 6: Enable Scale-to-Zero

### Step 6.1: Install Knative (Future)

**Action:** Install Knative Serving for scale-to-zero.

**Note:** This is documented but not implemented yet. Requires:
- Knative Serving installation
- Knative Serving CRDs
- Configuration for scale-to-zero
- Migration from Deployment to Knative Service

---

## Monitoring

### Ongoing Checks

```bash
# Check PVC usage
kubectl get pvc -n web-os

# Check PVC disk usage
kubectl exec <pod> -n web-os -- df -h /workspace

# Check pod status
kubectl get pods -n web-os -l app=opencode-pod

# Check for pods without PVC (should be 0 after migration)
kubectl get pods -n web-os -o json | jq -r '.items[] | select(.spec.volumes[]?.emptyDir) | .metadata.name'
```

---

## Rollback Plan

If issues arise:

```bash
# 1. Revert API to previous version
kubectl rollout undo deployment/api -n web-os

# 2. For affected pods, recreate without PVC
kubectl delete pod <pod-id> -n web-os
# API will recreate with emptyDir

# 3. Delete PVCs if needed
kubectl delete pvc workspace-<wallet> -n web-os

# 4. Restore from backup if data lost
kubectl cp /tmp/workspace-<wallet>-backup.tar.gz <pod-id>:/tmp/backup.tar.gz
kubectl exec <pod-id> -n web-os -- tar xzf /tmp/backup.tar.gz -C /workspace
```

---

## Cost Impact

| Item | Before | After |
|------|--------|-------|
| Pods (24/7) | $108/mo | $30-50/mo (scaled) |
| PVCs (1GB × N pods) | $0 | $0.10/GB/mo × N |
| **Example: 16 pods** | $108/mo | $32/mo |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| PVC creation success rate | 100% |
| Pod migration success rate | 100% |
| Data loss incidents | 0 |
| API error rate | < 0.1% |
| Pod startup time (with PVC) | < 30s |
| PVC bind time | < 10s |