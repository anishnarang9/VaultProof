# AGENT 1 — Round 2: Integration Test Reconciliation

## Identity

You are Agent 1 working in `/Users/anishnarang/VaultProof`. Your Round 1 work (circuit recompile, verifier overhaul, TVS, replay protection) is DONE. Your Round 2 mission is to make **every test in the repo pass under `anchor test`**.

## CRITICAL: Read These Files First

1. `/Users/anishnarang/VaultProof/COORDINATION.md` — coordination center with interface contracts and change log from Round 1.
2. `/Users/anishnarang/VaultProof/vaultproof-fix-addendum.md` — the authoritative spec (for test scenario reference).
3. `/Users/anishnarang/VaultProof/programs/vusd-vault/src/lib.rs` — the current vault program you wrote in Round 1.
4. `/Users/anishnarang/VaultProof/programs/kyc-registry/src/lib.rs` — the current KYC registry Agent 2 wrote in Round 1.
5. `/Users/anishnarang/VaultProof/programs/compliance-admin/src/lib.rs` — the compliance program you updated in Round 1.

## Your File Scope (HARD BOUNDARY)

You MAY touch:
- `tests/integration_e2e.ts` (you created this — flesh out all 24 stubs)
- `tests/integration_test.ts` (the old 1975-line file — DELETE or archive to `.bak`)
- `tests/kyc_registry_light.ts` (fix to work under shared `anchor test`, not just isolated validator)
- `tests/kyc_revocation.ts` (fix to work under shared `anchor test`, not just isolated validator)
- `tests/circuit_recompile.ts` (your file — update if needed)
- `tests/verifier_strict.ts` (your file — update if needed)
- `tests/tvs_shares.ts` (your file — update if needed)
- `Anchor.toml` (only the `[scripts]` section if test runner config needs updating)
- `tsconfig.json` (only if test compilation requires it)

You MUST NOT touch:
- `programs/**` (all programs are frozen — Round 1 is done, no code changes)
- `circuits/**` (frozen)
- `app/**` (Agent 2 owns this in Round 2)
- `docs/**` (Agent 3 owns this in Round 2)
- `README.md` (Agent 3 owns this in Round 2)

## Development Method: TEST-FIRST (still applies)

Even though you're writing tests, the principle is: write the test, run it, see if it passes. If it doesn't, debug the test setup (accounts, PDAs, transaction ordering), NOT the program code. The programs are frozen.

## The Problem

Right now `anchor test --skip-build --skip-local-validator` is RED because:

1. **`tests/integration_test.ts`** (1975 lines) — assumes depth-10 circuit, old `VaultState` fields (`vusd_mint`, `total_deposited`, `total_vusd_supply`), old `TransferRecord` (hash-only metadata), old public input ordering. This file is OBSOLETE.

2. **`tests/kyc_registry_light.ts`** and **`tests/kyc_revocation.ts`** — these pass on an isolated validator (port 18899) but fail under the shared `anchor test` harness because they hardcode validator URLs, deploy programs manually, and conflict with Anchor's built-in validator management.

3. **`tests/integration_e2e.ts`** — has 24 scenario stubs marked `pending`. Only 1 smoke test passes. The stubs need real implementations.

4. **`tests/circuit_recompile.ts`**, **`tests/verifier_strict.ts`**, **`tests/tvs_shares.ts`** — small stub files from Round 1. May need fleshing out or may be covered by `integration_e2e.ts`.

## Phase 1: Clean Up

### Step 1: Archive the old integration test
```bash
mv tests/integration_test.ts tests/integration_test.ts.old
```
This file is 1975 lines of tests against account layouts that no longer exist. It cannot pass. Archive it.

### Step 2: Fix KYC test suites for shared harness

The KYC tests currently do this (which breaks under `anchor test`):
- Manually start `solana-test-validator` on port 18899
- Manually deploy programs with `solana program deploy`
- Hardcode `ANCHOR_PROVIDER_URL=http://127.0.0.1:18899`

