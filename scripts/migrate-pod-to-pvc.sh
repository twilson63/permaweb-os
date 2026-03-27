#!/bin/bash
# migrate-pod-to-pvc.sh
# Migrates an existing pod to use a PersistentVolumeClaim for workspace data
# This preserves user data when pods are scaled down or restarted

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Usage
usage() {
  echo "Usage: $0 <wallet-address> <pod-id>"
  echo ""
  echo "Arguments:"
  echo "  wallet-address  The owner's wallet address (used for PVC naming)"
  echo "  pod-id          The pod ID to migrate"
  echo ""
  echo "Example:"
  echo "  $0 abc123def456... pod-1234abcd"
  exit 1
}

# Check arguments
if [ -z "$1" ] || [ -z "$2" ]; then
  usage
fi

WALLET=$1
POD_ID=$2
PVC_NAME="workspace-$WALLET"
NAMESPACE="web-os"

echo -e "${GREEN}=== Migrating pod $POD_ID for wallet $WALLET ===${NC}"
echo ""

# Step 1: Verify pod exists
echo -e "${YELLOW}Step 1: Verifying pod exists...${NC}"
if ! kubectl get pod "$POD_ID" -n "$NAMESPACE" &>/dev/null; then
  echo -e "${RED}ERROR: Pod $POD_ID not found in namespace $NAMESPACE${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Pod found${NC}"
echo ""

# Step 2: Check if pod already uses PVC
echo -e "${YELLOW}Step 2: Checking current pod configuration...${NC}"
if kubectl get pod "$POD_ID" -n "$NAMESPACE" -o json | jq -e '.spec.volumes[]?.persistentVolumeClaim?.claimName' | grep -q "workspace-"; then
  echo -e "${GREEN}✓ Pod already uses PVC, no migration needed${NC}"
  exit 0
fi
echo -e "${GREEN}✓ Pod uses emptyDir, migration needed${NC}"
echo ""

# Step 3: Check if PVC already exists
echo -e "${YELLOW}Step 3: Checking for existing PVC...${NC}"
if kubectl get pvc "$PVC_NAME" -n "$NAMESPACE" &>/dev/null; then
  echo -e "${GREEN}✓ PVC $PVC_NAME already exists${NC}"
else
  echo -e "${YELLOW}Creating PVC...${NC}"

  # Get storage class
  STORAGE_CLASS="do-block-storage"

  # Create PVC
  cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: $PVC_NAME
  namespace: $NAMESPACE
  labels:
    app.kubernetes.io/name: web-os-workspace
    app.kubernetes.io/part-of: web-os
    owner-wallet: "$WALLET"
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: $STORAGE_CLASS
EOF

  # Wait for PVC to bind
  echo -e "${YELLOW}Waiting for PVC to bind...${NC}"
  kubectl wait --for=condition=bound pvc/"$PVC_NAME" -n "$NAMESPACE" --timeout=60s
  echo -e "${GREEN}✓ PVC bound successfully${NC}"
fi
echo ""

# Step 4: Create backup pod to copy data
echo -e "${YELLOW}Step 4: Creating backup pod with PVC...${NC}"
BACKUP_POD="${POD_ID}-backup"

# Get the original pod's image
OPENCODE_IMAGE=$(kubectl get pod "$POD_ID" -n "$NAMESPACE" -o jsonpath='{.spec.containers[0].image}')

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: $BACKUP_POD
  namespace: $NAMESPACE
spec:
  restartPolicy: Never
  containers:
  - name: backup
    image: busybox
    command: ['sleep', '300']
    volumeMounts:
    - name: workspace
      mountPath: /data
  volumes:
  - name: workspace
    persistentVolumeClaim:
      claimName: $PVC_NAME
EOF

# Wait for backup pod to be ready
echo -e "${YELLOW}Waiting for backup pod...${NC}"
kubectl wait --for=condition=ready pod/"$BACKUP_POD" -n "$NAMESPACE" --timeout=60s
echo -e "${GREEN}✓ Backup pod ready${NC}"
echo ""

# Step 5: Copy data from source pod to PVC
echo -e "${YELLOW}Step 5: Copying workspace data to PVC...${NC}"

# Check if source pod has /workspace
if kubectl exec "$POD_ID" -n "$NAMESPACE" -c opencode -- ls /workspace &>/dev/null; then
  echo "Found /workspace, copying..."

  # Copy to backup pod via tar pipe
  kubectl exec "$POD_ID" -n "$NAMESPACE" -c opencode -- tar czf - -C /workspace . 2>/dev/null | \
    kubectl exec -i "$BACKUP_POD" -n "$NAMESPACE" -- tar xzf - -C /data

  echo -e "${GREEN}✓ Workspace data copied to PVC${NC}"
else
  echo -e "${YELLOW}No /workspace found, creating empty PVC${NC}"
  kubectl exec "$BACKUP_POD" -n "$NAMESPACE" -- mkdir -p /data
fi
echo ""

# Step 6: Verify data copied
echo -e "${YELLOW}Step 6: Verifying data on PVC...${NC}"
FILES=$(kubectl exec "$BACKUP_POD" -n "$NAMESPACE" -- find /data -type f | wc -l | tr -d ' ')
echo -e "${GREEN}✓ PVC contains $FILES files${NC}"
echo ""

# Step 7: Cleanup backup pod
echo -e "${YELLOW}Step 7: Cleaning up backup pod...${NC}"
kubectl delete pod "$BACKUP_POD" -n "$NAMESPACE"
echo -e "${GREEN}✓ Backup pod deleted${NC}"
echo ""

# Step 8: Instructions for completing migration
echo -e "${GREEN}=== Migration preparation complete ===${NC}"
echo ""
echo "PVC Created: $PVC_NAME"
echo "Data Copied: $FILES files"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Delete old pod:"
echo "   kubectl delete pod $POD_ID -n $NAMESPACE"
echo ""
echo "2. Recreate pod with PVC (API will use new template):"
echo "   curl -X POST https://api.permaweb.run/api/pods -H \"Authorization: Bearer \$TOKEN\""
echo ""
echo "The new pod will use PVC: $PVC_NAME"
echo -e "${YELLOW}Data will persist across pod restarts.${NC}"