/**
 * @fileoverview Kubernetes API client singleton for managing pods, services, and ingresses.
 * @module kubernetes/client
 */

import { KubeConfig, CoreV1Api, NetworkingV1Api, KubernetesObjectApi } from '@kubernetes/client-node';

let k8sCoreApi: CoreV1Api | null = null;
let k8sNetworkingApi: NetworkingV1Api | null = null;
let k8sObjectApi: KubernetesObjectApi | null = null;
let kubeConfig: KubeConfig | null = null;

/**
 * Initializes the Kubernetes client from default configuration.
 * Uses kubeconfig from:
 * 1. KUBECONFIG environment variable
 * 2. ~/.kube/config
 * 3. In-cluster config if running in a pod
 *
 * For DigitalOcean Kubernetes, the in-cluster API server may not be reachable,
 * so we use the external endpoint from the kubeconfig.
 *
 * @returns Kubernetes API clients for core, networking, and object operations
 */
export function getKubernetesClient(): {
  core: CoreV1Api;
  networking: NetworkingV1Api;
  objects: KubernetesObjectApi;
  namespace: string;
} {
  if (!k8sCoreApi || !k8sNetworkingApi || !k8sObjectApi || !kubeConfig) {
    kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    k8sCoreApi = kubeConfig.makeApiClient(CoreV1Api);
    k8sNetworkingApi = kubeConfig.makeApiClient(NetworkingV1Api);
    k8sObjectApi = KubernetesObjectApi.makeApiClient(kubeConfig);
  }

  const namespace = process.env.NAMESPACE || 'web-os';

  return {
    core: k8sCoreApi,
    networking: k8sNetworkingApi,
    objects: k8sObjectApi,
    namespace
  };
}

/**
 * Checks if Kubernetes is available and configured.
 *
 * @returns true if the client can be initialized
 */
export function isKubernetesAvailable(): boolean {
  try {
    const kc = new KubeConfig();
    kc.loadFromDefault();
    return kc.currentContext !== undefined || kc.getContexts().length > 0;
  } catch {
    return false;
  }
}

/**
 * Resets the client singleton. Useful for testing.
 */
export function resetKubernetesClient(): void {
  k8sCoreApi = null;
  k8sNetworkingApi = null;
  k8sObjectApi = null;
  kubeConfig = null;
}