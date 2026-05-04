/**
 * @fileoverview Kubernetes pod orchestrator for creating and managing user pods.
 * @module pods/orchestrator
 */

import { getKubernetesClient, isKubernetesAvailable } from '../kubernetes/client';
import { PodLlmConfig, WorkspaceSkill } from './types';
import { normalizeWalletAddress } from './secret-naming';
import { createHash } from 'crypto';

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
  ownerPublicKey: string;  // Public key PEM for HTTPSig verification
  model: string;
  pvcName?: string;  // Optional: PVC name for workspace (auto-generated if not provided)
  skills?: WorkspaceSkill[];
  skillsConfigMapName?: string;
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
   * Gets the PVC name for a pod.
   * Uses pod ID for uniqueness - one PVC per pod.
   */
  private getWorkspacePvcName(podId: string): string {
    return `workspace-${podId.slice(0, 16)}`;
  }

  private getWorkspaceSkillsConfigMapName(podId: string): string {
    return `pod-${podId.slice(0, 8)}-skills`;
  }

  /**
   * Creates a PersistentVolumeClaim for user workspace data.
   * One PVC per pod - fresh workspace for each pod creation.
   */
  async createWorkspacePvc(podId: string): Promise<string> {
    if (!isKubernetesAvailable()) {
      console.log('Kubernetes not available, skipping PVC creation');
      return this.getWorkspacePvcName(podId);
    }

    const { core } = getKubernetesClient();
    const pvcName = this.getWorkspacePvcName(podId);

    // Check if PVC already exists
    try {
      await core.readNamespacedPersistentVolumeClaim({ namespace: this.namespace, name: pvcName });
      console.log(`PVC ${pvcName} already exists, skipping creation`);
      return pvcName;
    } catch {
      // PVC doesn't exist, create it
    }

    const pvc = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: pvcName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/name': 'web-os-workspace',
          'app.kubernetes.io/part-of': 'web-os',
          'pod-id': podId,
        },
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: {
          requests: {
            storage: '1Gi',
          },
        },
        storageClassName: 'do-block-storage',
      },
    };

    await core.createNamespacedPersistentVolumeClaim({ namespace: this.namespace, body: pvc });
    console.log(`Created PVC ${pvcName} for pod ${podId}`);

    // Wait for PVC to bind
    const bound = await this.waitForPvcBound(pvcName, 60000);
    if (!bound) {
      throw new Error(`PVC ${pvcName} did not bind within 60s`);
    }

    return pvcName;
  }

  /**
   * Waits for a PVC to be bound.
   */
  private async waitForPvcBound(pvcName: string, timeoutMs: number = 60000): Promise<boolean> {
    if (!isKubernetesAvailable()) {
      return true;
    }

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const { core } = getKubernetesClient();
        const pvc = await core.readNamespacedPersistentVolumeClaim({ namespace: this.namespace, name: pvcName });
        
        if (pvc.status?.phase === 'Bound') {
          return true;
        }
      } catch {
        // Continue waiting
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return false;
  }

  /**
   * Checks if a workspace PVC exists for a pod.
   */
  async workspacePvcExists(podId: string): Promise<boolean> {
    if (!isKubernetesAvailable()) {
      return false;
    }

    const pvcName = this.getWorkspacePvcName(podId);
    
    try {
      const { core } = getKubernetesClient();
      await core.readNamespacedPersistentVolumeClaim({ namespace: this.namespace, name: pvcName });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates all Kubernetes resources for a pod (PVC, Pod, Service, Ingress).
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
      // Create workspace PVC (idempotent - skips if exists)
      const pvcName = await this.createWorkspacePvc(opts.podId);

      // Create owner-key secret first (required for pod to mount)
      await this.createOwnerKeySecret(opts);

      // Create per-pod RBAC so auth-proxy can update its own last-used annotation.
      await this.createPodActivityRbac(opts.podId);

      const skillsConfigMapName = opts.skills?.length ? this.getWorkspaceSkillsConfigMapName(opts.podId) : undefined;

      if (skillsConfigMapName) {
        await this.createWorkspaceSkillsConfigMap({ ...opts, skillsConfigMapName });
      }

      // Create Pod (with PVC mounted)
      await this.createPod({ ...opts, pvcName, skillsConfigMapName });

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
   * Creates a Kubernetes Pod with PVC for workspace.
   */
  async createPod(opts: CreatePodOptions): Promise<void> {
    if (!isKubernetesAvailable()) {
      console.log('Kubernetes not available, skipping pod creation');
      return;
    }

    const { core } = getKubernetesClient();
    const podName = `pod-${opts.podId.slice(0, 8)}`;
    const pvcName = opts.pvcName || this.getWorkspacePvcName(opts.podId);
    const volumes: any[] = [
      // Persistent workspace - survives pod restart
      { name: 'workspace', persistentVolumeClaim: { claimName: pvcName } },
      // Home directory (ephemeral)
      { name: 'home-opencode', emptyDir: {} },
      // LLM API keys (optional - may not exist if user hasn't registered keys)
      { name: 'llm-secrets', secret: { secretName: opts.llmSecretName, optional: true } },
      // Owner key for HTTPSig verification (sidecar only)
      { name: 'owner-key', secret: { secretName: opts.ownerKeySecretName } },
    ];
    const initContainers: any[] = [];

    if (opts.skillsConfigMapName) {
      volumes.push({ name: 'workspace-skills', configMap: { name: opts.skillsConfigMapName } });
      initContainers.push({
        name: 'install-workspace-skills',
        image: 'busybox:1.36',
        command: [
          'sh',
          '-c',
          [
            'set -eu',
            'mkdir -p /workspace/.opencode/skills',
            'for skill_file in /workspace-skills/*.md; do',
            '  skill_name="$(basename "$skill_file" .md)"',
            '  mkdir -p "/workspace/.opencode/skills/$skill_name"',
            '  cp "$skill_file" "/workspace/.opencode/skills/$skill_name/SKILL.md"',
            'done',
          ].join('\n'),
        ],
        volumeMounts: [
          { name: 'workspace', mountPath: '/workspace' },
          { name: 'workspace-skills', mountPath: '/workspace-skills', readOnly: true },
        ],
      });
    }

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
          'web-os.io/last-used-at': new Date().toISOString(),
        },
      },
      spec: {
        serviceAccountName: podName,
        restartPolicy: 'OnFailure',
        securityContext: {
          runAsUser: 1000,
          runAsGroup: 1000,
          fsGroup: 1000,
          seccompProfile: { type: 'RuntimeDefault' },
        },
        ...(initContainers.length > 0 && { initContainers }),
        volumes,
        containers: [
          {
            name: 'opencode',
            image: 'registry.digitalocean.com/scout-live/web-os-opencode:amd64',
            imagePullPolicy: 'Always',
            ports: [{ containerPort: 4096, name: 'opencode-http' }],
            env: [
              { name: 'OPENAI_API_KEY', valueFrom: { secretKeyRef: { name: opts.llmSecretName, key: 'openai', optional: true } } },
              { name: 'ANTHROPIC_API_KEY', valueFrom: { secretKeyRef: { name: opts.llmSecretName, key: 'anthropic', optional: true } } },
              { name: 'OPENROUTER_API_KEY', valueFrom: { secretKeyRef: { name: opts.llmSecretName, key: 'openrouter', optional: true } } },
              { name: 'GROQ_API_KEY', valueFrom: { secretKeyRef: { name: opts.llmSecretName, key: 'groq', optional: true } } },
              // Default model - free tier option
              { name: 'OPENCODE_MODEL', value: 'opencode/big-pickle' },
            ],
            volumeMounts: [
              { name: 'workspace', mountPath: '/workspace' },
              { name: 'home-opencode', mountPath: '/home/opencode' },
              { name: 'llm-secrets', mountPath: '/secrets/llm', readOnly: true },
            ],
            resources: {
              requests: { cpu: '250m', memory: '512Mi' },
              limits: { cpu: '1', memory: '2Gi' },
            },
          },
          {
            name: 'auth-proxy',
            image: 'registry.digitalocean.com/scout-live/web-os-auth-proxy:amd64',
            imagePullPolicy: 'Always',
            ports: [{ containerPort: 3001, name: 'auth-http' }],
            env: [
              { name: 'AUTH_PORT', value: '3001' },
              { name: 'BACKEND_PORT', value: '4096' },
              { name: 'OWNER_WALLET', value: opts.ownerWallet },
              { name: 'OWNER_KEY_ID', value: opts.ownerKeyId },
              { name: 'OWNER_PUBLIC_KEY_PEM_FILE', value: '/secrets/owner/public-key.pem' },
              { name: 'DOMAIN', value: this.baseDomain },
              { name: 'WORKSPACE_PATH', value: '/workspace' },
              { name: 'POD_NAME', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
              { name: 'POD_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } },
            ],
            volumeMounts: [
              { name: 'workspace', mountPath: '/workspace', readOnly: false },
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

  async createWorkspaceSkillsConfigMap(opts: CreatePodOptions & { skillsConfigMapName: string }): Promise<void> {
    if (!isKubernetesAvailable() || !opts.skills?.length) {
      return;
    }

    const { core } = getKubernetesClient();
    const data = Object.fromEntries(opts.skills.map((skill) => [`${skill.name}.md`, skill.markdown]));

    const configMap = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: opts.skillsConfigMapName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/name': 'workspace-skills',
          'app.kubernetes.io/part-of': 'web-os',
          'pod-id': opts.podId.slice(0, 8),
          'owner-wallet': opts.ownerWallet,
        },
      },
      data,
    };

    await core.createNamespacedConfigMap({ namespace: this.namespace, body: configMap });
  }

  /**
   * Creates a Kubernetes Secret for the owner's public key.
   * This secret is mounted by the sidecar for HTTPSig verification.
   */
  async createOwnerKeySecret(opts: CreatePodOptions): Promise<void> {
    if (!isKubernetesAvailable()) {
      console.log('Kubernetes not available, skipping secret creation');
      return;
    }

    const { core } = getKubernetesClient();

    // Check if secret already exists
    try {
      await core.readNamespacedSecret({ namespace: this.namespace, name: opts.ownerKeySecretName });
      console.log(`Secret ${opts.ownerKeySecretName} already exists, skipping creation`);
      return;
    } catch {
      // Secret doesn't exist, create it
    }

    const secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: opts.ownerKeySecretName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/name': 'owner-key',
          'app.kubernetes.io/part-of': 'web-os',
          'owner-wallet': opts.ownerWallet,
        },
      },
      type: 'Opaque',
      data: {
        'public-key.pem': Buffer.from(opts.ownerPublicKey).toString('base64'),
      },
    };

    await core.createNamespacedSecret({ namespace: this.namespace, body: secret });
    console.log(`Created secret ${opts.ownerKeySecretName} for owner ${opts.ownerWallet}`);
  }

  /**
   * Creates per-pod RBAC that allows the auth-proxy to patch only its own Pod.
   */
  async createPodActivityRbac(podId: string): Promise<void> {
    if (!isKubernetesAvailable()) {
      return;
    }

    const { core, objects } = getKubernetesClient();
    const podName = `pod-${podId.slice(0, 8)}`;

    try {
      await core.readNamespacedServiceAccount({ namespace: this.namespace, name: podName });
    } catch {
      await core.createNamespacedServiceAccount({
        namespace: this.namespace,
        body: {
          apiVersion: 'v1',
          kind: 'ServiceAccount',
          metadata: {
            name: podName,
            namespace: this.namespace,
            labels: {
              'app.kubernetes.io/name': 'web-os-user-pod-activity',
              'app.kubernetes.io/part-of': 'web-os',
              'pod-id': podId.slice(0, 8),
            },
          },
        },
      });
    }

    const role = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: {
        name: podName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/name': 'web-os-user-pod-activity',
          'app.kubernetes.io/part-of': 'web-os',
          'pod-id': podId.slice(0, 8),
        },
      },
      rules: [{
        apiGroups: [''],
        resources: ['pods'],
        resourceNames: [podName],
        verbs: ['get', 'patch'],
      }],
    };

    const roleBinding = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: {
        name: podName,
        namespace: this.namespace,
        labels: {
          'app.kubernetes.io/name': 'web-os-user-pod-activity',
          'app.kubernetes.io/part-of': 'web-os',
          'pod-id': podId.slice(0, 8),
        },
      },
      subjects: [{
        kind: 'ServiceAccount',
        name: podName,
        namespace: this.namespace,
      }],
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'Role',
        name: podName,
      },
    };

    await this.createObjectIfMissing(objects, role);
    await this.createObjectIfMissing(objects, roleBinding);
  }

  private async createObjectIfMissing(objects: ReturnType<typeof getKubernetesClient>['objects'], body: any): Promise<void> {
    try {
      await objects.read(body);
      return;
    } catch {
      await objects.create(body);
    }
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
          { name: 'auth-http', port: 3001, targetPort: 3001 },
          { name: 'opencode-http', port: 4096, targetPort: 4096 },
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
        annotations: {
          // Support WebSocket upgrades through the auth-proxy
          'nginx.ingress.kubernetes.io/proxy-http-version': '1.1',
          'nginx.ingress.kubernetes.io/proxy-read-timeout': '3600',
          'nginx.ingress.kubernetes.io/proxy-send-timeout': '3600',
        },
      },
      spec: {
        ingressClassName: 'nginx',
        tls: [{ hosts: [host], secretName: 'permaweb-pods-tls' }],
        rules: [{
          host,
          http: {
            // ALL traffic goes through auth-proxy (auth-http port 3001).
            // Auth-proxy handles authentication and proxies to OpenCode (port 4096).
            paths: [{
              path: '/',
              pathType: 'Prefix',
              backend: {
                service: { name: ingressName, port: { name: 'auth-http' } },
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
   * Optionally preserves the PVC to keep user data.
   */
  async deletePod(podId: string, opts?: { preserveData?: boolean }): Promise<void> {
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

      // Delete workspace skills ConfigMap when present
      try {
        await core.deleteNamespacedConfigMap({ name: this.getWorkspaceSkillsConfigMapName(podId), namespace: this.namespace });
      } catch { /* ignore */ }

      // Delete per-pod activity RBAC
      try {
        await core.deleteNamespacedServiceAccount({ name: podName, namespace: this.namespace });
      } catch { /* ignore */ }
      try {
        await getKubernetesClient().objects.delete({
          apiVersion: 'rbac.authorization.k8s.io/v1',
          kind: 'RoleBinding',
          metadata: { name: podName, namespace: this.namespace },
        });
      } catch { /* ignore */ }
      try {
        await getKubernetesClient().objects.delete({
          apiVersion: 'rbac.authorization.k8s.io/v1',
          kind: 'Role',
          metadata: { name: podName, namespace: this.namespace },
        });
      } catch { /* ignore */ }

      // Delete Pod
      try {
        await core.deleteNamespacedPod({ name: podName, namespace: this.namespace });
      } catch { /* ignore */ }

      // PVC is preserved by default (preserveData: true)
      // Only delete PVC if explicitly requested (preserveData: false)
      // This ensures user data survives pod deletion/restart
      if (opts?.preserveData === false) {
        try {
          // Note: We need the ownerWallet to derive the PVC name
          // For now, we don't delete PVC in deletePod
          // Use deleteAllForWallet to clean up everything including PVC
          console.log(`PVC preservation enabled, not deleting PVC for pod ${podName}`);
        } catch { /* ignore */ }
      }
    } catch (error: unknown) {
      console.error('Failed to delete pod:', error);
    }
  }

  /**
   * Deletes all resources for a wallet, including the PVC.
   * Use with caution - this permanently deletes user data.
   */
  async deleteAllForWallet(ownerWallet: string, podId: string): Promise<void> {
    if (!isKubernetesAvailable()) {
      return;
    }

    // First delete the pod
    await this.deletePod(podId, { preserveData: false });

    // Then delete the PVC (now per-pod, not per-wallet)
    const pvcName = this.getWorkspacePvcName(podId);
    try {
      const { core } = getKubernetesClient();
      await core.deleteNamespacedPersistentVolumeClaim({ name: pvcName, namespace: this.namespace });
      console.log(`Deleted PVC ${pvcName} for pod ${podId}`);
    } catch (error) {
      console.error(`Failed to delete PVC ${pvcName}:`, error);
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
