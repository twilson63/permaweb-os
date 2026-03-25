# ADR: HTTP Message Signature Library Selection (P0-S4)

## Status

Accepted

## Context

P0-S4 requires selecting a library for sidecar signature verification with these constraints:

- RFC 9421 (HTTP Message Signatures) compatibility
- RSA and ECDSA algorithm support
- Node.js integration for `opencode-sidecar`
- Reasonable maintenance and implementation clarity for a verification spike

The requested candidates were:

1. `http-signature`
2. `httpsig`
3. `@digitalbazaar/http-signature`

## Evaluation

| Library | RFC 9421 | RSA/ECDSA | Availability / Notes | Result |
|---|---|---|---|---|
| `http-signature` | No (Joyent legacy HTTP Signature scheme) | RSA/ECDSA available in legacy flow | Mature package but targets older draft style auth, not RFC 9421 message signatures | Rejected |
| `httpsig` | Unknown | Unknown | Not available on npm registry (`404 Not Found`) | Rejected |
| `@digitalbazaar/http-signature` | Unknown | Unknown | Not available on npm registry (`404 Not Found`) | Rejected |

Because none of the three candidates satisfies all constraints in this repo's Node environment, we selected a practical RFC 9421 implementation for the spike:

- `http-message-sig` (`npm:http-message-sig`)

This package explicitly targets RFC 9421 and exposes algorithm identifiers including:

- `rsa-v1_5-sha256`
- `rsa-pss-sha512`
- `ecdsa-p256-sha256`
- `ecdsa-p384-sha384`

## Decision

Use `http-message-sig` for the P0-S4 sidecar verification spike.

Implementation in this step:

- Added `verifyHttpMessageSignature(...)` in the sidecar.
- Wired `/verify` endpoint to perform signature verification against configured owner key.
- Added tests proving:
  - valid RSA signatures are accepted
  - valid ECDSA signatures are accepted
  - tampered/invalid signatures are rejected
  - unknown key IDs are rejected

## Consequences

Positive:

- Unblocks RFC 9421 verification path in sidecar now
- Confirms RSA/ECDSA verification behavior with repeatable tests
- Provides a concrete baseline for P2 auth hardening work

Trade-offs:

- This is still a spike, not full production auth (no replay cache, nonce/timestamp window policy, or wallet registration lifecycle yet)
- Library maturity should be revisited before production hardening

## Follow-ups

- Add freshness checks (`created`/`expires`) and replay protection cache
- Integrate wallet key lookup instead of single owner key env var
- Add integration test coverage for full HTTP request path beyond unit verification
