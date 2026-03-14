/**
 * @fileoverview Kubernetes pod orchestrator for creating and managing user pods.
 * @module pods/orchestrator
 */

import { getKubernetesClient, isKubernetesAvailable } from '../kubernetes/client';
import { PodLlmConfig } from './types';

/**
 * Configuration for creating a new pod.
 */
export interface CreatePodOptions {
  podId: string;
  ownerWallet: string;
  llm: PodLlmConfig;
  llmSecretName: string;
  ownerKeyId: string;
  ownerKeySecretName: string;
  model: string;
}

/**
 * Result of pod creation.
 */
export interface CreatePodResult {
  podName: string;
  serviceName: string;
  ingressName: string;
  status: 'pending' | 'running' | 'failed';
  message?: string;
}

/**
 * Pod status from Kubernetes.
 */
export interface PodStatusResult {
  podId: string;
  podName: string;
  status: 'pending' | 'running' | 'failed' | 'unknown';
  phase?: string;
  podIP?: string;
  startTime?: string;
}

/**
 * Kubernetes pod orchestrator.
 * Manages the lifecycle of user pods including creation, status tracking, and deletion.
 */
export class PodOrchestrator {
  private readonly baseDomain: string;
  private readonly namespace: string;

  constructor(options: { baseDomain?: string; namespace?: string } = {}) {
    this.namespace = options.namespace || process.env.NAMESPACE || 'web-os';
    this.baseDomain = options.baseDomain || process.env.POD_BASE_DOMAIN || '165.245.152.77.nip.io';
  }

