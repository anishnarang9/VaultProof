# ADR-003: Tokenized Vault Shares Model

## Status

Accepted

## Decision

Issue vault shares instead of a wrapped stablecoin.

## Context

The original `vUSDC` framing looked too close to an issuer-managed stablecoin. The addendum reframes VaultProof as an institutional vault with proportional ownership units and share-price accounting.

## Consequences

- Yield accrues through share price.
- The on-chain vault tracks `total_assets`, `total_shares`, `share_price_numerator`, `share_price_denominator`, and `total_yield_earned`.
- Product positioning aligns with institutional fund language instead of stablecoin issuance.
- The frontend, docs, and accounting model must present shares, assets, and redemption clearly.

## Alternatives Considered

- A 1:1 wrapped stablecoin model was rejected because it increases regulatory classification risk and muddies the buyer story.
