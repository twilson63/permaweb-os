# ADR: Per-Pod Sidecar Verification Pattern

## Status

Accepted

## Context

Web OS routes signed requests directly to user pods via per-pod subdomains. We need a consistent way to enforce owner-only access without tightly coupling signature verification logic to every runtime process that may run inside a pod.

Requirements:

- Enforce HTTP Message Signature verification on every pod request
- Keep security enforcement independent from OpenCode runtime internals
- Make verification behavior testable and reusable across pod templates

## Decision

Adopt a per-pod sidecar pattern for request verification:

- Every pod includes an HTTPSig verification sidecar process
- Sidecar validates RFC 9421 request signatures before request handling proceeds
- OpenCode remains focused on agent execution, while signature policy stays in sidecar
- Pod ownership is enforced with configured owner key identity

## Consequences

Positive:

- Security control is separated from application runtime concerns
- Verification behavior is consistent across pods
- Sidecar logic can be tested and iterated independently

Trade-offs:

- Slightly higher pod complexity (additional container/process)
- Operational overhead for sidecar config/version rollout

## Follow-ups

- Add replay protection and freshness window enforcement in sidecar
- Standardize sidecar deployment wiring in pod template manifests
