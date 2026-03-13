# Scaling Strategy - Permaweb OS

## Overview

This document outlines the scaling strategy for Permaweb OS on DigitalOcean Kubernetes. The platform scales at multiple levels:

1. **Vertical Scaling** - Upgrading node sizes
2. **Horizontal Scaling** - Adding more nodes
3. **Pod Autoscaling** - HPA for API pods, dynamic user pod management
4. **Cost Optimization** - Spot instances, reserved capacity, right-sizing

---

## Part 1: Vertical Scaling

### When to Upgrade Node Sizes

Vertical scaling involves upgrading to larger node types within the same family. This is appropriate when:

1. **Single pod resource needs increase** - If OpenCode requires more CPU/memory than current nodes can provide
2. **Oversubscription becomes problematic** - CPU throttling or memory pressure on existing nodes
3. **Performance degradation** - Latency increases due to resource contention

#### Node Upgrade Paths

**Basic Tier → CPU-Optimized:**
```
s-4vcpu-8gb ($48/mo, 8 pods) → c-4vcpu-8gb ($72/mo, 10 pods)
```
- Better CPU performance (dedicated cores)
- Only 50% cost increase for 25% more pods
- Reduced noisy neighbor effects

**CPU-Optimized Vertical Scale:**
```
c-4vcpu-8gb ($72/mo, 10 pods) → c-8vcpu-16gb ($144/mo, 20 pods)
```
- Doubles capacity while maintaining same cost/pod ($7.20)
- Better bin-packing efficiency
- Fewer nodes to manage

#### Vertical Scaling Triggers

| Metric | Threshold | Action |
|--------|-----------|--------|
| Node CPU utilization | >85% sustained | Upgrade to larger nodes |
| Node memory pressure | >90% sustained | Consider memory-optimized tier |
| Pod scheduling failures | >5% pending | Add nodes (horizontal) OR upgrade |
| P99 latency increase | >500ms | Investigate resource contention |

### Vertical Scaling Process

```bash
# Create new node pool with larger instance type
doctl kubernetes cluster node-pool create web-os \
  --name larger-pool \
  --size c-8vcpu-16gb \
  --count 3

# Cordon old nodes (prevent new scheduling)
kubectl cordon -l doks.digitalocean.com/node-pool=old-pool

# Drain pods from old nodes
kubectl drain -l doks.digitalocean.com/node-pool=old-pool --ignore-daemonsets --delete-emptydir-data

# Delete old node pool
doctl kubernetes cluster node-pool delete web-os old-pool-id
```

---

## Part 2: Horizontal Scaling

### When to Add Nodes

Horizontal scaling (adding more nodes) is preferred when:

1. **Pod count exceeds node capacity** - More concurrent users than nodes can handle
2. **High availability requirements** - Need redundancy across availability zones
3. **Burst capacity** - Temporary spikes in demand
4. **Zone distribution** - Geographic distribution for latency

#### Node Count Recommendations

| Concurrent Users | Min Nodes | Max Nodes | Node Type | Rationale |
|------------------|-----------|-----------|-----------|-----------|
| 1-10 | 2 | 5 | c-4vcpu-8gb | Development + HA |
| 11-50 | 3 | 10 | c-4vcpu-8gb | Small production |
| 51-200 | 5 | 15 | c-8vcpu-16gb | Medium production |
| 201-500 | 10 | 30 | c-8vcpu-16gb | Growth stage |
| 501+ | 15 | 50+ | c-8vcpu-16gb | Scale stage |

#### HA Considerations

- **Minimum 2 nodes** for any production deployment (control plane HA)
- **Spread across availability zones** for critical workloads
- **Cluster Autoscaler** handles dynamic scaling within min/max bounds

### Horizontal Scaling with Cluster Autoscaler

```bash
# Install cluster-autoscaler
helm repo add autoscaler https://kubernetes.github.io/autoscaler
helm install cluster-autoscaler autoscaler/cluster-autoscaler \
  --namespace kube-system \
  --set autoDiscovery.clusterName=web-os \
  --set awsRegion=nyc1 \
  --set extraArgs.scan-interval=30s \
  --set extraArgs.scale-down-delay-after-add=5m \
  --set extraArgs.scale-down-unneeded-time=10m

# Configure node pool autoscaling
doctl kubernetes cluster node-pool update web-os pool-id \
  --auto-scale \
  --min-nodes 3 \
  --max-nodes 20
```

