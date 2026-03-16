# ADR-006: Wallet-Bound Credentials

## Status

Accepted

## Decision

Credential leaves use `Poseidon(credHashFinal, identitySecret, walletPubkey)`, making credentials wallet-bound and non-transferable.

## Context

Bearer-style credentials can be shared, lent, or sold across wallets. That breaks identity-to-wallet binding and weakens the compliance guarantees expected by institutional operators.

## Consequences

- Credential reuse across wallets is blocked by design.
- Wallet loss requires re-issuance.
- The frontend must make the wallet-binding step explicit when staging credentials.

## Alternatives Considered

- Bearer credentials were rejected because they allow identity lending and undermine the compliance story.
