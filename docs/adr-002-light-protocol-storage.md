# ADR-002: Light Protocol for Merkle Tree Storage

## Status

Accepted

## Decision

Keep the KYC registry shaped like the intended Light/Photon architecture, but use PDA-backed `StateTree` and `CredentialLeaf` accounts today.

## Context

The addendum targeted Light Protocol and Photon for proof retrieval, but the code that ships today does not perform Light CPI or Photon indexer lookups. Instead, the registry keeps a dedicated `StateTree` PDA for the root and a `CredentialLeaf` PDA per leaf so the circuit and frontend can work against a Light-shaped interface without introducing a second storage system.

## Consequences

- The current implementation is honest about using a PDA fallback instead of full Light compression.
- Frontend code and scripts can still target a `state_tree -> root` model.
- Photon-style proof retrieval remains a production roadmap item instead of a hidden assumption.

## Alternatives Considered

- A fully local single-account registry was rejected because it would not match the intended depth-20 state tree shape or the future proof-retrieval model.
