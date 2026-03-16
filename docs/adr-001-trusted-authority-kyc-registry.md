# ADR-001: Trusted Authority for KYC Registry

## Status

Accepted

## Decision

The KYC registry uses an authority-controlled model backed by `KycRegistry` and `StateTree` PDAs instead of trustless on-chain root recomputation.

## Context

VaultProof is designed for regulated institutional deployment. In the current codebase, the registry authority initializes the registry, adds credentials, revokes credentials, and advances the `StateTree.root`. False root submission would be operationally and legally catastrophic for that operator.

## Consequences

- The system has a deliberate trust point at the registry authority.
- Auditability is preserved through public PDA state and credential events.
- Operator governance matters as much as code correctness.

## Alternatives Considered

- Full on-chain Merkle recomputation was rejected because it adds cost and complexity without matching the regulated-authority operating model.
