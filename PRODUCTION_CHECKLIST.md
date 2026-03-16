# VAULTPROOF — PRODUCTION READINESS CHECKLIST

Status: COMPLETE (hackathon scope)
Last updated: 2026-03-16

---

## PHASE 1: CIRCUIT RECOMPILE (Agent 1) ✅

- [x] Add AML thresholds as public inputs to `tiered_threshold.circom`
- [x] Add `walletPubkey` to credential leaf hash in `compliance.circom`
- [x] Increase tree depth from 10 to 20 in `compliance.circom`
- [x] Update public input ordering to match addendum spec (22 public inputs)
- [x] Recompile circuit: `circom compliance.circom --r1cs --wasm --sym -o build/`
- [x] Redo trusted setup (powersoftau + groth16 setup + zkey contribution)
- [x] Generate new verification key JSON
- [x] Export new Solana verifying key to `programs/vusd-vault/src/keys/verifying_key.rs`
- [x] Run all circuit tests with new circuit (regression + new test vectors)
- [x] Copy new WASM + zkey to `app/public/circuits/`

## PHASE 2: KYC REGISTRY OVERHAUL (Agent 2) ✅

- [x] Add `solana-poseidon` to `kyc-registry/Cargo.toml` (replaced light-hasher for Solana 2.x compat)
- [x] Rewrite `KycRegistry` account to reference StateTree PDA
- [x] Rewrite `initialize_registry` to accept state tree reference
- [x] Rewrite `add_credential` with PDA-based compressed account model
- [x] Rewrite `revoke_credential` to nullify credentials and update root
- [x] Verify: adding credential changes state tree root
- [x] Verify: revoking credential invalidates old Merkle proofs
- [x] Verify: Merkle proofs for non-revoked credentials remain valid after revocation
- [x] Verify: duplicate credential rejection works
- [x] Verify: authority transfer preserves all behavior
- [ ] Wire real Light Protocol CPI (post-hackathon — PDA-based simulation in place, documented in ADR-002)
- [ ] Add `@lightprotocol/stateless.js` Photon indexer integration (post-hackathon)

## PHASE 3: ON-CHAIN VERIFIER OVERHAUL (Agent 1) ✅

- [x] Implement `validate_all_public_inputs()` in vusd-vault
- [x] Validate merkleRoot against registry state tree root
- [x] Validate transferAmount against instruction amount
- [x] Validate timestamp within 60 seconds of Solana clock
- [x] Validate AML thresholds [3-6] against vault state
- [x] Validate regulator key [7-8] against vault state
- [x] Validate walletPubkey [9] against transaction signer
- [x] Store full encrypted metadata [10+] in TransferRecord (Vec<u8>, not hash)
- [x] Implement replay protection: PDA keyed by proof_hash (SHA-256 of proof bytes)
- [x] Verify: replayed proof rejected (duplicate PDA init fails)
- [x] Update TransferRecord account to store `Vec<u8>` encrypted metadata
- [x] Anchor decryption authorization to real TransferRecord account
- [x] Derive authorization PDA from TransferRecord address
- [x] Emit DecryptionAuthorized event with audit data

## PHASE 4: TOKENIZED VAULT SHARES (Agent 1) ✅

- [x] Rename vUSDC concept to vault shares in program code
- [x] Add share accounting to VaultState: total_assets, total_shares, share_price_numerator/denominator
- [x] Update deposit: calculate shares = amount * total_shares / total_assets
- [x] Update withdrawal: calculate usdc_out = shares * total_assets / total_shares
- [x] Handle first deposit 1:1 ratio edge case
- [x] Add yield accounting fields: yield_source, liquid_buffer_bps, total_yield_earned
- [x] Verify share price math with multi-deposit/withdrawal scenarios

## PHASE 5: FRONTEND FULL REWIRE (Agent 3 + Agent 2 Round 2) ✅

### Test Harness
- [x] Install Vitest + React Testing Library + jsdom + Playwright
- [x] Configure vitest.config.ts
- [x] Create test setup file
- [x] Add test scripts to app/package.json
- [x] Verify test harness works with a smoke test

### App Shell
- [x] Replace App.tsx with real router + WalletProvider
- [x] Configure routes for all 7 pages (/, /credential, /deposit, /transfer, /withdraw, /dashboard, /compliance)
- [x] Create Compliance page (new)
- [x] Verify all routes render correctly

### Shared Runtime
- [x] Create `app/src/lib/program.ts` — Anchor program client (read + write)
- [x] Create `app/src/lib/types.ts` — TypeScript account types
- [x] Create `app/src/lib/merkle.ts` — Merkle proof retrieval
- [x] Create `app/src/lib/elgamal.ts` — ElGamal encryption
- [x] Create `app/src/lib/stealth.ts` — Stealth account derivation
- [x] Create `app/src/lib/proof.ts` — Real snarkjs proof generation
- [x] Create `app/src/hooks/useVaultState.ts`
- [x] Create `app/src/hooks/useCredential.ts`
- [x] Create `app/src/hooks/useProofGeneration.ts`
- [x] Create `app/src/hooks/useTransferRecords.ts`

