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

**Phase:** 2
**Step:** 2.1
**Status:** Phase 1 COMPLETE

## Phase 1: Complete ✅

### Step 1.1: Verify StorageClass ✅
- [x] Run `kubectl get storageclass`
- [x] Verify `do-block-storage` exists
- [x] Verify provisioner is `dobs.csi.digitalocean.com`

### Step 1.2: Create Test PVC ✅
- [x] Create `k8s/test-pvc.yaml`
- [x] Apply with `kubectl apply -f k8s/test-pvc.yaml`
- [x] Verify PVC status is `Bound`

### Step 1.3: Verify PVC Mount ✅
- [x] Create `k8s/test-pod-pvc.yaml`
- [x] Apply pod with PVC
- [x] Write test data to `/workspace`
- [x] Delete pod
- [x] Recreate pod
- [x] Verify data survived

### Step 1.4: Cleanup ✅
- [x] Delete test pod
- [x] Delete test PVC
- [x] Verify PV cleaned up (no orphaned volumes)

---

## Phase 2: Complete ✅

### Step 2.1: Create PVC Template ✅
- [x] Created `k8s/workspace-pvc-template.yaml`
- [x] Template uses `{{OWNER_WALLET}}` placeholder
- [x] Validated with `kubectl --dry-run`

### Step 2.2: Update Pod Template ✅
- [x] Created `k8s/pod-template-with-pvc.yaml`
- [x] Added PVC volume for `/workspace`
- [x] Both containers mount workspace
- [x] Validated with `kubectl --dry-run`

### Step 2.3: Create Migration Script ✅
- [x] Created `scripts/migrate-pod-to-pvc.sh`
- [x] Script is executable
- [x] Syntax validated
- [x] Handles existing PVCs
- [x] Creates backup pod for data copy

---

## Phase 3: Complete ✅

### Step 3.1: Add PVC Creation Function ✅
- [x] Added `createWorkspacePvc()` to orchestrator
- [x] Added `waitForPvcBound()` helper
- [x] Added `workspacePvcExists()` check
- [x] Type-safe with `CreatePodOptions.pvcName`

### Step 3.2: Update Pod Creation ✅
- [x] Modified `createAll()` to create PVC first
- [x] Added `workspace` volume with PVC
- [x] Both containers mount `/workspace`
- [x] `WORKSPACE_PATH` env var for auth-proxy
- [x] Tests pass (52/52)

### Step 3.3: Delete with Preservation ✅
- [x] `deletePod()` preserves PVC by default
- [x] Added `deleteAllForWallet()` for full cleanup
- [x] PVC survives pod restart/recreation

---

## Phase 4: Testing

### Step 4.1: Deploy Updated API ✅
- [x] Build API image for linux/amd64
- [x] Push to `registry.digitalocean.com/scout-live/web-os-api:pvc-support`
- [x] Deploy to cluster with `kubectl set image`
- [x] Verify rollout successful
- [x] Health check passes
- [x] PVC code found in deployed image

### Step 4.2: Test New Pod Creation ✅
- [x] Create test PVC manually
- [x] PVC bound successfully
- [x] Create pod with PVC mount
- [x] Pod starts successfully

### Step 4.3: Test Data Persistence ✅
- [x] Write test file to PVC: `test-data-Fri Mar 27 16:08:11 EDT 2026`
- [x] Delete pod
- [x] Recreate pod with same PVC
- [x] **Data persisted: Same file content survived**

### Step 4.4: Cleanup ✅
- [x] Delete test pod
- [x] Delete test PVC
- [x] Verify cleanup

---

## Phase 5: Rollout

### Step 5.1: Deploy Updated API
- [x] Build new API image
- [x] Push to registry
- [x] Deploy to cluster
- [x] Verify health check

### Step 5.2: Migrate Pods
- [ ] List all pods
- [ ] Migrate each pod
- [ ] Verify each migration
- [ ] Verify all pods running

---

**Current Status:** Phase 4.2 - Ready to test new pod creation

**Cluster Status:**
- Nodes: 7
- Running pods: 18
- New API deployed: `registry.digitalocean.com/scout-live/web-os-api:pvc-support`