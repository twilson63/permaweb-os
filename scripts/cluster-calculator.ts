#!/usr/bin/env deno run --allow-net --allow-env

/**
 * Cluster Sizing Calculator for Permaweb OS
 * 
 * Calculates recommended node pool configuration, estimates monthly cost,
 * and suggests HPA settings based on expected concurrent users.
 * 
 * Usage:
 *   deno run --allow-net cluster-calculator.ts [users]
 *   deno run --allow-net cluster-calculator.ts 100
 *   deno run --allow-net cluster-calculator.ts --interactive
 */

interface NodeConfig {
  name: string;
  vcpu: number;
  ram: number; // in GB
  monthlyCost: number;
  type: 'basic' | 'general' | 'cpu-optimized' | 'memory-optimized';
}

interface PodResources {
  cpuRequest: number; // in millicores
  cpuLimit: number;
  memoryRequest: number; // in MiB
  memoryLimit: number;
}

interface ClusterRecommendation {
  nodeType: NodeConfig;
  minNodes: number;
  maxNodes: number;
  totalPods: number;
  monthlyCost: number;
  costPerPod: number;
  hpaMin: number;
  hpaMax: number;
  warnings: string[];
}

// DigitalOcean node types (current pricing as of 2024)
const NODE_TYPES: NodeConfig[] = [
  // Basic tier
  { name: 's-2vcpu-4gb', vcpu: 2, ram: 4, monthlyCost: 24, type: 'basic' },
  { name: 's-4vcpu-8gb', vcpu: 4, ram: 8, monthlyCost: 48, type: 'basic' },
  { name: 's-6vcpu-16gb', vcpu: 6, ram: 16, monthlyCost: 96, type: 'basic' },
  { name: 's-8vcpu-32gb', vcpu: 8, ram: 32, monthlyCost: 192, type: 'basic' },
  
  // General Purpose
  { name: 'g-2vcpu-8gb', vcpu: 2, ram: 8, monthlyCost: 48, type: 'general' },
  { name: 'g-4vcpu-16gb', vcpu: 4, ram: 16, monthlyCost: 96, type: 'general' },
  { name: 'g-8vcpu-32gb', vcpu: 8, ram: 32, monthlyCost: 192, type: 'general' },
  { name: 'g-16vcpu-64gb', vcpu: 16, ram: 64, monthlyCost: 384, type: 'general' },
  
  // CPU-Optimized (recommended)
  { name: 'c-2vcpu-4gb', vcpu: 2, ram: 4, monthlyCost: 36, type: 'cpu-optimized' },
  { name: 'c-4vcpu-8gb', vcpu: 4, ram: 8, monthlyCost: 72, type: 'cpu-optimized' },
  { name: 'c-8vcpu-16gb', vcpu: 8, ram: 16, monthlyCost: 144, type: 'cpu-optimized' },
  { name: 'c-16vcpu-32gb', vcpu: 16, ram: 32, monthlyCost: 288, type: 'cpu-optimized' },
  
  // Memory-Optimized
  { name: 'm-2vcpu-16gb', vcpu: 2, ram: 16, monthlyCost: 96, type: 'memory-optimized' },
  { name: 'm-4vcpu-32gb', vcpu: 4, ram: 32, monthlyCost: 192, type: 'memory-optimized' },
  { name: 'm-8vcpu-64gb', vcpu: 8, ram: 64, monthlyCost: 384, type: 'memory-optimized' },
];

// User pod resources from k8s/pod-template.yaml
const USER_POD: PodResources = {
  cpuRequest: 350, // 250m (OpenCode) + 100m (sidecar)
  cpuLimit: 1500,  // 1000m (OpenCode) + 500m (sidecar)
  memoryRequest: 640, // 512Mi + 128Mi
  memoryLimit: 2560,  // 2048Mi + 512Mi
};

// API pod resources from k8s/api-deployment.yaml
const API_POD: PodResources = {
  cpuRequest: 100,
  cpuLimit: 500,
  memoryRequest: 128,
  memoryLimit: 512,
};

// System overhead per node (approximate)
const SYSTEM_OVERHEAD = {
  cpu: 560, // millicores
  memory: 512, // MiB
};

