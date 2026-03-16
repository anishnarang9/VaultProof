# AGENT 2 (v2) — Get KYC Anchor Tests Green + Adapt to Agent 1's Interface Changes + Validate Revocation E2E

## Identity

You are Agent 2 working in `/Users/anishnarang/VaultProof`. Your previous run delivered the KYC registry rewrite with StateTree pattern, proof-driven add/revoke, and 9 test cases. The code compiles in isolation but can't run through `anchor test` due to a workspace Cargo conflict. **Agent 1 is simultaneously fixing the Cargo dependency issue.** Your job now is to:

1. Adapt your KYC code to work with whatever Poseidon solution Agent 1 lands (light-hasher may be replaced)
2. Get your Anchor test suite running end-to-end
3. Validate that revocation actually invalidates proofs at the Anchor integration level
4. Ensure your registry interfaces match what Agent 1's verifier expects

## CRITICAL: Read These Files First

1. `/Users/anishnarang/VaultProof/COORDINATION.md` — check Interface Changes Log for Agent 1's updates
2. `/Users/anishnarang/VaultProof/programs/kyc-registry/src/lib.rs` — your current code
3. `/Users/anishnarang/VaultProof/programs/kyc-registry/Cargo.toml` — dependency that may have been changed by Agent 1

## IMPORTANT: AGENT 1 MAY HAVE CHANGED YOUR CARGO.TOML

Agent 1's primary task is fixing the Cargo dependency conflict. The root cause is `light-hasher 1.1` pulling Solana 1.18 deps into the Solana 2.x workspace. Agent 1 may have:
- Replaced `light-hasher` with `light-poseidon` or an inline implementation
- Removed `light-hasher` entirely
- Changed how Poseidon hashing works in your code

**Before doing anything:** Check if `programs/kyc-registry/Cargo.toml` still has `light-hasher`. If Agent 1 changed it, adapt your code to use whatever replacement they put in. If they haven't changed it yet, coordinate — the fix needs to happen before any tests can run.

## YOUR FILE SCOPE

You MAY touch:
- `programs/kyc-registry/src/lib.rs`
- `programs/kyc-registry/Cargo.toml`
- `tests/kyc_registry_light.ts`
- `tests/kyc_revocation.ts`

You MUST NOT touch:
- `programs/vusd-vault/**`
- `programs/compliance-admin/**`
- `circuits/**`
- `app/**`
- `Cargo.toml` (root) — Agent 1 owns this for the dependency fix

## PHASE 1: ADAPT TO POSEIDON CHANGE

Check what happened to the Poseidon hasher:

```bash
cat programs/kyc-registry/Cargo.toml
grep -n "poseidon\|Poseidon\|light_hasher\|light_poseidon" programs/kyc-registry/src/lib.rs
```

If `light-hasher` was replaced:
1. Update all `use light_hasher::*` imports to match the new crate
2. Ensure `poseidon_hash()` function still works with same parameters
3. Verify the hash output matches circomlibjs Poseidon (same constants)

If `light-hasher` was NOT replaced yet:
1. Do it yourself: replace `light-hasher = "1.1"` with `light-poseidon = "1.1"` (or latest)
2. `light-poseidon` is the standalone Poseidon crate WITHOUT Solana deps
3. Update imports: `use light_poseidon::{Poseidon, PoseidonHasher};`
4. Verify it compiles: `cargo check -p kyc-registry`

## PHASE 2: GET ANCHOR TESTS RUNNING

Once the Cargo build works:

```bash
# Step 1: Verify build
anchor build -p kyc_registry

# Step 2: Run KYC-specific tests against local validator
anchor test --skip-build -- --grep "kyc_registry"
# OR
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/kyc_registry_light.ts
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/kyc_revocation.ts
```

Fix any failures:
- Account size mismatches → update `space` calculations in `#[account]` attributes
- PDA derivation mismatches → ensure seeds in tests match seeds in program
- Poseidon hash mismatches → ensure test-side (circomlibjs) and program-side (Rust) use same parameters

### Critical: Poseidon hash compatibility

The circuit uses circomlibjs Poseidon. The on-chain registry uses Rust Poseidon. These MUST produce identical output for the same inputs. Write a dedicated compatibility test:

```typescript
// In tests/kyc_registry_light.ts
it("Poseidon hash matches between circomlibjs and on-chain", async () => {
    const poseidon = await buildPoseidon();
    const jsHash = poseidon.F.toString(poseidon([input1, input2]));

    // Call on-chain add_credential with a known leaf hash computed in JS
    // Then read back the stored hash and verify it matches
});
```

## PHASE 3: VALIDATE INTERFACE CONTRACT WITH AGENT 1

Agent 1's verifier (`validate_all_public_inputs()`) reads the Merkle root from your registry. The contract from COORDINATION.md is:

> Agent 1 will accept a `registry_root: [u8; 32]` parameter in `validate_all_public_inputs()`. The root is sourced from Agent 2's `StateTree` account.

Verify:
1. Your `StateTree` account has a `root: [u8; 32]` field
2. The root updates atomically when credentials are added/revoked
3. Agent 1 can read the root by fetching `StateTree` at the PDA `[b"state_tree", registry.key().as_ref()]`

Write a test that proves the interface:

```typescript
it("StateTree root is readable and matches expected format", async () => {
    // 1. Initialize registry + state tree
    // 2. Add a credential
    // 3. Fetch StateTree account
    // 4. Assert root is 32 bytes, non-zero
    // 5. Assert root changed from initial empty root
});
```

## PHASE 4: REVOCATION INVALIDATION E2E

This is the most important behavioral guarantee. Write a comprehensive test:

```typescript
it("Revocation invalidates old proofs against the new root", async () => {
    // 1. Initialize registry
    // 2. Add credential with leaf_hash_A
    // 3. Record root_after_add
    // 4. Generate a Merkle proof for leaf_hash_A against root_after_add
    // 5. Revoke credential A
    // 6. Record root_after_revoke
    // 7. Assert root_after_revoke != root_after_add
    // 8. Attempt to verify old Merkle proof against root_after_revoke → MUST FAIL
    // 9. If credential B exists, verify B's proof still works against root_after_revoke
});
```

## PHASE 5: STRESS TESTS (if time permits)

- Add 100 credentials rapidly → verify final root is deterministic
- Revoke middle credential → verify other credentials' proofs still work
- Add credential → revoke → re-add same leaf hash → should this work? Document behavior.

## SUCCESS CRITERIA

- [ ] `anchor build -p kyc_registry` succeeds
- [ ] `tests/kyc_registry_light.ts` — all 5+ tests pass via `anchor test`
- [ ] `tests/kyc_revocation.ts` — all 4+ tests pass via `anchor test`
- [ ] Poseidon hash compatibility verified (JS ↔ Rust)
- [ ] StateTree root readable and correct format (32 bytes)
- [ ] Revocation invalidates old proofs (integration-level proof)
- [ ] No `light-hasher` in Cargo dependency tree (replaced with version-agnostic alternative)

## UPDATE PROTOCOL

After each meaningful step, append to "AGENT 2 LOG" in COORDINATION.md:
```
- YYYY-MM-DD HH:MM | status: in_progress|blocked|done
  - tests added first: yes/no
  - files changed: [list]
  - commands run: [list]
  - result: [summary]
  - blockers: [any]
  - next step: [what's next]
```

When done, update the Cross-Agent Requests to mark the light-hasher dependency request as resolved.
