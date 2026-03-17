# AGENT 2: KYC REGISTRY + LIGHT PROTOCOL — Codex Prompt

## Your Role
You are Agent 2, responsible for migrating the KYC Registry program to use Light Protocol ZK Compression for credential storage. You own all files in `programs/kyc-registry/` and the test files `tests/kyc_registry_light.ts` and `tests/kyc_revocation.ts`. Do NOT modify files outside your ownership boundary.

## Project Context
VaultProof is a ZK compliance engine for institutional DeFi vaults on Solana. The KYC Registry stores credential leaf hashes in an on-chain Merkle tree. Currently it uses a PDA-based approach with a `StateTree` account and `CredentialLeaf` PDAs. The revamp migrates this to Light Protocol's compressed accounts for cost efficiency and scalability.

Read `vaultproof-product-revamp.md` and `vaultproof-technical-bible.md` at the project root for full context.

## Coordination
Log every change you make in `REVAMP-COORDINATION.md` under the Agent 2 section. Mark artifacts as delivered when done. Agent 3 (Vault) depends on your CPI interface — they need to import `kyc_registry` with `features = ["cpi"]` and read the `merkle_root` from your config account.

---

## WHAT YOU MUST DO

### Task 1: Evaluate Light Protocol SDK compatibility

Add `light-sdk` to `programs/kyc-registry/Cargo.toml`:
```toml
[dependencies]
anchor-lang = "0.32.1"
solana-poseidon = "4.0.0"
light-sdk = { version = "0.11", features = ["anchor"] }
```

Run `anchor build` (or `cargo check -p kyc-registry`).

**⚠️ CRITICAL FALLBACK RULE:** If `light-sdk` has version conflicts with `anchor-lang 0.32.1`, debug for a MAX of 2 hours. If not resolved, FALL BACK to keeping the current PDA-based Merkle tree. It already works with depth 20 and Poseidon. Document Light Protocol as a production migration path in a comment at the top of `lib.rs`. Log the fallback decision in `REVAMP-COORDINATION.md`.

### Task 2A: If Light Protocol works — Rewrite `programs/kyc-registry/src/lib.rs`

Replace the current PDA-based approach with Light Protocol compressed accounts:

**New account structure:**
```rust
/// Lightweight config PDA — stores registry metadata
/// Actual credentials live as Light Protocol compressed accounts
#[account]
#[derive(InitSpace)]
pub struct KycRegistryConfig {
    pub authority: Pubkey,
    pub state_tree: Pubkey,          // Light Protocol state tree account
    pub address_tree: Pubkey,        // Light Protocol address tree
    pub credential_count: u64,
    pub revoked_count: u64,
    pub issuer_pubkey: [u8; 32],
    pub merkle_root: [u8; 32],       // Updated after every add/revoke
    pub bump: u8,
}

/// Compressed account data for each credential
#[derive(LightHasher, LightDiscriminator, AnchorSerialize, AnchorDeserialize)]
pub struct CredentialLeaf {
    pub registry: Pubkey,
    pub leaf_hash: [u8; 32],
    pub active: bool,
}
```

**Instructions:**
```rust
pub fn initialize_registry(ctx, state_tree: Pubkey, address_tree: Pubkey, issuer_pubkey: [u8; 32]) -> Result<()>
pub fn add_credential(ctx, proof: ValidityProof, address_tree_info: PackedAddressTreeInfo, output_tree_index: u8, leaf_hash: [u8; 32]) -> Result<()>
pub fn revoke_credential(ctx, proof: ValidityProof, compressed_account: CompressedAccountMeta, leaf_hash: [u8; 32]) -> Result<()>
pub fn transfer_authority(ctx, new_authority: Pubkey) -> Result<()>
```

**Key implementation detail:** After every `add_credential` or `revoke_credential`, read back the Merkle root from Light's state tree and store it in `KycRegistryConfig.merkle_root`. This way the vault program can read the root from your PDA without understanding Light's account layout.

### Task 2B: If Light Protocol DOES NOT work — Keep current PDA approach