// Fixed monthly costs
const FIXED_COSTS = {
  loadBalancer: 12,
  registry: 5,
};

// Kubernetes reservation (typically 5-10%)
const KUBE_RESERVATION = 0.10;

function calculateMaxPods(node: NodeConfig): number {
  // Allocatable resources (account for kubelet reservation)
  const allocatableCpu = node.vcpu * 1000 * (1 - KUBE_RESERVATION);
  const allocatableMemory = node.ram * 1024 * (1 - KUBE_RESERVATION);
  
  // Available for user pods (after system overhead)
  const availableCpu = allocatableCpu - SYSTEM_OVERHEAD.cpu;
  const availableMemory = allocatableMemory - SYSTEM_OVERHEAD.memory;
  
  // Calculate max pods based on requests (not limits)
  const podsByCpu = Math.floor(availableCpu / USER_POD.cpuRequest);
  const podsByMemory = Math.floor(availableMemory / USER_POD.memoryRequest);
  
  // Return the limiting factor
  return Math.min(podsByCpu, podsByMemory);
}

function calculateCostPerPod(node: NodeConfig, maxPods: number): number {
  return Number((node.monthlyCost / maxPods).toFixed(2));
}

function getRecommendedNodeType(users: number): NodeConfig {
  // For small deployments, use smaller nodes
  if (users <= 10) {
    return NODE_TYPES.find(n => n.name === 'c-4vcpu-8gb')!;
  } else if (users <= 100) {
    return NODE_TYPES.find(n => n.name === 'c-4vcpu-8gb')!;
  } else {
    // For larger deployments, prefer larger nodes for efficiency
    return NODE_TYPES.find(n => n.name === 'c-8vcpu-16gb')!;
  }
}

function calculateRecommendation(
  users: number,
  preferredNodeType?: NodeConfig
): ClusterRecommendation {
  const warnings: string[] = [];
  
  // Use preferred node type or get recommendation
  const nodeType = preferredNodeType || getRecommendedNodeType(users);
  const maxPodsPerNode = calculateMaxPods(nodeType);
  
  // Calculate minimum nodes needed
  // Add 20% buffer for API pods and unexpected load
  const requiredPods = Math.ceil(users * 1.2);
  const minNodes = Math.max(2, Math.ceil(requiredPods / maxPodsPerNode));
  
  // Calculate max nodes (3x minimum for burst capacity)
  const maxNodes = Math.min(50, Math.max(minNodes * 3, minNodes + 5));
  
  // Calculate total capacity
  const totalPods = minNodes * maxPodsPerNode;
  
  // Calculate costs
  const nodeCost = minNodes * nodeType.monthlyCost;
  const totalCost = nodeCost + FIXED_COSTS.loadBalancer + FIXED_COSTS.registry;
  const costPerPod = calculateCostPerPod(nodeType, maxPodsPerNode);
  
  // HPA recommendations for API
  // Scale API based on user count (1 API pod per 50 users, min 2, max 10)
  const apiHpaMin = 2;
  const apiHpaMax = Math.min(10, Math.max(2, Math.ceil(users / 50)));
  
  // Warnings
  if (users > totalPods * 0.8) {
    warnings.push(`Approaching capacity limit. Consider adding nodes.`);
  }
  if (nodeType.type === 'basic') {
    warnings.push(`Basic nodes have shared CPU. Consider CPU-optimized for production.`);
  }
  if (nodeType.type === 'memory-optimized') {
    warnings.push(`Memory-optimized nodes are inefficient for CPU-bound OpenCode workloads.`);
  }
  if (users > 500) {
    warnings.push(`Large deployment. Consider multiple node pools for fault tolerance.`);
  }
  
  return {
    nodeType,
    minNodes,
    maxNodes,
    totalPods,
    monthlyCost: totalCost,
    costPerPod,
    hpaMin: apiHpaMin,
    hpaMax: apiHpaMax,
    warnings,
  };
}