Fix them to:
- Use `anchor.AnchorProvider.env()` or `anchor.AnchorProvider.local()` (Anchor's default provider)
- Use `anchor.workspace.KycRegistry` to get the program (Anchor deploys it automatically)
- Remove all manual validator/deploy logic
- Keep all the actual test logic (account creation, instruction calls, assertions) — just rewire the setup

### Step 3: Consolidate stub files

Decide: do `circuit_recompile.ts`, `verifier_strict.ts`, and `tvs_shares.ts` add value as separate files, or should their scenarios fold into `integration_e2e.ts`? If they're just stubs with `it.skip()`, fold them in and delete the standalone files. If they have real passing tests, keep them.

## Phase 2: Implement All 24 E2E Scenarios

The `integration_e2e.ts` file has 24 pending scenarios. Implement ALL of them. Here are the scenarios grouped by category:

### KYC Registry (scenarios 1-5)
```
1. Initialize KYC registry with state tree
2. Add credential — verify root changes
3. Add second credential — verify root changes again
4. Revoke credential — verify root changes and old proof invalid
5. Authority transfer — verify old authority rejected
```

### Vault Deposit (scenarios 6-10)
```
6. Initialize vault with share mint and thresholds
7. Deposit with valid proof — verify shares minted at 1:1 (first deposit)
8. Deposit with valid proof at elevated share price — verify correct share calculation
9. Zero-amount deposit rejected
10. Replay: same proof submitted twice — second rejected (PDA already exists)
```

### Vault Transfer (scenarios 11-13)
```
11. Transfer with valid proof — TransferRecord created with full encrypted metadata
12. TransferRecord stores correct transfer_type, amount, timestamp, signer
13. TransferRecord encrypted_metadata length > 32 bytes (full ciphertext, not hash)
```

### Vault Withdrawal (scenarios 14-17)
```
14. Withdraw with valid proof — correct USDC returned based on share price
15. Emergency withdrawal request creates pending record with 72hr timelock
16. Emergency withdrawal execution succeeds after timelock
17. Emergency withdrawal execution rejected before timelock
```

### Verifier Strictness (scenarios 18-22)
```
18. Proof with wrong merkleRoot rejected
19. Proof with wrong transferAmount rejected
20. Proof with stale timestamp (>60s) rejected
21. Proof with wrong AML thresholds rejected
22. Proof with wrong walletPubkey rejected
```

### Compliance (scenarios 23-24)
```
23. Authorize decryption on real TransferRecord — sets flag to true
24. Compliance authorization record created with correct audit data
```

### Implementation approach for each test

Each test should follow this pattern:
```typescript
it("scenario description", async () => {
  // 1. Set up accounts (PDAs, token accounts, mints)
  // 2. Build valid circuit inputs matching current 22-public-input contract
  // 3. Generate proof with snarkjs (use circuits/build/ artifacts)
  // 4. Build and send transaction
  // 5. Assert on-chain state
});
```

For proof generation in tests, use the helper pattern from the existing `integration_test.ts.old` (it has working snarkjs integration) but update:
- Tree depth: 20 (not 10)
- Public inputs: 22 (not the old count)
- Account layouts: use new `VaultState`, `TransferRecord`, `KycRegistry`, `StateTree` shapes
- Credential leaf: `Poseidon(credHashFinal, identitySecret, walletPubkey)` (3-input, not 2)

### Shared test utilities

Create a `tests/helpers/` directory with:
- `test_utils.ts` — Poseidon, EdDSA, BabyJubJub helpers (extract from old integration_test.ts)
- `proof_utils.ts` — proof generation wrapper for the new 22-input circuit
- `account_utils.ts` — PDA derivation helpers for all account types

## Phase 3: Verify Everything Green

Run these commands and all must pass:
```bash
# Full repo-root test
anchor test --skip-build

# Or if using pre-running validator:
anchor test --skip-build --skip-local-validator
```

Expected output: ALL tests passing, ZERO pending, ZERO failing.

## After You Finish

1. Update COORDINATION.md Agent 1 log with Round 2 entry.
2. Update the progress tracker row.
3. Report: total tests passing, any remaining issues, `anchor test` green/red.

## Update Protocol

After each meaningful step, append to the "AGENT 1 LOG" section in COORDINATION.md:

```
- YYYY-MM-DD HH:MM | Round 2 | status: in_progress|done
  - tests added first: yes/no
  - files changed: [list]
  - commands run: [list]
  - result: [summary]
  - blockers: [any]
  - next step: [what's next]
```
