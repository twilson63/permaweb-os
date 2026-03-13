# Cost Analysis - Permaweb OS Production Deployment

## Resource Requirements Summary

### User Pod Resources (per pod)
From `k8s/pod-template.yaml`:

| Container | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-----------|-------------|-----------|----------------|--------------|
| OpenCode | 250m | 1000m (1) | 512Mi | 2Gi |
| HTTPSig Sidecar | 100m | 500m | 128Mi | 512Mi |
| **Total** | **350m** | **1500m (1.5)** | **640Mi** | **2.5Gi** |

### API Pod Resources
From `k8s/api-deployment.yaml`:

| Container | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-----------|-------------|-----------|----------------|--------------|
| API | 100m | 500m | 128Mi | 512Mi |

### System Pod Overhead
Kubernetes clusters require system pods that consume node resources:

| Component | CPU Request | Memory Request | Notes |
|-----------|-------------|----------------|-------|
| CoreDNS (x2) | 200m | 140Mi | HA deployment |
| metrics-server | 50m | 50Mi | Resource metrics |
| csi-do-plugin | 100m | 100Mi | DigitalOcean CSI |
| do-node-termination | 10m | 20Mi | Graceful shutdown |
| CNI (calico/cilium) | 150m | 150Mi | Network plugin |
| kube-proxy | 50m | 50Mi | Service routing |
| **Total System** | **~560m** | **~510Mi** | Per node |

---

## DigitalOcean Node Types Analysis

### Node Types Comparison

| Tier | vCPU | RAM | Monthly Cost | Allocatable CPU | Allocatable RAM | System Overhead | Usable CPU | Usable RAM |
|------|------|-----|--------------|-----------------|-----------------|-----------------|------------|------------|
| s-2vcpu-4gb | 2 | 4Gi | $24 | ~1.8 | ~3.5Gi | 0.56/0.5Gi | ~1.24 | ~3Gi |
| s-4vcpu-8gb | 4 | 8Gi | $48 | ~3.6 | ~7Gi | 0.56/0.5Gi | ~3.04 | ~6.5Gi |
| s-6vcpu-16gb | 6 | 16Gi | $96 | ~5.4 | ~14Gi | 0.56/0.5Gi | ~4.84 | ~13.5Gi |
| g-2vcpu-8gb | 2 | 8Gi | $48 | ~1.8 | ~7Gi | 0.56/0.5Gi | ~1.24 | ~6.5Gi |
| g-4vcpu-16gb | 4 | 16Gi | $96 | ~3.6 | ~14Gi | 0.56/0.5Gi | ~3.04 | ~13.5Gi |
| g-8vcpu-32gb | 8 | 32Gi | $192 | ~7.2 | ~28Gi | 0.56/0.5Gi | ~6.64 | ~27.5Gi |
| c-2vcpu-4gb | 2 | 4Gi | $36 | ~1.9 | ~3.5Gi | 0.30/0.5Gi | ~1.60 | ~3Gi |
| c-4vcpu-8gb | 4 | 8Gi | $72 | ~3.8 | ~7Gi | 0.30/0.5Gi | ~3.50 | ~6.5Gi |
| c-8vcpu-16gb | 8 | 16Gi | $144 | ~7.6 | ~14Gi | 0.30/0.5Gi | ~7.30 | ~13.5Gi |
| m-2vcpu-16gb | 2 | 16Gi | $96 | ~1.8 | ~14Gi | 0.30/0.5Gi | ~1.50 | ~13.5Gi |
| m-4vcpu-32gb | 4 | 32Gi | $192 | ~3.6 | ~28Gi | 0.30/0.5Gi | ~3.30 | ~27.5Gi |

### Pod Density by Node Type

Calculating maximum user pods per node (request-based scheduling):