Keep the existing `lib.rs` mostly as-is. Make these minimal improvements:
- Rename `KycRegistry` to `KycRegistryConfig` for consistency with the tech bible naming
- Ensure `merkle_root` field is exposed for CPI reads
- Add a comment at the top documenting Light Protocol as the production migration path
- Ensure `transfer_authority` instruction exists

### Task 3: Ensure CPI interface for Agent 3

The vault program imports `kyc_registry` with `features = ["cpi"]`. The CPI interface must expose:
- `KycRegistryConfig` account struct (so vault can `Account::try_from()` and read `merkle_root`)
- The program ID constant

The vault does NOT call any KYC registry instructions via CPI — it only READS the config account. So the CPI interface is just the account struct export. Make sure the `#[account]` derive is correct and the struct is public.

### Task 4: Rewrite tests

**`tests/kyc_registry_light.ts`** — 10+ tests:
1. Initialize registry (with Light Protocol state tree reference if applicable, or PDA tree)
2. Add credential → compressed account created (or PDA created), `credential_count` incremented
3. Add credential → `merkle_root` in config PDA updated
4. Revoke credential → compressed account nullified (or `active = false`), `revoked_count` incremented
5. Revoke credential → old Merkle proof invalid (root changed)
6. Add multiple credentials → count tracks correctly
7. Revoke already-revoked credential → error
8. Non-authority cannot add credential
9. Non-authority cannot revoke credential
10. Transfer authority works — new authority can add, old cannot

**`tests/kyc_revocation.ts`** — Additional revocation edge cases:
1. Revoke and re-add same leaf hash (if applicable)
2. Bulk add multiple credentials in sequence
3. Verify root changes deterministically

### Task 5: Build and verify

```bash
anchor build -p kyc-registry
# Must compile cleanly
# IDL must be generated in target/idl/
```

---

## CURRENT STATE OF THE CODE

The current `programs/kyc-registry/src/lib.rs` (387 lines) has:
- `KycRegistry` account with: authority, state_tree, credential_count, revoked_count, issuer_pubkey, merkle_root, bump
- `StateTree` account with: registry, root, depth (20), next_index, bump
- `CredentialLeaf` PDA with: registry, state_tree, leaf_hash, leaf_index, active, bump
- Instructions: `initialize_registry`, `add_credential`, `revoke_credential`, `transfer_authority`
- On-chain Poseidon Merkle tree computation in `add_credential` and `revoke_credential`
- Constants: `STATE_TREE_DEPTH = 20`, `MAX_LEAVES = 1 << 20`

The Merkle tree update logic computes Poseidon hashes on-chain using `solana_poseidon::hashv` with `Bn254X5, BigEndian` parameters — these are the EXACT same parameters used by Light Protocol and the Circom circuit.

## FILE OWNERSHIP

```
programs/kyc-registry/Cargo.toml    ← MODIFY (add light-sdk if it works)
programs/kyc-registry/src/lib.rs    ← REWRITE or MODIFY
tests/kyc_registry_light.ts         ← REWRITE
tests/kyc_revocation.ts             ← REWRITE
```

## WHAT NOT TO DO
- Do NOT modify any files in `programs/vusd-vault/` (Agent 3's territory)
- Do NOT modify any files in `programs/compliance-admin/` (Agent 4's territory)
- Do NOT modify any files in `app/` (Agent 5's territory)
- Do NOT modify circuit files (Agent 1's territory)
- Do NOT spend more than 2 hours debugging Light SDK version conflicts

## EXPECTED OUTCOMES
- `anchor build -p kyc-registry` compiles cleanly
- CPI interface works (Agent 3 can import with `features = ["cpi"]`)
- `merkle_root` is readable from the config PDA
- All 10+ tests pass
- Fallback decision logged if Light Protocol doesn't work

## DONE CRITERIA
- [ ] Light Protocol compatibility evaluated and decision logged in `REVAMP-COORDINATION.md`
- [ ] `lib.rs` updated (either with Light Protocol or improved PDA approach)
- [ ] CPI interface exports `KycRegistryConfig` struct
- [ ] `anchor build -p kyc-registry` succeeds
- [ ] 10+ tests in `kyc_registry_light.ts` passing
- [ ] Revocation tests in `kyc_revocation.ts` passing
- [ ] `REVAMP-COORDINATION.md` updated with all changes and artifacts marked delivered