function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => 
    Math.max(h.length, ...rows.map(r => r[i]?.length || 0))
  );
  
  const formatRow = (cells: string[]) => 
    '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
  
  const separator = '+-' + widths.map(w => '-'.repeat(w)).join('-+-') + '-+';
  
  return [
    separator,
    formatRow(headers),
    separator,
    ...rows.map(formatRow),
    separator,
  ].join('\n');
}

function printNodeComparison(): void {
  console.log('\n📊 Node Type Comparison (Pod Density)\n');
  
  const headers = ['Node Type', 'vCPU', 'RAM', 'Cost/mo', 'Max Pods', 'Cost/Pod', 'Recommended'];
  const rows = NODE_TYPES.map(node => {
    const maxPods = calculateMaxPods(node);
    const costPerPod = calculateCostPerPod(node, maxPods);
    const recommended = node.type === 'cpu-optimized' && 
                        (node.name === 'c-4vcpu-8gb' || node.name === 'c-8vcpu-16gb') 
                        ? '✓' : '';
    return [
      node.name,
      String(node.vcpu),
      `${node.ram}GB`,
      `$${node.monthlyCost}`,
      String(maxPods),
      `$${costPerPod.toFixed(2)}`,
      recommended,
    ];
  });
  
  console.log(formatTable(headers, rows));
}

function printRecommendation(users: number, rec: ClusterRecommendation): void {
  console.log(`\n🎯 Recommendation for ${users} concurrent users:\n`);
  
  console.log('┌─────────────────────────────────────────────────────┐');
  console.log('│ Node Pool Configuration                              │');
  console.log('├─────────────────────────────────────────────────────┤');
  console.log(`│ Node Type:          ${rec.nodeType.name.padEnd(31)} │`);
  console.log(`│ Tier:               ${rec.nodeType.type.padEnd(31)} │`);
  console.log(`│ Node Specs:         ${`${rec.nodeType.vcpu} vCPU, ${rec.nodeType.ram}GB RAM`.padEnd(31)} │`);
  console.log(`│ Min Nodes:          ${String(rec.minNodes).padEnd(31)} │`);
  console.log(`│ Max Nodes:          ${String(rec.maxNodes).padEnd(31)} │`);
  console.log(`│ Total Pod Capacity: ${String(rec.totalPods).padEnd(31)} │`);
  console.log('└─────────────────────────────────────────────────────┘');
  
  console.log('\n┌─────────────────────────────────────────────────────┐');
  console.log('│ Cost Estimate                                       │');
  console.log('├─────────────────────────────────────────────────────┤');
  console.log(`│ Node Pool:           ${`$${rec.minNodes * rec.nodeType.monthlyCost}/mo`.padEnd(31)} │`);
  console.log(`│ Load Balancer:       ${`$${FIXED_COSTS.loadBalancer}/mo`.padEnd(31)} │`);
  console.log(`│ Container Registry:  ${`$${FIXED_COSTS.registry}/mo`.padEnd(31)} │`);
  console.log(`│ Total Monthly:       ${`$${rec.monthlyCost}/mo`.padEnd(31)} │`);
  console.log(`│ Cost per Active Pod: ${`$${rec.costPerPod}`.padEnd(31)} │`);
  console.log(`│ Cost per User:       ${`$${(rec.monthlyCost / users).toFixed(2)}`.padEnd(31)} │`);
  console.log('└─────────────────────────────────────────────────────┘');
  
  console.log('\n┌─────────────────────────────────────────────────────┐');
  console.log('│ HPA Configuration (API)                             │');
  console.log('├─────────────────────────────────────────────────────┤');
  console.log(`│ Min Replicas:        ${String(rec.hpaMin).padEnd(31)} │`);
  console.log(`│ Max Replicas:        ${String(rec.hpaMax).padEnd(31)} │`);
  console.log(`│ CPU Threshold:       ${'70%'.padEnd(31)} │`);
  console.log(`│ Memory Threshold:    ${'80%'.padEnd(31)} │`);
  console.log('└─────────────────────────────────────────────────────┘');
  
  if (rec.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    rec.warnings.forEach(w => console.log(`   - ${w}`));
  }
  
  console.log('\n📝 doctl commands:');
  console.log(`   doctl kubernetes cluster create web-os \\`);
  console.log(`     --region nyc1 \\`);
  console.log(`     --node-pool "name=default;size=${rec.nodeType.name};count=${rec.minNodes};auto-scale=true;min-nodes=${rec.minNodes};max-nodes=${rec.maxNodes}"`);
}