#### Scaling Policies

```yaml
# Cluster Autoscaler configuration
--scale-down-unneeded-time=10m        # Wait 10m before scaling down
--scale-down-delay-after-add=5m       # Wait 5m after adding before scaling down
--scale-down-delay-after-failure=3m  # Wait 3m after failure before retry
--max-node-provision-time=15m        # Max time to provision new node
--unhealthy-node-timeout=5m          # Time before unhealthy node replacement
```

---

## Part 3: Pod Autoscaling

### API Deployment HPA

The API deployment uses HorizontalPodAutoscaler (already configured in `k8s/api-hpa.yaml`):

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: web-os
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

#### HPA Thresholds Explained

| Metric | Threshold | Behavior |
|--------|-----------|----------|
| CPU > 70% | Scale up | Add API pods (up to max) |
| Memory > 80% | Scale up | Add API pods (up to max) |
| Scale up stabilization | 60s | Prevent rapid fluctuation |
| Scale down stabilization | 300s (5m) | Prevent thrashing |

#### HPA Tuning Guidelines

1. **Too aggressive scaling** (CPU > 50%):
   - Benefits: Faster response to load
   - Drawbacks: More pods, higher cost, potential thrashing

2. **Too conservative scaling** (CPU > 90%):
   - Benefits: Lower cost, fewer pods
   - Drawbacks: Performance degradation before scaling

3. **Recommended**: Start with 70% CPU, tune based on P99 latency

### User Pod Lifecycle

