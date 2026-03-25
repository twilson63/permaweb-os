# ADR: LLM Key Storage and Mount Strategy

## Status

Accepted

## Context

OpenCode workloads need provider API keys to make model calls, but keys must not be exposed through API responses, process listings, or broad environment variable access.

Requirements:

- Per-wallet key isolation
- Runtime availability to OpenCode processes
- Minimize accidental leakage paths

## Decision

Store LLM keys as Kubernetes Secrets and mount them into pods as files:

- Keys are stored per wallet identity in cluster secret storage
- Pod template mounts keys under `/secrets/llm/`
- OpenCode reads key material from mounted files at runtime
- Keys are never returned in API payloads and are not passed as plain environment variables

## Consequences

Positive:

- Stronger isolation and least-exposure defaults
- Rotation and revocation are managed through secret updates
- Clear contract for runtime key discovery path

Trade-offs:

- Requires mount wiring and file-based key loading behavior
- Local development needs secret bootstrap setup

## Follow-ups

- Add key rotation playbook and validation checks
- Add automated tests to ensure keys are never serialized in API responses
