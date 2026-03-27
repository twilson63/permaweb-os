# PVC Migration Checklist

## Phase 1: PVC Infrastructure Setup

### Step 1.1: Verify StorageClass
- [ ] Run `kubectl get storageclass`
- [ ] Verify `do-block-storage` exists
- [ ] Verify provisioner is `dobs.csi.digitalocean.com`
- [ ] **STOP** until all criteria pass

### Step 1.2: Create Test PVC
- [ ] Create `k8s/test-pvc.yaml`
- [ ] Apply with `kubectl apply -f k8s/test-pvc.yaml`
- [ ] Verify PVC status is `Bound`
- [ ] **STOP** until PVC binds successfully

### Step 1.3: Verify PVC Mount in Test Pod
- [ ] Create `k8s/test-pod-pvc.yaml`
- [ ] Apply with `kubectl apply -f k8s/test-pod-pvc.yaml`
- [ ] Write test data to `/workspace`
- [ ] Delete pod
- [ ] Recreate pod
- [ ] Verify data survived
- [ ] **STOP** until data persistence confirmed

### Step 1.4: Cleanup Test Resources
- [ ] Delete test pod
- [ ] Delete test PVC
- [ ] Verify no orphaned volumes

---

## Phase 2: Update Pod Template

### Step 2.1: Create PVC Template
- [ ] Create `k8s/workspace-pvc-template.yaml`
- [ ] Verify template placeholders

### Step 2.2: Update Pod Template
- [ ] Create `k8s/pod-template-with-pvc.yaml`
- [ ] Validate with `kubectl --dry-run`

### Step 2.3: Create Migration Script
- [ ] Create `scripts/migrate-pod-to-pvc.sh`
- [ ] Make script executable
- [ ] Test script syntax

---

## Phase 3: API Changes

### Step 3.1: Add PVC Creation Function
- [ ] Create `api/src/pods/create-pvc.ts`
- [ ] Add unit tests
- [ ] Verify tests pass

### Step 3.2: Update Pod Creation
- [ ] Modify `api/src/pods/create.ts`
- [ ] Add PVC volume to pod spec
- [ ] Add integration tests
- [ ] Verify tests pass

### Step 3.3: Add Migration Endpoint
- [ ] Create `api/src/pods/migrate.ts`
- [ ] Add endpoint tests
- [ ] Verify tests pass

---

## Phase 4: Testing

### Step 4.1: Test New Pod Creation
- [ ] Create pod via API
- [ ] Verify PVC created
- [ ] Verify PVC bound
- [ ] Verify pod mounts PVC

### Step 4.2: Test Data Persistence
- [ ] Write test file
- [ ] Delete pod
- [ ] Recreate pod
- [ ] Verify data persists

### Step 4.3: Test Migration
- [ ] Run migration script on test pod
- [ ] Verify PVC created
- [ ] Verify data backed up
- [ ] Verify new pod uses PVC

---

## Phase 5: Rollout

### Step 5.1: Deploy Updated API
- [ ] Build new API image
- [ ] Push to registry
- [ ] Deploy to cluster
- [ ] Verify health check

### Step 5.2: Migrate Pods
- [ ] List all pods
- [ ] Migrate each pod
- [ ] Verify each migration
- [ ] Verify all pods running

---

## Phase 6: Scale-to-Zero (Future)

### Step 6.1: Install Knative
- [ ] Install Knative Serving
- [ ] Configure scale-to-zero
- [ ] Test scale down
- [ ] Test scale up (wake)

---

## Current Status

**Phase:** 1
**Step:** 1.1
**Status:** READY TO START

**Next Action:** Run `kubectl get storageclass`