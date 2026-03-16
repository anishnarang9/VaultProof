# Production Roadmap

## Goal

Take VaultProof from the current hackathon-grade confidential compliance demo to an institutional vault product with secure custody, governed operations, and production-proofed proving flows.

## Built Today

- Routed frontend with live account reads for vault state, registry state, and transfer records
- Real browser-side Groth16 input assembly and browser proving against `compliance.wasm` + `compliance_final.zkey`
- Depth-20 `KycRegistry` / `StateTree` / `CredentialLeaf` model with authority-managed add and revoke flows
- Devnet deployment scripts plus successful devnet deployment of `kyc_registry` and `compliance_admin`

## Still Hackathon Scope

- Browser `localStorage` credential staging
- PDA-backed state-tree fallback instead of full Light Protocol / Photon proof retrieval
- No end-to-end UI transaction submission for deposit, transfer, or withdrawal
- Partial devnet deployment: `vusd_vault` still needs additional SOL to finish deployment

## Roadmap

### Phase 1: Transaction and proof completion

- Finish end-to-end wallet-submitted deposit, transfer, and withdrawal flows in the UI.
- Replace browser-only credential staging with operator-authorized on-chain issuance.
- Replace local single-leaf proof fallback with live state-tree proof retrieval.

### Phase 2: Security hardening

- Move credentials out of browser storage and into encrypted institutional custody.
- Add Squads-based authority management for registry and vault operations.
- Add secure operational playbooks for emergency withdrawals and regulator access.

### Phase 3: Financial product readiness

- Integrate real yield venues and whitelisted strategy management.
- Add share-price accounting, reporting exports, and operational reconciliation.
- Introduce monitored, auditable regulator decryption approval workflows.

### Phase 4: Distribution and scale

- Support multiple issuers and issuer allowlists.
- Add managed proving as an optional path for low-power client devices.
- Move from devnet pilot to mainnet with institutional onboarding controls.

## Dependencies

- Agent 1 final verifier interface
- Agent 2 final KYC registry interface
- Secure custody integration partner
- Governance rollout via Squads or equivalent multisig controls