User pods are NOT managed by HPA (they're dynamically created per user). Instead, implement:

```yaml
# User pod lifecycle policy
apiVersion: v1
kind: ConfigMap
metadata:
  name: user-pod-lifecycle
  namespace: web-os
data:
  IDLE_TIMEOUT: "1800"      # 30 minutes
  MAX_LIFETIME: "28800"     # 8 hours
  CLEANUP_INTERVAL: "300"   # 5 minutes
```

#### User Pod Scaling Strategy

| State | Resources | Behavior |
|-------|-----------|----------|
| Active | Full (350m CPU, 640Mi) | Normal operation |
| Idle (30m) | Terminated | Pod deleted, session ended |
| Peak load | Queue | Users wait for available capacity |

### Vertical Pod Autoscaler (Optional)

For OpenCode workloads with variable resource needs:

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: opencode-vpa
  namespace: web-os
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  updatePolicy:
    updateMode: "Auto"
  resourcePolicy:
    containerPolicies:
      - containerName: api
        minAllowed:
          cpu: 100m
          memory: 128Mi
        maxAllowed:
          cpu: 500m
          memory: 512Mi
```

**Note:** VPA for user pods requires dynamic template modification - not recommended for MVP.

---

## Part 4: Cost Optimization

### Strategy 1: Right-Sizing Pod Requests

Current requests are conservative. Analyze actual usage:

```bash
# Get actual resource usage
kubectl top pods -n web-os

# Get detailed metrics
kubectl get --raw /apis/metrics.k8s.io/v1beta1/namespaces/web-os/pods
```

#### Recommendations

| Container | Current Request | Typical Usage | Recommended |
|-----------|-----------------|---------------|-------------|
| OpenCode | 250m CPU, 512Mi | 100-200m, 256-512Mi | 200m, 384Mi |
| HTTPSig | 100m CPU, 128Mi | 10-30m, 32-64Mi | 50m, 64Mi |
| API | 100m CPU, 128Mi | 50-100m, 64-128Mi | 75m, 96Mi |

**Potential savings:** 25-30% reduction in resource requests → more pods per node.

### Strategy 2: Pod Priority and Preemption

Ensure critical workloads stay running during resource pressure:

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: web-os-critical
value: 1000000
globalDefault: false
description: "Critical system pods"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: web-os-high
value: 100000
globalDefault: false
description: "High priority user pods"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: web-os-normal
value: 10000
globalDefault: true
description: "Normal priority user pods"
```

### Strategy 3: Resource Quotas

Prevent resource exhaustion and ensure fair scheduling:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: web-os-quota
  namespace: web-os
spec:
  hard:
    requests.cpu: "50"      # Total CPU across all pods
    requests.memory: 100Gi  # Total memory
    limits.cpu: "100"        # Total CPU limits
    limits.memory: 200Gi    # Total memory limits
    pods: "100"             # Maximum pods
```

### Strategy 4: Budget Alerts

Set up billing alerts to catch cost overruns:

```bash
# DigitalOcean billing alerts (via doctl or UI)
doctl account balance

# Kubernetes cost monitoring
kubectl create namespace monitoring
helm install cost-analyzer cost-analyzer/cost-analyzer \
  --namespace monitoring
```

### Strategy 5: Reserved Capacity (Enterprise)

For predictable workloads, consider:

1. **Volume Discounts** - Contact DigitalOcean sales for committed usage
2. **Annual Plans** - Prepay for 12+ months for discounts
3. **Enterprise Agreement** - Custom pricing for large deployments

---

## Part 5: Scaling Decision Matrix

### Quick Reference

| Signal | Action | Automation |
|--------|--------|------------|
| CPU > 70% sustained | Scale up API pods | HPA (automatic) |
| API pods at max (10) | Scale up nodes | Cluster Autoscaler |
| Node pool at max | Add more nodes | Manual + alert |
| Memory pressure > 90% | Upgrade node size | Manual + alert |
| Pending pods > 0 for 5m | Add nodes | Cluster Autoscaler |
| <50% capacity for 30m | Scale down nodes | Cluster Autoscaler |
| Pod idle > 30m | Terminate pod | API logic |

### Monitoring Thresholds

```yaml
# Prometheus alerting rules
groups:
  - name: scaling-alerts
    rules:
      - alert: HighCPUUtilization
        expr: avg(rate(container_cpu_usage_seconds_total{namespace="web-os"}[5m])) > 0.7
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU utilization - consider scaling"
      
      - alert: HighMemoryUtilization
        expr: avg(container_memory_usage_bytes{namespace="web-os"}) / avg(container_spec_memory_limit_bytes{namespace="web-os"}) > 0.8
        for: 5m
        labels:
          severity: warning
      
      - alert: PendingPods
        expr: sum(kube_pod_status_phase{phase="Pending", namespace="web-os"}) > 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Pods pending - cluster needs more capacity"
      
      - alert: NodeCapacityExhaustion
        expr: sum(kube_node_status_capacity_pods) - sum(kube_node_status_allocatable_pods) < 5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Node capacity running low"
```

---

## Part 6: Implementation Checklist

### Initial Deployment

- [ ] Create cluster with 3 nodes (c-4vcpu-8gb recommended)
- [ ] Set up HPA for API (already configured)
- [ ] Configure resource quotas
- [ ] Set up monitoring (Prometheus/Grafana)
- [ ] Create scaling alerts

### Scaling Up

- [ ] Monitor resource utilization for 1 week
- [ ] Analyze actual vs requested resources
- [ ] Right-size pod requests if needed
- [ ] Add nodes when pending pods appear
- [ ] Update min/max in cluster autoscaler

### Cost Optimization

- [ ] Review pod requests monthly
- [ ] Set up billing alerts
- [ ] Analyze cost per user monthly
- [ ] Consider reserved capacity for stable workloads

---

## Summary

| Level | Trigger | Action | Automation |
|-------|---------|--------|------------|
| Pod | CPU/Memory > threshold | Scale API pods (2-10) | HPA |
| Node | Pending pods, capacity | Add/remove nodes (3-50) | Cluster Autoscaler |
| Vertical | Performance issues | Upgrade node size | Manual |
| Cost | Monthly review | Right-size, reserved | Manual |

The recommended approach is:
1. Start with CPU-optimized nodes (c-4vcpu-8gb)
2. Enable HPA for API (already done)
3. Install Cluster Autoscaler for nodes
4. Monitor and adjust based on actual usage
5. Upgrade node size only when needed for single-pod performance