| Tier | Usable CPU | Usable RAM | CPU-Limited Pods | RAM-Limited Pods | **Max Pods** | Cost/Pod |
|------|------------|------------|------------------|------------------|--------------|----------|
| s-2vcpu-4gb | 1.24 | 3Gi | 3.5 → 3 | 4.7 → 4 | **3** | $8.00 |
| s-4vcpu-8gb | 3.04 | 6.5Gi | 8.7 → 8 | 10.2 → 10 | **8** | $6.00 |
| s-6vcpu-16gb | 4.84 | 13.5Gi | 13.8 → 13 | 21.1 → 21 | **13** | $7.38 |
| g-2vcpu-8gb | 1.24 | 6.5Gi | 3.5 → 3 | 10.2 → 10 | **3** | $16.00 |
| g-4vcpu-16gb | 3.04 | 13.5Gi | 8.7 → 8 | 21.1 → 21 | **8** | $12.00 |
| g-8vcpu-32gb | 6.64 | 27.5Gi | 19.0 → 19 | 43.0 → 43 | **19** | $10.11 |
| c-2vcpu-4gb | 1.60 | 3Gi | 4.6 → 4 | 4.7 → 4 | **4** | $9.00 |
| c-4vcpu-8gb | 3.50 | 6.5Gi | 10.0 → 10 | 10.2 → 10 | **10** | $7.20 |
| c-8vcpu-16gb | 7.30 | 13.5Gi | 20.9 → 20 | 21.1 → 21 | **20** | $7.20 |
| m-2vcpu-16gb | 1.50 | 13.5Gi | 4.3 → 4 | 21.1 → 21 | **4** | $24.00 |
| m-4vcpu-32gb | 3.30 | 27.5Gi | 9.4 → 9 | 43.0 → 43 | **9** | $21.33 |

### Recommended Node Types

**Best Value (Cost/Pod):**
1. **s-4vcpu-8gb** - $6.00/pod - Budget option for development
2. **c-4vcpu-8gb** - $7.20/pod - Balanced CPU/memory, dedicated cores
3. **c-8vcpu-16gb** - $7.20/pod - High density, best for production

**Production Recommendation:**
- **CPU-Optimized nodes** offer the best balance of predictable performance and cost efficiency
- Dedicated CPU cores prevent noisy neighbor issues in multi-tenant workloads
- Memory-optimized nodes are NOT recommended (OpenCode is CPU-bound, not memory-bound)

---

## Cost Model

### Per-User Pod Costs

#### Active User Pod (Running OpenCode)
| Cost Component | Calculation | Monthly Cost |
|----------------|-------------|--------------|
| Base pod resources | 350m CPU, 640Mi RAM | Included in node |
| Node share (c-4vcpu-8gb) | $72 / 10 pods | $7.20 |
| LLM API calls | Variable (usage-based) | $0-$50/user |
| **Subtotal (node)** | | **$7.20/user** |

#### Idle Pod (Scaled Down)
When idle, pods can be scaled to minimal resources or terminated entirely:

| Strategy | Resource Reduction | Monthly Cost |
|----------|-------------------|--------------|
| Terminate pod | 0 resources | $0.00 |
| Scale to minimum | 50m CPU, 128Mi | ~$1.50/pod spot |
| Keep running | Full resources | $7.20/pod |

**Recommended:** Terminate idle pods after inactivity timeout (configurable in API).

### API Cluster Costs (Fixed Overhead)

| Component | Nodes | Monthly Cost |
|-----------|-------|--------------|
| API Deployment (HA) | 2 replicas | Included |
| Load Balancer | 1 | $12.00 |
| Container Registry | Basic | $5.00 |
| DNS Management | DO DNS | Free |
| **Fixed Monthly** | | **$17.00** |

### Total Deployment Cost by Scale

| Scale | Nodes | Type | API Pods | User Capacity | Monthly Cost |
|-------|-------|------|----------|---------------|--------------|
| Development | 1 | s-4vcpu-8gb | 2 | 6 | $60 |
| Small (10 users) | 2 | c-4vcpu-8gb | 2 | 18 | $161 |
| Medium (100 users) | 5 | c-8vcpu-16gb | 3 | 97 | $757 |
| Large (1000 users) | 15 | c-8vcpu-16gb | 5 | 295 | $2,197 |