function printScaleComparison(): void {
  console.log('\n📈 Scaling Comparison:\n');
  
  const userCounts = [10, 25, 50, 100, 250, 500, 1000];
  const headers = ['Users', 'Node Type', 'Min Nodes', 'Max Nodes', 'Monthly Cost', 'Cost/User'];
  const rows = userCounts.map(users => {
    const rec = calculateRecommendation(users);
    return [
      String(users),
      rec.nodeType.name,
      String(rec.minNodes),
      String(rec.maxNodes),
      `$${rec.monthlyCost}`,
      `$${(rec.monthlyCost / users).toFixed(2)}`,
    ];
  });
  
  console.log(formatTable(headers, rows));
}

function printResourceBreakdown(): void {
  console.log('\n📦 Resource Breakdown:\n');
  
  console.log('User Pod (OpenCode + HTTPSig Sidecar):');
  console.log(`  Requests: ${USER_POD.cpuRequest}m CPU, ${USER_POD.memoryRequest}Mi RAM`);
  console.log(`  Limits:    ${USER_POD.cpuLimit}m CPU, ${USER_POD.memoryLimit}Mi RAM`);
  
  console.log('\nAPI Pod:');
  console.log(`  Requests: ${API_POD.cpuRequest}m CPU, ${API_POD.memoryRequest}Mi RAM`);
  console.log(`  Limits:    ${API_POD.cpuLimit}m CPU, ${API_POD.memoryLimit}Mi RAM`);
  
  console.log('\nSystem Overhead (per node):');
  console.log(`  CPU:    ~${SYSTEM_OVERHEAD.cpu}m (CoreDNS, metrics, CNI, etc.)`);
  console.log(`  Memory: ~${SYSTEM_OVERHEAD.memory}Mi`);
  
  console.log('\nFixed Infrastructure:');
  console.log(`  Load Balancer:    $${FIXED_COSTS.loadBalancer}/mo`);
  console.log(`  Container Registry: $${FIXED_COSTS.registry}/mo`);
  console.log(`  DNS (DO DNS):      Free`);
}

async function interactiveMode(): Promise<void> {
  console.log('🧮 Permaweb OS Cluster Calculator\n');
  console.log('Enter number of concurrent users (or "q" to quit):');
  
  const input = prompt('> ');
  
  if (input?.toLowerCase() === 'q') {
    return;
  }
  
  const users = parseInt(input || '10');
  
  if (isNaN(users) || users < 1) {
    console.log('Invalid input. Please enter a positive number.');
    return interactiveMode();
  }
  
  printNodeComparison();
  printRecommendation(users, calculateRecommendation(users));
  printScaleComparison();
  printResourceBreakdown();
}

function main(): void {
  const args = Deno.args;
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Permaweb OS Cluster Sizing Calculator

Usage:
  deno run --allow-net cluster-calculator.ts [users]
  deno run --allow-net cluster-calculator.ts --interactive
  deno run --allow-net cluster-calculator.ts --compare

Options:
  [users]       Number of concurrent users (default: interactive mode)
  --interactive Interactive mode with prompts
  --compare     Show node type comparison table
  --help, -h    Show this help message

Examples:
  deno run --allow-net cluster-calculator.ts 100
  deno run --allow-net cluster-calculator.ts --compare
`);
    return;
  }
  
  if (args.includes('--compare')) {
    printNodeComparison();
    return;
  }
  
  const usersArg = args.find(a => !a.startsWith('-') && !isNaN(parseInt(a)));
  
  if (usersArg) {
    const users = parseInt(usersArg);
    printNodeComparison();
    printRecommendation(users, calculateRecommendation(users));
    printScaleComparison();
    printResourceBreakdown();
  } else {
    interactiveMode();
  }
}

// Run main
if (import.meta.main) {
  main();
}

export { calculateRecommendation, calculateMaxPods, NODE_TYPES };