### Page Rewire
- [x] Dashboard: live on-chain stats (no hardcoded numbers)
- [x] Credential: real KYC issuance flow
- [x] Deposit: real proof generation (not timer animation) + vault share output
- [x] Transfer: real proof generation + stealth accounts
- [x] Withdraw: real proof generation + 72hr timelock (not 24hr)
- [x] Compliance: TransferRecord listing + decryption auth status

## PHASE 6: BRANDING + MESSAGING (Agent 3) ✅

- [x] Replace all "vUSDC" with "vault shares"
- [x] Replace tagline with "Compliant stablecoins with confidential identity"
- [x] Replace "private" with "confidential" in all user-facing copy
- [x] Replace "privacy protocol" with "confidential compliance infrastructure"
- [x] Fix timelock display: "24 hours" → "72 hours" everywhere
- [x] Remove overclaiming language about full privacy
- [x] Verify: no instance of "vUSDC" remains in frontend code
- [x] Verify: no instance of "24 hours" in timelock context

## PHASE 7: DOCUMENTATION (Agent 3) ✅

- [x] Write Privacy Model section in README (what IS vs IS NOT confidential)
- [x] Write Hackathon Scope vs Production Scope table in README
- [x] Write ADR-001: Trusted Authority for KYC Registry
- [x] Write ADR-002: Light Protocol for Merkle Tree Storage
- [x] Write ADR-003: Tokenized Vault Shares Model
- [x] Write ADR-004: Browser-Based Proof Generation
- [x] Write ADR-005: ElGamal Trapdoor Inside Circuit
- [x] Write ADR-006: Wallet-Bound Credentials
- [x] Update technical architecture doc to match new code
- [x] Ensure doc/code consistency (no drift)

## PHASE 8: INTEGRATION TESTING (Agent 1 Round 2) ✅

- [x] Full end-to-end: issue credential → deposit → transfer → withdraw (37 passing, `anchor test --skip-build`)
- [x] Replay protection: same proof rejected on second submit (Rust unit test + e2e)
- [x] Revocation: revoked credential proof rejected by verifier
- [x] Threshold governance: update threshold → next proof must use new value
- [x] Wallet binding: proof with wrong wallet rejected
- [x] Stale proof: proof >60 seconds old rejected
- [x] Emergency withdrawal: succeeds after 72hr timelock with funded account
- [x] Share price: correct after multiple deposits + yield accrual
- [x] Light Protocol: PDA-based state tree creation + nullification + root updates

## PHASE 9: DEVNET DEPLOYMENT ✅

- [x] Deploy all 3 programs to Solana devnet
  - `kyc_registry`: `NsgKr1qCEUb1vXdwaGvbz3ygG4R4SCrUQm3T8tHoqgD`
  - `vusd_vault`: `CUxwkHjKjGyKa5H1qEQySw98yKn33RZFxc9TbVgU6rdu`
  - `compliance_admin`: `BsEMZCJzj3SqwSj6z2F3X8m9rFHjLubgBzMeSgj8Lp6K`
- [x] Configure frontend for devnet cluster
- [x] Create devnet test credentials
- [x] Initialize vault on devnet (share mint, USDC reserve, thresholds)
- [x] Pre-fund test accounts with devnet SOL + test USDC (1M test USDC minted)
  - Test USDC Mint: `Rzy12Rn2BeyWMo47P5byzkKFPAWsvJqg19ju2Mmu8Da`
  - Share Mint: `BV6kW5wEMABsYtxFtuUwWEseeayYixgFfaAftUj3j3Zp`
  - Vault State: `CFfJc2twicWbCwyZX2s7VZmtda6grkE2GYNNJkNF2hDo`
  - Authority: `DzGXeLhKHH81BKSLnQ82FWbmxyPezd7FUgLGDvSkzPge`

## PHASE 10: FINAL POLISH ✅

- [ ] Record 3-minute demo video
- [ ] Final submission on DoraHacks
- [x] Verify all ADRs are accurate to final code
- [x] Verify README is accurate to final code
- [x] Remove any remaining TODO/FIXME comments
- [x] Frontend build succeeds with zero warnings
- [x] `anchor build` succeeds with zero warnings

---

## ISSUES EXPLICITLY NOT FIXED (Documented)

These are intentional design decisions, not bugs. See ADRs for justification.

| # | Issue | Status | Where Documented |
|---|---|---|---|
| 7 | Trusted authority for Merkle root | By design | ADR-001 |
| 18 | Browser localStorage for credentials | Hackathon scope | ADR-004 + Roadmap table |
| 21 | Single authority vs Squads | Authority is a Pubkey — set to Squads | Code comments |
| 26 | No distribution moat | Hackathon scope | README business section |
| 27 | Partner story simulated | Demo label | README |
| 28 | Moat unclear | Documented | README business section |
| 29 | Diligence signaling | Fixed by addendum | This checklist + ADRs |
| 30 | Ops over-indexed on elegance | Fixed by honest scope | Roadmap table |