### Network/Egress Costs

DigitalOcean provides:
- **Inbound transfer:** Free
- **Outbound transfer:** First 1TB free per account
- **Additional egress:** $0.01/GB

Estimate per active user pod:
- WebSocket keepalive: ~10KB/min = ~430MB/month (negligible)
- API requests: ~100MB/month typical usage
- **Total egress per active user:** ~500MB/month

For 1000 users: ~500GB/month - well within free tier.

### Storage Costs

OpenCode uses `emptyDir` for home directory - no persistent storage required.

| Storage Type | Use Case | Cost |
|--------------|----------|------|
| emptyDir | User session (ephemeral) | $0 |
| Persistent Volume | Long-term data | $0.10/GB/mo |

**Recommended:** Use ephemeral storage only. User data synced to external services (GitHub, etc.).

---

## Cost Optimization Strategies

### 1. Spot/Preemptible Instances
DigitalOcean does not offer spot instances. Consider:
- Reserved capacity (volume discounts for committed usage)
- Contact DO sales for enterprise pricing

### 2. Autoscaling Efficiency
- Use HPA to scale API pods (already configured: min=2, max=10)
- Implement pod lifecycle management for user pods
- Scale down idle pods aggressively

### 3. Resource Right-Sizing
Current pod requests may be conservative:
- OpenCode typical usage: 100-500m CPU, 256-512Mi RAM
- HTTPSig sidecar: <50m CPU, <64Mi RAM typical
- Consider adjusting requests based on actual usage metrics

### 4. Cluster Autoscaling
Install cluster-autoscaler for automatic node scaling:
```bash
# Cluster will scale between min/max nodes based on pending pods
# Recommended: min=3, max=50 for production
```

### 5. Namespace Resource Quotas
Prevent runaway resource usage:
```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: user-pods-quota
  namespace: web-os
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 40Gi
    pods: "50"
```

---

## Cost Projection Examples

### Scenario 1: Startup (10-50 users)
- **Node pool:** 2x c-4vcpu-8gb ($144/mo)
- **API:** 2 replicas (included in node pool)
- **Load balancer + registry:** $17/mo
- **User capacity:** 18 concurrent pods
- **Monthly:** $161/mo
- **Per active user:** $16.10 (at 10 users) → $3.22 (at 50 users)

### Scenario 2: Growth (100-500 users)
- **Node pool:** 5x c-8vcpu-16gb ($720/mo)
- **API:** 3 replicas (included)
- **Load balancer + registry:** $17/mo
- **User capacity:** 97 concurrent pods
- **Monthly:** $757/mo
- **Per active user:** $7.57 (at 100 users) → $1.51 (at 500 users)

### Scenario 3: Scale (1000+ users)
- **Node pool:** 15x c-8vcpu-16gb ($2,160/mo)
- **API:** 5 replicas (included)
- **Load balancer + registry:** $17/mo
- **User capacity:** 295 concurrent pods
- **Monthly:** $2,197/mo
- **Per active user:** $2.20 (at 1000 users)

---

## Summary

| Metric | Value |
|--------|-------|
| **Cost per active user pod** | $7.20 (CPU-optimized nodes) |
| **Cost per idle pod** | $0 (terminated) or $1.50 (scaled down) |
| **Fixed monthly overhead** | $17 (LB + registry) |
| **Recommended node type** | c-4vcpu-8gb or c-8vcpu-16gb |
| **Optimal pod density** | 10-20 pods per node |
| **Break-even point** | ~3 users per node |

**Key Insight:** OpenCode is CPU-bound. Memory-optimized nodes are poor value. CPU-optimized nodes provide the best cost-per-pod ratio with predictable performance.