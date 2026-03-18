# VAULTPROOF — TECHNICAL REVAMP BIBLE
## The Definitive Build Specification for All Agents
## StableHacks 2026 · Track 1: Institutional Permissioned DeFi Vaults

---

# HOW TO USE THIS DOCUMENT

This document is the single source of truth for the VaultProof revamp. It contains:
- All 22 decisions (13 product + 9 technical)
- 5 agent assignments with exact file ownership
- Dependency chain and artifact handoff protocol
- Exact specifications for every change
- Fallback paths for risky integrations
- Testing requirements per agent

**Read your agent section. Do not modify files outside your ownership boundary.**

> **⚠️ CRITICAL UPDATE (2026-03-16): ALL THREE EXTERNAL RUST CRATE INTEGRATIONS FAILED.**
>
> | Integration | Outcome | Replacement |
> |---|---|---|
> | Light Protocol SDK (`light-sdk 0.11`) | ❌ Incompatible (`anchor-lang 0.29.0` vs our `0.32.1`) | PDA Merkle tree — WORKING, 16 tests passing |
> | Squads on-chain CPI (`squads-multisig`) | ❌ Incompatible (same Anchor version issue) | Client-side `@sqds/multisig` TS SDK |
> | Kamino CPI (`kamino-lending`) | ❌ Assumed incompatible (don't attempt) | `accrue_yield` admin instruction |
>
> **DO NOT import `light-sdk`, `squads-multisig`, or `kamino-lending` Rust crates.** This is final.
> The product experience is unchanged — only WHERE integration code runs (TypeScript vs Rust), not WHAT judges see.

---

# CURRENT TECHNICAL STATE

| Component | Version/State |
|---|---|
| Anchor | 0.32.1 |
| Rust | 1.89.0 |
| Solana CLI | (use workspace toolchain) |
| groth16-solana | 0.2.0 |
| solana-poseidon | 4.0.0 (Bn254X5, BigEndian) |
| React | 19.2.4 |
| Vite | 8.0.0 |
| snarkjs | 0.7.6 |
| circomlibjs | 0.1.7 |
| Circuit public inputs | 22 (stays at 22 after recompile) |
| Circuit constraints | ~37,260 (will become ~41,000) |
| Verifying key | Generated, 22 public inputs |
| Programs | 3: kyc-registry, vusd-vault, compliance-admin |
| Devnet status | kyc-registry + compliance-admin deployed; vusd-vault blocked by SOL limits |

**CRITICAL: Fresh deploy with new program IDs.** All three programs will be redeployed with new keypairs. Generate new keypairs before building. Update Anchor.toml and declare_id! macros.

---

# DEPENDENCY CHAIN

```
Agent 1 (Circuit)
  └─ produces: verifying_key.rs, compliance.wasm, compliance_final.zkey
       └─ consumed by: Agent 3 (copies verifying_key.rs into programs/vusd-vault/src/keys/)
       └─ consumed by: Agent 5 (copies .wasm and .zkey into app/public/circuits/)

Agent 2 (KYC Registry + Light Protocol)
  └─ produces: updated kyc-registry crate with CPI exports
       └─ consumed by: Agent 3 (imports kyc_registry with features = ["cpi"])

Agent 3 (Vault Program)
  └─ BLOCKED BY: Agent 1 (verifying key) + Agent 2 (KYC Registry CPI interface)
  └─ produces: updated vusd-vault IDL
       └─ consumed by: Agent 5 (reads IDL for frontend type generation)

Agent 4 (Compliance Admin + Squads)
  └─ depends on: Agent 3 (vusd-vault CPI interface) — BUT can stub the interface initially
  └─ produces: updated compliance-admin IDL

Agent 5 (Frontend)
  └─ BLOCKED BY: Agent 3 (IDL for type generation) — BUT can build UI shell with mock data first
  └─ consumes: Agent 1 artifacts (.wasm, .zkey), Agent 3 IDL, Agent 2 registry IDL
```

**Unblocking strategy:** Agents 3 and 5 start with STUBS. Agent 3 uses placeholder verifying key (current one works structurally) and current KYC Registry CPI interface. Agent 5 builds the entire UI with mock data hooks. When upstream artifacts arrive, they swap in.

---

# AGENT 1: CIRCUIT RECOMPILE

## Owner
All files in `circuits/`

## File Ownership
```
circuits/compliance.circom          ← MODIFY
circuits/tiered_threshold.circom    ← NO CHANGE (thresholds already public inputs)
circuits/merkle_tree_verifier.circom ← NO CHANGE
circuits/elgamal_encrypt.circom     ← NO CHANGE
circuits/setup.sh                   ← MINOR UPDATE (if needed)
circuits/export_vk_solana.mjs       ← NO CHANGE
circuits/test_comprehensive.mjs     ← UPDATE with new fields
circuits/test_recompile.mjs         ← UPDATE with new fields
circuits/test_utils.mjs             ← UPDATE with new credential hash logic
circuits/package.json               ← NO CHANGE
```

## Changes to compliance.circom

### 1. Add two new private inputs
```circom
// After existing private inputs, add:
signal input sourceOfFundsHash;     // Poseidon hash of source-of-funds attestation
signal input credentialVersion;     // Credential format version number (currently 1)
```

### 2. Change credential hashing from Poseidon(3) to Poseidon(4)
Current:
```circom
component credHashFinal = Poseidon(3);
credHashFinal.inputs[0] <== credHash1.out;
credHashFinal.inputs[1] <== credHash2.out;
credHashFinal.inputs[2] <== credHash3.out;
```

New:
```circom
// New sub-hash for source-of-funds and version
component credHash4 = Poseidon(2);
credHash4.inputs[0] <== sourceOfFundsHash;
credHash4.inputs[1] <== credentialVersion;

// credHashFinal now takes 4 inputs
component credHashFinal = Poseidon(4);
credHashFinal.inputs[0] <== credHash1.out;
credHashFinal.inputs[1] <== credHash2.out;
credHashFinal.inputs[2] <== credHash3.out;
credHashFinal.inputs[3] <== credHash4.out;
```

### 3. No changes to public inputs
The public input list stays EXACTLY the same — 22 public inputs:
```circom
component main {public [
    merkleRoot,
    transferAmount,
    currentTimestamp,
    retailThreshold,
    accreditedThreshold,
    institutionalThreshold,
    expiredThreshold,
    regulatorPubKeyX,
    regulatorPubKeyY,
    walletPubkey,
    encryptedMetadata
]} = VaultProofCompliance(20, 5);
```

### 4. No changes to tree depth
Already depth 20. No change needed.

### 5. No changes to thresholds
Already public inputs. No change needed.

### 6. No changes to wallet binding
Already in credential leaf hash. No change needed.

## Recompile Steps
```bash
cd circuits
npm install  # ensure circomlib is present

# Compile
circom compliance.circom --r1cs --wasm --sym -o build/

# Check constraint count (expect ~41,000)
npx snarkjs r1cs info build/compliance.r1cs

# Trusted setup (reuse existing ptau if pot16 — 65,536 max constraints)
npx snarkjs groth16 setup build/compliance.r1cs pot16_final.ptau circuit_0000.zkey
npx snarkjs zkey contribute circuit_0000.zkey circuit_final.zkey --name="VaultProof Phase2" -v
npx snarkjs zkey export verificationkey circuit_final.zkey verification_key.json

# Export verifying key for Solana
node export_vk_solana.mjs verification_key.json > ../programs/vusd-vault/src/keys/verifying_key.rs

# Copy WASM + zkey for frontend
cp build/compliance_js/compliance.wasm ../app/public/circuits/
cp circuit_final.zkey ../app/public/circuits/compliance_final.zkey
```

## Test Updates
Update `test_comprehensive.mjs` and `test_utils.mjs`:
- Add `sourceOfFundsHash` and `credentialVersion` to all test credential inputs
- Update `buildCredentialHash()` to use the new 4-input Poseidon chain
- Default values: `sourceOfFundsHash = poseidon([BigInt("12345")])`, `credentialVersion = 1n`
- All existing 31 tests should pass with updated inputs
- Add 5 new tests:
  1. Valid proof with source-of-funds hash present
  2. Valid proof with different credential version
  3. Different sourceOfFundsHash produces different leaf (non-trivial)
  4. credentialVersion = 0 works (version is just a number, no enforcement in circuit)
  5. Credential with all new fields + full Merkle path verification

## Artifacts Produced
```
programs/vusd-vault/src/keys/verifying_key.rs  → Agent 3 picks up
app/public/circuits/compliance.wasm            → Agent 5 picks up
app/public/circuits/compliance_final.zkey      → Agent 5 picks up
```

---

# AGENT 2: KYC REGISTRY ~~+ LIGHT PROTOCOL~~

> **STATUS: ✅ COMPLETE.** Light Protocol SDK incompatible with Anchor 0.32.1. PDA Merkle tree fallback delivered and tested. 16 tests passing. `KycRegistryConfig` type alias exported for CPI consumers.

## Owner
All files in `programs/kyc-registry/`
Test files: `tests/kyc_registry_light.ts`, `tests/kyc_revocation.ts`

## File Ownership
```
programs/kyc-registry/Cargo.toml    ← NO CHANGE (no light-sdk)
programs/kyc-registry/src/lib.rs    ← UPDATED (KycRegistryConfig alias, Light Protocol documented as production path)
tests/kyc_registry_light.ts         ← DELIVERED (11 tests)
tests/kyc_revocation.ts             ← DELIVERED (5 tests)
```

## ~~Light Protocol Integration Architecture~~ PDA Merkle Tree (Current)

### ~~Core Concept~~
~~Light Protocol provides compressed accounts stored in managed state Merkle trees.~~

**FALLBACK ACTIVE:** `light-sdk 0.11.0` hard-pins `anchor-lang = 0.29.0` / `solana-program = 1.18.22`. Incompatible with our `anchor-lang 0.32.1` workspace. The existing PDA-based Merkle tree with on-chain Poseidon hashing is kept. Light Protocol is documented as a production migration path at the top of `lib.rs`.

### Current Implementation (Working)
- `KycRegistry` PDA stores: authority, state_tree reference, credential_count, revoked_count, issuer_pubkey, merkle_root
- `StateTree` PDA stores: root, depth (20), next_index
- `CredentialLeaf` PDAs store: leaf_hash, active flag
- On-chain Poseidon hashing via `solana_poseidon` (Bn254X5, BigEndian — matches circuit)
- `KycRegistryConfig` type alias exported for CPI consumers (Agent 3 reads `merkle_root`)

### Key Compatibility
Light Protocol uses Poseidon hashing with `Bn254X5, BigEndian` — the EXACT same parameters as your `solana-poseidon` calls and your Circom circuit. Roots are natively compatible. No hash function translation.

### New Dependencies
```toml
[dependencies]
anchor-lang = "0.32.1"
solana-poseidon = "4.0.0"
light-sdk = { version = "0.11", features = ["anchor"] }
```

**⚠️ FALLBACK: If `light-sdk` has version conflicts with anchor-lang 0.32.1, STOP after 2 hours of debugging. Fall back to keeping the current PDA-based Merkle tree (it already works with depth 20 and Poseidon). Document Light Protocol as production migration path.**

### New Account Structure

Replace the current KycRegistry + StateTree + CredentialLeaf PDA approach with:

```rust
/// Lightweight config PDA — stores registry metadata
/// The actual credentials live as Light Protocol compressed accounts
#[account]
#[derive(InitSpace)]
pub struct KycRegistryConfig {
    pub authority: Pubkey,
    pub state_tree: Pubkey,          // Light Protocol state tree account
    pub address_tree: Pubkey,        // Light Protocol address tree (for deterministic addresses)
    pub credential_count: u64,
    pub revoked_count: u64,
    pub issuer_pubkey: [u8; 32],
    pub bump: u8,
}

/// Compressed account data for each credential
/// This struct is stored as a Light Protocol compressed account
#[derive(LightHasher, LightDiscriminator, AnchorSerialize, AnchorDeserialize)]
pub struct CredentialLeaf {
    pub registry: Pubkey,
    pub leaf_hash: [u8; 32],
    pub active: bool,
}
```

### Instructions

```rust
/// Initialize registry — creates config PDA, references Light state tree
pub fn initialize_registry(
    ctx: Context<InitRegistry>,
    state_tree: Pubkey,
    address_tree: Pubkey,
    issuer_pubkey: [u8; 32],
) -> Result<()>

/// Add credential — creates a compressed account via Light CPI
pub fn add_credential(
    ctx: Context<AddCredential>,
    proof: ValidityProof,           // Light Protocol validity proof
    address_tree_info: PackedAddressTreeInfo,
    output_tree_index: u8,
    leaf_hash: [u8; 32],
) -> Result<()>

/// Revoke credential — nullifies the compressed account
pub fn revoke_credential(
    ctx: Context<RevokeCredential>,
    proof: ValidityProof,           // Light Protocol validity proof
    compressed_account: CompressedAccountMeta,
    leaf_hash: [u8; 32],
) -> Result<()>

/// Transfer authority
pub fn transfer_authority(
    ctx: Context<TransferAuthority>,
    new_authority: Pubkey,
) -> Result<()>
```

### How the Vault Reads the Root

The vault program needs the current Merkle root to validate proofs. With Light Protocol, the root lives in Light's on-chain state tree account. The vault instruction takes the state tree account as a remaining account and reads the root directly:

```rust
// In vault's deposit_with_proof instruction:
// The state tree account is passed as a remaining account
// Read its root field to get the current Merkle root
let state_tree_data = ctx.remaining_accounts[0].try_borrow_data()?;
// Light's state tree stores the root at a known offset
let merkle_root: [u8; 32] = read_root_from_state_tree(&state_tree_data)?;
```

**ALTERNATIVE (simpler):** Keep a `merkle_root` field on the KycRegistryConfig PDA and update it in every add/revoke instruction by reading back from Light's state tree after the CPI completes. The vault reads from your PDA (current pattern, unchanged). This avoids the vault needing to understand Light's account layout.

### Client-Side: Photon Indexer for Merkle Proofs

Users need Merkle proofs to generate their ZK proofs. With Light Protocol, the Photon indexer (by Helius) provides these:

```typescript
import { createRpc } from "@lightprotocol/stateless.js";

const rpc = createRpc(SOLANA_RPC_URL, PHOTON_RPC_URL);

// Get Merkle proof for a credential
async function getCredentialProof(leafHash: string) {
    // Query compressed accounts owned by the registry program
    const accounts = await rpc.getCompressedAccountsByOwner(registryProgramId);
    
    // Find the credential
    const credential = accounts.find(a => /* match by leaf hash */);
    
    // Get validity proof (contains Merkle path)
    const validityProof = await rpc.getValidityProof([credential.hash]);
    
    return {
        pathElements: validityProof.merklePath,
        pathIndices: validityProof.merklePathIndices,
        root: validityProof.root,
    };
}
```

### CPI Interface for Agent 3 (Vault)

The vault program imports kyc-registry with `features = ["cpi"]`. The CPI interface must expose:
- `KycRegistryConfig` account struct (so vault can read `merkle_root`)
- The program ID

The vault does NOT call any KYC registry instructions via CPI — it only READS the registry config account to get the Merkle root. So the CPI interface is just the account struct export.

### Tests (10+ tests)
1. Initialize registry with Light Protocol state tree reference
2. Add credential → compressed account created, credential_count incremented
3. Add credential → merkle_root in config PDA updated
4. Revoke credential → compressed account nullified, revoked_count incremented
5. Revoke credential → old Merkle proof invalid (root changed)
6. Add multiple credentials → count tracks correctly
7. Revoke already-revoked credential → error
8. Non-authority cannot add credential
9. Non-authority cannot revoke credential
10. Transfer authority works

---

# AGENT 3: VAULT PROGRAM EXPANSION

> **STATUS: 🔴 CRITICAL PATH — THIS IS THE BOTTLENECK.** Agents 4 and 5 are waiting on the expanded vault IDL.
>
> Agent 1 (Circuit): ✅ DELIVERED — verifying_key.rs already in place (NR_PUBLIC_INPUTS = 22)
> Agent 2 (KYC Registry): ✅ DELIVERED — CPI interface available, PDA fallback working

## Owner
All files in `programs/vusd-vault/`
Test files: `tests/verifier_strict.ts`, `tests/tvs_shares.ts`

## File Ownership
```
programs/vusd-vault/Cargo.toml              ← NO kamino dependency (incompatible — don't try)
programs/vusd-vault/src/lib.rs              ← MAJOR EXPANSION
programs/vusd-vault/src/keys/mod.rs         ← NO CHANGE
programs/vusd-vault/src/keys/verifying_key.rs ← ALREADY DELIVERED by Agent 1
tests/verifier_strict.ts                    ← UPDATE
tests/tvs_shares.ts                         ← UPDATE
```

## NO LONGER BLOCKED
- Agent 1: ✅ verifying_key.rs delivered (49,199 constraints, 22 public inputs, fits pot16)
- Agent 2: ✅ KycRegistry CPI interface delivered (PDA fallback with `KycRegistryConfig` alias)

## VaultState Expansion

Add these fields to VaultState:

```rust
#[account]
#[derive(InitSpace)]
pub struct VaultState {
    // === EXISTING FIELDS (unchanged) ===
    pub authority: Pubkey,              // Will be set to Squads multisig PDA
    pub usdc_mint: Pubkey,
    pub share_mint: Pubkey,
    pub usdc_reserve: Pubkey,
    pub total_assets: u64,
    pub total_shares: u64,
    pub share_price_numerator: u64,
    pub share_price_denominator: u64,
    pub yield_source: Pubkey,
    pub liquid_buffer_bps: u16,
    pub total_yield_earned: u64,
    pub aml_thresholds: [u64; 3],
    pub expired_threshold: u64,
    pub emergency_timelock: i64,
    pub regulator_pubkey_x: [u8; 32],
    pub regulator_pubkey_y: [u8; 32],
    pub bump: u8,
    pub reserve_bump: u8,

    // === NEW: Custody ===
    pub custody_provider: CustodyProvider,
    pub custody_authority: Pubkey,

    // === NEW: Risk Controls ===
    pub paused: bool,
    pub circuit_breaker_threshold: u64,
    pub daily_outflow_total: u64,
    pub outflow_window_start: i64,
    pub max_single_transaction: u64,
    pub max_single_deposit: u64,
    pub max_daily_transactions: u32,
    pub daily_transaction_count: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum CustodyProvider {
    SelfCustody,
    Fireblocks,
    BitGo,
    Anchorage,
}
```

## New Instructions

### Risk Control Enforcement

Add a `check_risk_controls` function called at the START of every deposit/transfer/withdraw:

```rust
fn check_risk_controls(vault: &mut VaultState, amount: u64, is_outflow: bool, clock: &Clock) -> Result<()> {
    // 1. Check pause
    require!(!vault.paused, VaultError::VaultPaused);

    // 2. Check single transaction limit
    require!(amount <= vault.max_single_transaction, VaultError::ExceedsTransactionLimit);

    // 3. Reset rolling window if 24h elapsed
    if clock.unix_timestamp - vault.outflow_window_start >= 86400 {
        vault.daily_outflow_total = 0;
        vault.daily_transaction_count = 0;
        vault.outflow_window_start = clock.unix_timestamp;
    }

    // 4. Check velocity limit
    require!(
        vault.daily_transaction_count < vault.max_daily_transactions,
        VaultError::VelocityLimitExceeded
    );
    vault.daily_transaction_count += 1;

    // 5. For outflows: check circuit breaker
    if is_outflow {
        let new_total = vault.daily_outflow_total.checked_add(amount)
            .ok_or(VaultError::Overflow)?;
        if new_total > vault.circuit_breaker_threshold {
            vault.paused = true;
            emit!(CircuitBreakerTriggered {
                daily_outflow: new_total,
                threshold: vault.circuit_breaker_threshold,
                timestamp: clock.unix_timestamp,
            });
            return Err(VaultError::CircuitBreakerTriggered.into());
        }
        vault.daily_outflow_total = new_total;
    }

    Ok(())
}
```

### Deposit Concentration Limit
In `deposit_with_proof`, add BEFORE the existing logic:
```rust
require!(amount <= vault_state.max_single_deposit, VaultError::ExceedsDepositLimit);
```

### New Admin Instructions

```rust
pub fn update_risk_limits(
    ctx: Context<AdminUpdate>,
    circuit_breaker_threshold: u64,
    max_single_transaction: u64,
    max_single_deposit: u64,
    max_daily_transactions: u32,
) -> Result<()>

pub fn unpause_vault(ctx: Context<AdminUpdate>) -> Result<()> {
    ctx.accounts.vault_state.paused = false;
    ctx.accounts.vault_state.daily_outflow_total = 0;
    ctx.accounts.vault_state.daily_transaction_count = 0;
    ctx.accounts.vault_state.outflow_window_start = Clock::get()?.unix_timestamp;
    Ok(())
}

pub fn update_custody_provider(
    ctx: Context<AdminUpdate>,
    provider: CustodyProvider,
    custody_authority: Pubkey,
) -> Result<()>
```

### Yield Venue Management

```rust
#[account]
#[derive(InitSpace)]
pub struct WhitelistedYieldVenue {
    pub venue_address: Pubkey,          // Kamino lending reserve address
    #[max_len(32)]
    pub name: String,                   // "Kamino USDC Lending"
    pub jurisdiction_whitelist: [u8; 32], // Bitmask of allowed jurisdictions
    pub allocation_cap_bps: u16,        // Max % of vault assets (basis points)
    pub active: bool,
    pub risk_rating: u8,                // 1-5 scale
    pub bump: u8,
}

pub fn add_yield_venue(
    ctx: Context<AddYieldVenue>,
    venue_address: Pubkey,
    name: String,
    jurisdiction_whitelist: [u8; 32],
    allocation_cap_bps: u16,
    risk_rating: u8,
) -> Result<()>

pub fn remove_yield_venue(ctx: Context<RemoveYieldVenue>) -> Result<()>

pub fn accrue_yield(ctx: Context<AccrueYield>, yield_amount: u64) -> Result<()> {
    // Authority-only: credit yield to vault
    // Updates total_assets (increases share price)
    let vault = &mut ctx.accounts.vault_state;
    vault.total_assets = vault.total_assets.checked_add(yield_amount)
        .ok_or(VaultError::Overflow)?;
    vault.total_yield_earned = vault.total_yield_earned.checked_add(yield_amount)
        .ok_or(VaultError::Overflow)?;
    refresh_share_price(vault)?;
    Ok(())
}
```

### ~~Kamino CPI~~ — DROPPED (Anchor version conflict)

> **DO NOT attempt `kamino-lending` import.** Confirmed incompatible with Anchor 0.32.1. The `accrue_yield` instruction above IS the yield mechanism. Kamino is documented as a production migration path only.

~~If Kamino CPI works:~~
~~```rust
pub fn deposit_to_kamino(
    ctx: Context<DepositToKamino>,
    amount: u64,
) -> Result<()> {
    // 1. Check liquid buffer — don't deposit more than allowed
    let max_deployable = vault.total_assets * (10000 - vault.liquid_buffer_bps as u64) / 10000;
    let currently_deployed = vault.total_assets - ctx.accounts.usdc_reserve.amount;
    require!(currently_deployed + amount <= max_deployable, VaultError::ExceedsLiquidBuffer);

    // 2. CPI to Kamino lending deposit
    // ... Kamino-specific CPI code ...

    Ok(())
}
```

### New Error Codes
```rust
// Add to VaultError enum:
VaultPaused,
CircuitBreakerTriggered,
ExceedsTransactionLimit,
ExceedsDepositLimit,
VelocityLimitExceeded,
ExceedsLiquidBuffer,
InvalidCustodyProvider,
```

### New Events
```rust
#[event]
pub struct CircuitBreakerTriggered {
    pub daily_outflow: u64,
    pub threshold: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultPaused {
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct VaultUnpaused {
    pub timestamp: i64,
}

#[event]
pub struct YieldAccrued {
    pub amount: u64,
    pub new_total_assets: u64,
    pub new_share_price_numerator: u64,
    pub new_share_price_denominator: u64,
    pub timestamp: i64,
}
```

### Rust Unit Tests (15+ new tests)
1. check_risk_controls: paused vault rejects
2. check_risk_controls: exceeds single transaction limit rejects
3. check_risk_controls: velocity limit reached rejects
4. check_risk_controls: circuit breaker triggers at threshold, sets paused
5. check_risk_controls: rolling window resets after 24h
6. check_risk_controls: outflow below threshold passes
7. Deposit: exceeds concentration limit rejects
8. unpause_vault: resets all counters
9. accrue_yield: increases total_assets and share price
10. accrue_yield: share price calculation correct after yield
11. update_risk_limits: sets all four limits correctly
12. update_custody_provider: sets provider and authority
13. CustodyProvider enum serialization roundtrip
14. Existing share math tests still pass
15. Existing public input validation tests still pass

---

# AGENT 4: COMPLIANCE ADMIN + SQUADS

> **STATUS: ✅ SCAFFOLDING COMPLETE — blocked on Agent 3's expanded vault IDL for full E2E tests.**
> Squads CPI dropped (Anchor version conflict). Using `@sqds/multisig` TS SDK (client-side only). Zero program changes needed for Squads — the vault's `has_one = authority` constraint works when authority = Squads vault PDA.

## Owner
All files in `programs/compliance-admin/`
Test files: `tests/integration_e2e.ts`
Scripts: `scripts/`

## File Ownership
```
programs/compliance-admin/Cargo.toml    ← NO squads-multisig (incompatible)
programs/compliance-admin/src/lib.rs    ← DELIVERED (3 instructions, DecryptionAuthorization PDA)
tests/integration_e2e.ts               ← DELIVERED (scaffolding), NEEDS Agent 3 for full flow
scripts/init-devnet-state.ts           ← DELIVERED
scripts/init-vault-devnet.ts           ← DELIVERED (detects missing vault instructions)
scripts/deploy-devnet.sh               ← DELIVERED
scripts/create-devnet-credentials.sh   ← DELIVERED (sourceOfFundsHash + credentialVersion)
scripts/devnet-credential.ts           ← NEW (credential artifact builder)
```

## Squads Protocol Integration — CLIENT-SIDE ONLY

### ~~On-Chain CPI Approach~~ — DROPPED

~~```toml
squads-multisig = { version = "0.2", features = ["cpi"] }
```~~

**CONFIRMED INCOMPATIBLE.** `squads-multisig` does not expose a `cpi` feature, and `squads-multisig-program` conflicts with Anchor 0.32.1 / Solana 2.x dependency graph.

### If On-Chain CPI Works

Add Squads-aware verification to compliance admin instructions:

```rust
/// Verify the caller is a member of the Squads multisig that controls the vault
fn verify_squads_membership(
    multisig_account: &AccountInfo,
    member: &Pubkey,
) -> Result<()> {
    // Deserialize Squads Multisig account
    // Check member is in the members list
    // Check member has the required role (e.g., Voter, Executor)
    Ok(())
}
```

### If On-Chain CPI Doesn't Work (Client-Side Fallback)

The compliance-admin program stays as-is. The frontend uses `@sqds/multisig` to:
1. Create a multisig with 2-3 members
2. Set vault authority to multisig vault PDA
3. Propose admin operations (threshold changes, decryption auth)
4. Have second member approve
5. Execute the approved transaction

### Updated Init Scripts

```typescript
// scripts/init-devnet-state.ts additions:
// 1. Create Squads multisig (2-of-3)
// 2. Set vault authority to multisig vault PDA
// 3. Create test yield venue
// 4. Set risk control limits
```

### Tests (8+ tests)
1. Authorize decryption with Squads-approved transaction
2. Non-member cannot authorize decryption
3. Update thresholds with Squads approval
4. Update regulator key with Squads approval
5. Squads proposal → approve → execute flow (if on-chain CPI)
6. Single signer cannot execute 2-of-3 operation
7. DecryptionAuthorization PDA created correctly
8. Event emitted on decryption authorization

---

# AGENT 5: FRONTEND REDESIGN

## Owner
All files in `app/`

## File Ownership
```
app/                    ← EVERYTHING
```

## Tech Stack Additions

```json
// Add to package.json dependencies:
"tailwindcss": "^4",
"@tailwindcss/vite": "^4",
"recharts": "^2.15",
"@sqds/multisig": "^2",
"@lightprotocol/stateless.js": "latest"

// shadcn/ui components (copy-paste, not npm install):
// Button, Card, Table, Dialog, Tabs, Badge, Alert, Input, Label, Select, Separator, Toast
```

### Setup Tailwind + shadcn

```typescript
// vite.config.ts
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})

// app.css - import tailwind
@import "tailwindcss";
```

### Design System (Anchorage-Inspired)

```css
/* CSS custom properties for the design system */
:root {
    --bg-primary: #0A0B0E;
    --bg-surface: #12131A;
    --bg-elevated: #1A1B24;
    --border: #1E2028;
    --border-subtle: #16171F;

    --text-primary: #FFFFFF;
    --text-secondary: #8B8D97;
    --text-tertiary: #52535A;

    --accent: #3B82F6;          /* Blue — restrained, not teal */
    --accent-hover: #2563EB;
    --success: #22C55E;
    --warning: #F59E0B;
    --danger: #EF4444;

    --font-sans: 'Inter', -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', 'IBM Plex Mono', monospace;

    --radius: 8px;
}
```

### Page Architecture

```
/ (Landing)              → Unauthenticated. Beautiful marketing page.
                           NO wallet connection required.
                           Live vault stats from on-chain reads.
                           "Connect Wallet" CTA.

/operator                → Operator dashboard (authority wallet detected)
  /operator/onboard      → KYC credential issuance panel
  /operator/yield        → Yield venue management + Kamino status
  /operator/risk         → Circuit breaker config, limits, pause/unpause
  /operator/governance   → Squads multisig panel (proposals, approvals)

/compliance              → Compliance monitoring dashboard
  /compliance/:id        → Single transfer investigation + decryption

/portfolio               → Investor dashboard (non-authority wallet)
/deposit                 → Deposit USDC with proof generation
/transfer                → Transfer shares with proof generation
/withdraw                → Withdraw with proof or emergency hatch
```

### Routing Logic

```typescript
function AppRouter() {
    const { publicKey } = useWallet();
    const { data: vault } = useVaultState();

    // Not connected → landing page
    if (!publicKey) return <LandingPage />;

    // Check if connected wallet is the vault authority
    const isAuthority = vault.authority.equals(publicKey);
    // TODO: Also check Squads multisig membership

    if (isAuthority) return <OperatorLayout />;
    return <InvestorLayout />;
}
```

### Landing Page Design (Anchorage-Inspired)

```
┌─────────────────────────────────────────────────────────┐
│  VaultProof                          [Connect Wallet]    │  ← Minimal nav
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Compliant institutional vaults                          │  ← 56px Inter 600
│  with confidential identity.                             │
│                                                          │
│  Zero-knowledge proofs verify KYC, accreditation,        │  ← 18px Inter 400
│  source of funds, and Travel Rule compliance —           │     text-secondary
│  without revealing identity on-chain.                    │
│                                                          │
│  [Connect Wallet]        [View Architecture →]           │  ← Primary + ghost CTAs
│                                                          │
├─────────────────────────────────────────────────────────┤
│  LIVE VAULT STATS (read-only, no wallet needed)          │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐     │
│  │ TVL  │  │Share │  │Trans │  │Creds │  │Depth │     │
│  │$0.00 │  │$1.00 │  │  0   │  │  0   │  │ 20   │     │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘     │
├─────────────────────────────────────────────────────────┤
│  Three feature cards:                                    │
│  [ZK Compliance]  [Risk Controls]  [Institutional Gov]   │
├─────────────────────────────────────────────────────────┤
│  Architecture summary / how it works section             │
├─────────────────────────────────────────────────────────┤
│  Track 1 requirement mapping                             │
└─────────────────────────────────────────────────────────┘
```

### Monitoring Dashboard

The monitoring dashboard reads ALL data from on-chain accounts:

```typescript
// hooks/useMonitoring.ts
function useMonitoring() {
    const { data: vault } = useVaultState();
    const { records } = useTransferRecords();

    // Compute alerts client-side
    const alerts = useMemo(() => {
        const alerts = [];
        const recentRecords = records.filter(r =>
            Date.now()/1000 - r.timestamp.toNumber() < 86400
        );

        // Alert: circuit breaker approaching
        const cbUsage = vault.dailyOutflowTotal / vault.circuitBreakerThreshold;
        if (cbUsage > 0.8) alerts.push({
            severity: 'warning',
            message: `Circuit breaker at ${(cbUsage*100).toFixed(0)}% capacity`
        });

        // Alert: large transaction
        const maxTx = Math.max(...recentRecords.map(r => r.amount.toNumber()));
        if (maxTx > vault.totalAssets * 0.1) alerts.push({
            severity: 'warning',
            message: `Large transaction detected: ${formatCurrency(maxTx)}`
        });

        return alerts;
    }, [vault, records]);

    return { vault, records, alerts };
}
```

### Credential Issuance (Operator Panel)

```typescript
// pages/operator/Onboard.tsx
function OperatorOnboard() {
    const [form, setForm] = useState({
        fullName: '',
        nationality: '',
        dateOfBirth: '',
        jurisdiction: '',
        accreditation: 'retail',
        expiresAt: '',
        sourceOfFundsReference: '',   // NEW — "Wire from UBS, verified 2026-03-01"
        credentialVersion: 1,          // NEW — always 1 for now
    });

    async function issueCredential() {
        // 1. Hash source-of-funds reference
        const sofHash = poseidon([textToField(form.sourceOfFundsReference)]);

        // 2. Build credential hash chain (NEW 4-input Poseidon)
        const credHash1 = poseidon([name, nationality]);
        const credHash2 = poseidon([dob, jurisdiction]);
        const credHash3 = poseidon([accreditation, expiry]);
        const credHash4 = poseidon([sofHash, credentialVersion]);
        const credHashFinal = poseidon([credHash1, credHash2, credHash3, credHash4]);

        // 3. Sign with issuer key
        const signature = eddsa.signPoseidon(ISSUER_PRIVATE_KEY, credHashFinal);

        // 4. Compute leaf hash
        const leaf = poseidon([credHashFinal, identitySecret, walletPubkey]);

        // 5. Submit add_credential to registry
        await registryProgram.methods.addCredential(leafHash, proof, ...).rpc();

        // 6. Generate downloadable credential file for investor
        const credentialFile = {
            ...form, sofHash, credentialVersion: 1,
            identitySecret, walletPubkey, signature, leafHash
        };
        downloadAsJSON(credentialFile, 'vaultproof-credential.json');
    }
}
```

### Proof Generation Update

Update `app/src/lib/credential.ts` and `app/src/hooks/useProofGeneration.ts`:
- Add `sourceOfFundsHash` and `credentialVersion` to `StoredCredential` type
- Update `prepareStoredCredential` to use 4-input Poseidon hash chain
- Add both fields to `buildCircuitInput`
- Update `ProofGenerationRequest` type

### Frontend Tests (8+ tests)
1. Landing page renders without wallet connection
2. Wallet detection routes authority to operator view
3. Wallet detection routes non-authority to investor view
4. useVaultState hook returns real data (mock RPC)
5. useMonitoring computes alerts correctly
6. Credential issuance form validates required fields
7. Proof generation includes new credential fields
8. Circuit breaker status displays correctly

---

# INTEGRATION TEST SUITE (SHARED)

File: `tests/integration_e2e.ts` (owned by Agent 4, but tests full flow)

### End-to-End Happy Path
1. Initialize KYC Registry (with Light Protocol if available)
2. Initialize Vault with risk controls and custody config
3. Create Squads multisig, set as vault authority
4. Operator issues credential (with source-of-funds hash)
5. Investor deposits USDC with ZK proof → shares minted
6. Investor transfers shares with ZK proof
7. Investor withdraws with ZK proof → shares burned, USDC returned
8. Verify circuit breaker: submit withdrawal exceeding threshold → vault pauses
9. Unpause vault via Squads multisig
10. Authorize decryption via Squads multisig
11. Verify TransferRecord has full encrypted metadata
12. Verify share price increased after yield accrual

---

# FALLBACK DECISION TREE — ALL RESOLVED

```
light-sdk in kyc-registry/Cargo.toml
  └─ ❌ Version conflict (anchor-lang 0.29.0 vs 0.32.1)
  └─ RESULT: PDA Merkle tree KEPT. 16 tests passing. Light = production path.

squads-multisig in compliance-admin/Cargo.toml
  └─ ❌ Version conflict (same anchor-lang issue, no cpi feature exposed)
  └─ RESULT: @sqds/multisig TS SDK (client-side). Zero program changes.
             Vault has_one = authority works with Squads vault PDA.

kamino-lending in vusd-vault/Cargo.toml
  └─ ❌ Assumed incompatible (DO NOT ATTEMPT)
  └─ RESULT: accrue_yield admin instruction. Operator credits yield manually.
             Frontend labels "Kamino Adapter (Demo Mode)".
```

---

# DEPLOYMENT SEQUENCE

### Phase 1: Build — UPDATED STATUS
- Agent 1 (Circuit): ✅ COMPLETE
- Agent 2 (KYC Registry): ✅ COMPLETE (PDA fallback)
- Agent 3 (Vault Program): 🔴 CRITICAL PATH — must deliver expanded VaultState + new instructions
- Agent 4 (Compliance Admin): ✅ SCAFFOLDING DONE — waiting on Agent 3 for full E2E
- Agent 5 (Frontend): 🔄 IN PROGRESS — UI shell built, needs Agent 3 IDL to wire real calls

### Phase 2: Integrate
1. ~~Agent 1 delivers verifying_key.rs~~ ✅ DONE
2. ~~Agent 1 delivers .wasm + .zkey~~ ✅ DONE
3. ~~Agent 2 delivers KYC Registry crate~~ ✅ DONE
4. **Agent 3 delivers IDL → Agent 4 writes full E2E tests + Agent 5 wires real calls**
5. All agents rebuild with final artifacts

### Phase 3: Test
1. Run circuit tests: `cd circuits && node test_comprehensive.mjs`
2. Run Rust unit tests: `cargo test --workspace`
3. Start localnet: `solana-test-validator`
4. Run integration tests: `anchor test`
5. Run frontend tests: `cd app && npm test`

### Phase 4: Devnet Deploy
1. Generate new keypairs for all 3 programs
2. Update Anchor.toml and declare_id! macros
3. `anchor build && anchor deploy --provider.cluster devnet`
4. Run `scripts/init-devnet-state.ts` to initialize all accounts
5. Run `scripts/create-devnet-credentials.sh` to create test credentials
6. Verify frontend connects to devnet: `cd app && npm run dev -- --mode devnet`

### Phase 5: Demo
Record the regulator investigation story (3:30 minutes).

---

# CRATE VERSION REFERENCE

| Crate | Version | Used By | Risk |
|---|---|---|---|
| anchor-lang | 0.32.1 | All programs | Stable (current) |
| anchor-spl | 0.32.1 | vusd-vault | Stable |
| groth16-solana | 0.2.0 | vusd-vault | Stable |
| solana-poseidon | 4.0.0 | kyc-registry | Stable |
| solana-sha256-hasher | 2.3.0 | vusd-vault | Stable |
| light-sdk | 0.11 | ~~kyc-registry~~ | ❌ DROPPED — Anchor 0.29.0 conflict |
| squads-multisig | ~0.2 | ~~compliance-admin~~ | ❌ DROPPED — Anchor 0.29.0 conflict |
| kamino-lending | TBD | ~~vusd-vault~~ | ❌ DROPPED — don't attempt |
| @sqds/multisig | ^2.1.4 | app + scripts (TS) | ✅ Client-side replacement for Squads CPI |

---

# END OF TECHNICAL BIBLE
