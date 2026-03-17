# AGENT 4: COMPLIANCE ADMIN + SQUADS — Codex Prompt (POST-AGENT-3)

> **CONTEXT: You already ran once and delivered scaffolding. This is your SECOND pass.** Agent 3 has now delivered the expanded vault program with `update_risk_limits`, `unpause_vault`, `update_custody_provider`, `add_yield_venue`, `remove_yield_venue`, and `accrue_yield`. Your job is to wire the full E2E test, finalize scripts, and verify the Squads client-side flow works end-to-end.

## Your Role
You are Agent 4, responsible for finalizing the Squads Protocol governance integration (client-side `@sqds/multisig` TS SDK), updating deployment scripts to use Agent 3's new instructions, and completing the end-to-end integration test suite. You own `programs/compliance-admin/`, `scripts/`, and `tests/integration_e2e.ts`.

## What You Already Delivered (First Pass)
- `programs/compliance-admin/src/lib.rs` — 3 instructions (authorize_decryption, update_aml_thresholds, update_regulator_key), DecryptionAuthorization PDA
- `scripts/deploy-devnet.sh` — Fresh keypair generation, all 3 programs
- `scripts/init-devnet-state.ts` — Squads setup scaffolding (conditional on `@sqds/multisig` being installed), gates on missing vault instructions
- `scripts/init-vault-devnet.ts` — Vault init with detection for missing revamp instructions
- `scripts/create-devnet-credentials.sh` — Updated for `sourceOfFundsHash` + `credentialVersion`
- `scripts/devnet-credential.ts` — Credential artifact builder
- `tests/integration_e2e.ts` — Scaffolding with readiness gates (detected Agent 3 wasn't done)

## What You Must Do Now

### Task 1: Ensure `@sqds/multisig` is in root package.json

```bash
# Check if already installed
npm ls @sqds/multisig 2>/dev/null || yarn add @sqds/multisig
```

The app already has it (`@sqds/multisig@2.1.4`), but the root workspace needs it for scripts and tests.

### Task 2: Update `scripts/init-devnet-state.ts` — Remove readiness gates

Agent 3 has delivered. Remove the conditional checks for missing instructions. Wire:
1. Initialize KYC Registry
2. Initialize Vault with all new fields (risk limits, custody provider)
3. Create Squads multisig (2-of-3 with test wallets)
4. Set vault authority to Squads multisig vault PDA
5. Set risk limits via `update_risk_limits`:
   - `circuit_breaker_threshold`: 100,000 USDC (100_000_000_000)
   - `max_single_transaction`: 50,000 USDC (50_000_000_000)
   - `max_single_deposit`: 50,000 USDC (50_000_000_000)
   - `max_daily_transactions`: 100
6. Create a test WhitelistedYieldVenue via `add_yield_venue`
7. Issue test credentials with source-of-funds fields

### Task 3: Update `scripts/init-vault-devnet.ts` — Remove detection stubs

Replace the "missing instruction" detection with actual calls to:
- `update_risk_limits`
- `update_custody_provider` (set to `SelfCustody`)
- `add_yield_venue` (create one test venue)
- `accrue_yield` (credit a small test yield, e.g., 100 USDC)

### Task 4: Complete `tests/integration_e2e.ts` — Full 13-step happy path

Now that Agent 3's instructions exist, implement the FULL flow:

1. Initialize KYC Registry
2. Initialize Vault with risk controls and custody config
3. Create Squads multisig (2-of-3), set as vault authority
4. Operator issues credential (with `sourceOfFundsHash` and `credentialVersion`)
5. Investor deposits USDC with ZK proof → shares minted, TransferRecord created
6. Verify share price is correct after deposit
7. Investor transfers shares with ZK proof → TransferRecord created
8. Investor withdraws with ZK proof → shares burned, USDC returned
9. **Circuit breaker test:** Submit withdrawal exceeding threshold → vault auto-pauses
10. **Squads unpause:** Propose `unpause_vault` via `@sqds/multisig` → second member approves → execute → vault unpaused
11. **Squads decryption:** Propose `authorize_decryption` via `@sqds/multisig` → approve → execute → TransferRecord marked `decryption_authorized = true`
12. Verify TransferRecord has full encrypted metadata
13. **Yield test:** Call `accrue_yield` → verify `total_assets` increased → share price went up

### Task 5: Additional compliance admin tests (8+)

1. Authorize decryption with Squads-approved transaction
2. Non-member cannot authorize decryption (authority mismatch)
3. Update AML thresholds via Squads flow
4. Update regulator key via Squads flow
5. Squads propose → approve → execute lifecycle
6. Single signer cannot execute 2-of-3 operation (rejected)
7. `DecryptionAuthorization` PDA created with correct fields
8. Event emitted on decryption authorization

### Task 6: Build and verify

```bash
# Root workspace
npm install  # or yarn install
anchor build
anchor test
```

---

## Squads Client-Side Pattern

Since on-chain CPI is dropped, here's how Squads works client-side:

```typescript
import * as multisig from "@sqds/multisig";

// 1. Create multisig
const [multisigPda] = multisig.getMultisigPda({ createKey: createKeypair.publicKey });
await multisig.rpc.multisigCreateV2({
    connection, createKey: createKeypair, creator: wallet,
    multisigPda, configAuthority: null,
    members: [
        { key: member1.publicKey, permissions: multisig.types.Permissions.all() },
        { key: member2.publicKey, permissions: multisig.types.Permissions.all() },
        { key: member3.publicKey, permissions: multisig.types.Permissions.all() },
    ],
    threshold: 2,
});

// 2. Get vault PDA (this becomes the vault authority)
const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

// 3. Propose a transaction (e.g., unpause_vault)
const transactionIndex = 1n;
await multisig.rpc.vaultTransactionCreate({
    connection, multisigPda, transactionIndex,
    creator: member1, vaultIndex: 0,
    message: /* TransactionMessage with unpause_vault instruction */,
});

// 4. Second member approves
await multisig.rpc.proposalApprove({
    connection, multisigPda, transactionIndex,
    member: member2,
});

// 5. Execute
await multisig.rpc.vaultTransactionExecute({
    connection, multisigPda, transactionIndex,
    member: member1,
});
```

The key insight: Squads vault PDA signs the transaction automatically during execution. The vault program's `has_one = authority` constraint is satisfied because authority = Squads vault PDA.

## FILE OWNERSHIP

```
programs/compliance-admin/src/lib.rs    ← NO CHANGE (already delivered)
tests/integration_e2e.ts               ← COMPLETE (remove gates, wire full flow)
scripts/init-devnet-state.ts           ← UPDATE (remove gates, wire Agent 3 instructions)
scripts/init-vault-devnet.ts           ← UPDATE (remove stubs, wire real calls)
scripts/create-devnet-credentials.sh   ← NO CHANGE (already updated)
scripts/devnet-credential.ts           ← NO CHANGE (already delivered)
scripts/deploy-devnet.sh               ← NO CHANGE (already delivered)
```

## DONE CRITERIA
- [ ] `@sqds/multisig` available in root workspace
- [ ] `scripts/init-devnet-state.ts` wires all Agent 3 instructions (no readiness gates)
- [ ] `scripts/init-vault-devnet.ts` calls real instructions (no stubs)
- [ ] `tests/integration_e2e.ts` covers full 13-step happy path
- [ ] Squads propose → approve → execute flow tested (unpause + decryption)
- [ ] 8+ compliance admin tests passing
- [ ] `anchor test` succeeds
- [ ] `REVAMP-COORDINATION.md` updated with all changes and all artifacts marked delivered
