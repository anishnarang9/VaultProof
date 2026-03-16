# ADR-005: ElGamal Trapdoor Inside Circuit

## Status

Accepted

## Decision

Travel Rule metadata is encrypted inside the proof flow, with the circuit constraining 12 public ciphertext scalars that encode five metadata fields.

## Context

If metadata encryption happens completely outside the circuit, a sender can encrypt arbitrary garbage while still presenting an otherwise valid proof. The current circuit binds `[credentialHash, recipientAddress, transferAmount, currentTimestamp, jurisdiction]` to Baby Jubjub ElGamal outputs, and the frontend mirrors that structure before calling `snarkjs`.

## Consequences

- Circuit complexity increases.
- Regulator-readable metadata becomes part of the proof design, not a sidecar convention.
- Frontend proof plumbing must handle metadata preparation and encryption as a first-class step.

## Alternatives Considered

- Off-circuit wallet encryption was rejected because it weakens correctness guarantees for regulator review.