  /**
   * Creates all Kubernetes resources for a pod (Pod, Service, Ingress).
   */
  async createAll(opts: CreatePodOptions): Promise<CreatePodResult> {
    const podName = `pod-${opts.podId.slice(0, 8)}`;
    const serviceName = podName;
    const ingressName = podName;

    // Check if Kubernetes is available
    if (!isKubernetesAvailable()) {
      console.log('Kubernetes not available, returning mock result');
      return {
        podName,
        serviceName,
        ingressName,
        status: 'pending',
        message: 'Kubernetes not available (development mode)',
      };
    }

    try {
      // Create Pod
      await this.createPod(opts);

      // Create Service
      await this.createService(opts.podId);

      // Create Ingress
      await this.createIngress(opts.podId);

      return { podName, serviceName, ingressName, status: 'pending' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      // Check for specific error types
      if (message.includes('ETIMEDOUT') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
        console.error('Kubernetes API not reachable from pod. This is a known issue with some DigitalOcean Kubernetes configurations.');
        console.error('The internal ClusterIP for the Kubernetes API may not be reachable from pods.');
        console.error('Error:', message);
        
        return {
          podName,
          serviceName,
          ingressName,
          status: 'failed',
          message: 'Kubernetes API not reachable from pod. Contact support to enable internal API access, or use an external orchestrator.',
        };
      }
      
      console.error('Failed to create Kubernetes resources:', message);
      return { podName, serviceName, ingressName, status: 'failed', message };
    }
  }

  /**
   * Creates a Kubernetes Pod.
   */
  async createPod(opts: CreatePodOptions): Promise<void> {
    if (!isKubernetesAvailable()) {
      console.log('Kubernetes not available, skipping pod creation');
      return;
    }

    const { core } = getKubernetesClient();
    const podName = `pod-${opts.podId.slice(0, 8)}`;

    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: podName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/name': 'web-os-user-pod',
          'app.kubernetes.io/part-of': 'web-os',
          'pod-id': opts.podId.slice(0, 8),
          'owner-wallet': opts.ownerWallet,
        },
        annotations: {
          'prometheus.io/scrape': 'true',
          'prometheus.io/port': '3001',
          'prometheus.io/path': '/metrics',
          'owner-key-id': opts.ownerKeyId,
        },
      },
      spec: {
        restartPolicy: 'OnFailure',
        securityContext: {
          runAsUser: 1000,
          runAsGroup: 1000,
          fsGroup: 1000,
          seccompProfile: { type: 'RuntimeDefault' },
        },
        volumes: [
          { name: 'home-opencode', emptyDir: {} },
          { name: 'llm-secrets', secret: { secretName: opts.llmSecretName } },
          { name: 'owner-key', secret: { secretName: opts.ownerKeySecretName } },
        ],
        containers: [
          {
            name: 'opencode',
            image: 'registry.digitalocean.com/scout-live/web-os-opencode:latest',
            imagePullPolicy: 'Always',
            ports: [{ containerPort: 4096, name: 'opencode-http' }],
            env: [
              { name: 'OPENAI_API_KEY', valueFrom: { secretKeyRef: { name: opts.llmSecretName, key: 'openai', optional: true } } },
              { name: 'ANTHROPIC_API_KEY', valueFrom: { secretKeyRef: { name: opts.llmSecretName, key: 'anthropic', optional: true } } },
              { name: 'OPENROUTER_API_KEY', valueFrom: { secretKeyRef: { name: opts.llmSecretName, key: 'openrouter', optional: true } } },
              { name: 'GROQ_API_KEY', valueFrom: { secretKeyRef: { name: opts.llmSecretName, key: 'groq', optional: true } } },
            ],
            volumeMounts: [
              { name: 'home-opencode', mountPath: '/home/opencode' },
              { name: 'llm-secrets', mountPath: '/secrets/llm', readOnly: true },
            ],
            resources: {
              requests: { cpu: '250m', memory: '512Mi' },
              limits: { cpu: '1', memory: '2Gi' },
            },
          },
          {
            name: 'httpsig-sidecar',
            image: 'registry.digitalocean.com/scout-live/web-os-sidecar:latest',
            imagePullPolicy: 'Always',
            ports: [{ containerPort: 3001, name: 'httpsig-http' }],
            env: [
              { name: 'PORT', value: '3001' },
              { name: 'OWNER_KEY_ID', valueFrom: { fieldRef: { fieldPath: "metadata.annotations['owner-key-id']" } } },
              { name: 'OWNER_PUBLIC_KEY_PEM_FILE', value: '/secrets/owner/public-key.pem' },
            ],
            volumeMounts: [
              { name: 'owner-key', mountPath: '/secrets/owner', readOnly: true },
            ],
            resources: {
              requests: { cpu: '100m', memory: '128Mi' },
              limits: { cpu: '500m', memory: '512Mi' },
            },
          },
        ],
      },
    };

    await core.createNamespacedPod({ namespace: this.namespace, body: pod });
  }

  /**
   * Creates a Kubernetes Service for the pod.
   */
  async createService(podId: string): Promise<void> {
    if (!isKubernetesAvailable()) {
      return;
    }

    const { core } = getKubernetesClient();
    const serviceName = `pod-${podId.slice(0, 8)}`;

    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: serviceName,
        namespace: this.namespace,
      },
      spec: {
        selector: { 'pod-id': podId.slice(0, 8) },
        ports: [
          { name: 'opencode-http', port: 4096, targetPort: 4096 },
          { name: 'httpsig-http', port: 3001, targetPort: 3001 },
        ],
      },
    };

    await core.createNamespacedService({ namespace: this.namespace, body: service });
  }

  /**
   * Creates a Kubernetes Ingress for the pod.
   */
  async createIngress(podId: string): Promise<void> {
    if (!isKubernetesAvailable()) {
      return;
    }

    const { networking } = getKubernetesClient();
    const ingressName = `pod-${podId.slice(0, 8)}`;
    const host = `${podId.slice(0, 8)}.${this.baseDomain}`;

    const ingress = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: ingressName,
        namespace: this.namespace,
      },
      spec: {
        ingressClassName: 'nginx',
        tls: [{ hosts: [host], secretName: 'web-os-tls' }],
        rules: [{
          host,
          http: {
            paths: [{
              path: '/',
              pathType: 'Prefix',
              backend: {
                service: { name: ingressName, port: { name: 'opencode-http' } },
              },
            }],
          },
        }],
      },
    };

    await networking.createNamespacedIngress({ namespace: this.namespace, body: ingress });
  }

  /**
   * Gets the status of a pod from Kubernetes.
   */
  async getPodStatus(podId: string): Promise<PodStatusResult | null> {
    if (!isKubernetesAvailable()) {
      return null;
    }

    const podName = `pod-${podId.slice(0, 8)}`;

    try {
      const { core } = getKubernetesClient();
      const pod = await core.readNamespacedPod({ name: podName, namespace: this.namespace });

      return {
        podId,
        podName,
        status: this.mapPhaseToStatus(pod.status?.phase),
        phase: pod.status?.phase,
        podIP: pod.status?.podIP,
        startTime: pod.status?.startTime?.toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Deletes a pod and its associated resources.
   */
  async deletePod(podId: string): Promise<void> {
    if (!isKubernetesAvailable()) {
      return;
    }

    const podName = `pod-${podId.slice(0, 8)}`;

    try {
      const { core, networking } = getKubernetesClient();

      // Delete Ingress
      try {
        await networking.deleteNamespacedIngress({ name: podName, namespace: this.namespace });
      } catch { /* ignore */ }

      // Delete Service
      try {
        await core.deleteNamespacedService({ name: podName, namespace: this.namespace });
      } catch { /* ignore */ }

      // Delete Pod
      try {
        await core.deleteNamespacedPod({ name: podName, namespace: this.namespace });
      } catch { /* ignore */ }
    } catch (error: unknown) {
      console.error('Failed to delete pod:', error);
    }
  }

  /**
   * Waits for a pod to be ready.
   */
  async waitForPodReady(podId: string, timeoutMs: number = 60000): Promise<boolean> {
    if (!isKubernetesAvailable()) {
      return true; // In dev mode, assume ready
    }

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getPodStatus(podId);
      if (status?.status === 'running') {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return false;
  }

  /**
   * Maps Kubernetes pod phase to our status.
   */
  private mapPhaseToStatus(phase?: string): 'pending' | 'running' | 'failed' | 'unknown' {
    switch (phase) {
      case 'Pending': return 'pending';
      case 'Running': return 'running';
      case 'Failed':
      case 'Unknown': return 'failed';
      default: return 'unknown';
    }
  }
}

// Export singleton instance
let orchestratorInstance: PodOrchestrator | null = null;

export function getPodOrchestrator(): PodOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new PodOrchestrator();
  }
  return orchestratorInstance;
}

export function resetPodOrchestrator(): void {
  orchestratorInstance = null;
}