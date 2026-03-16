# ADR-004: Browser-Based Proof Generation

## Status

Accepted

## Decision

Proof generation happens client-side in the browser via `/circuits/compliance.wasm`, `/circuits/compliance_final.zkey`, and `snarkjs`.

## Context

Confidential witness data should stay on the user device whenever possible. The current circuit is depth 20, uses the 22-public-input verifier contract, and is assembled in the browser from staged credentials, vault thresholds, Merkle context, and ElGamal metadata. Browser proving is slower than managed infrastructure, but it avoids sending confidential inputs to a remote proving service.

## Consequences

- Proof generation can take several seconds and depends on client hardware.
- The frontend must expose honest proof lifecycle states instead of fake timers.
- When the browser cannot reconstruct a live state-tree path from account data alone, it falls back to a local single-leaf witness for demo proof generation.
- A managed proving fallback can still exist later for low-power devices.

## Alternatives Considered

- Cloud proving services were rejected as the default because they require sending private inputs off device.
