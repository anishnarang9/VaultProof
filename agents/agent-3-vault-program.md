# AGENT 3: VAULT PROGRAM EXPANSION — Codex Prompt

> **YOU ARE THE CRITICAL PATH. Agents 4 and 5 are DONE and WAITING on you. No blockers remain — Agent 1 delivered the verifying key, Agent 2 delivered the KYC Registry CPI. Ship this.**

## Your Role
You are Agent 3, responsible for expanding the vault program (`programs/vusd-vault/`) with custody provider abstraction, risk controls (circuit breaker, concentration limits, velocity checks), yield venue management, and new admin instructions. You own all files in `programs/vusd-vault/` and the test files `tests/verifier_strict.ts` and `tests/tvs_shares.ts`. Do NOT modify files outside your ownership boundary.

## Project Context
VaultProof is a ZK compliance engine for institutional DeFi vaults on Solana. The vault program handles deposits, transfers, and withdrawals — all gated by Groth16 ZK proof verification. The revamp adds institutional-grade risk controls, custody integration abstraction, and yield governance to satisfy Track 1 hackathon requirements.

Read `vaultproof-product-revamp.md`, `vaultproof-technical-bible.md`, and `agent-coordination-update-v2.md` at the project root for full context.

## Coordination
Log every change you make in `REVAMP-COORDINATION.md` under the Agent 3 section. Mark artifacts as delivered when done.

## CRITICAL CONTEXT — What Already Happened

| Agent | Status | What They Delivered |
|---|---|---|
| Agent 1 (Circuit) | ✅ COMPLETE | `verifying_key.rs` with NR_PUBLIC_INPUTS = 22, 49,199 constraints. Already in `programs/vusd-vault/src/keys/verifying_key.rs`. DO NOT overwrite. |
| Agent 2 (KYC Registry) | ✅ COMPLETE | PDA Merkle tree fallback (Light Protocol incompatible). Exports `KycRegistryConfig` type alias. 16 tests passing. |
| Agent 4 (Compliance Admin) | ✅ SCAFFOLDING | Scripts + E2E test skeleton delivered. **BLOCKED ON YOU** — needs `update_risk_limits`, `unpause_vault`, `update_custody_provider`, `add_yield_venue`, `accrue_yield` instructions. |
| Agent 5 (Frontend) | ✅ COMPLETE ON STUBS | Full Anchorage-inspired UI with role-based routing, 11 pages, 8 hooks, proof generation with `sourceOfFundsHash` + `credentialVersion`. **BLOCKED ON YOU** — needs the expanded vault IDL for real instruction wiring. |

## WHAT NOT TO ADD — CONFIRMED INCOMPATIBLE CRATES
- **DO NOT** add `kamino-lending` to Cargo.toml — Anchor 0.32.1 incompatible. `accrue_yield` admin instruction IS the yield mechanism.
- **DO NOT** add `light-sdk` — Anchor 0.32.1 incompatible.
- **DO NOT** add `squads-multisig` — Anchor 0.32.1 incompatible. Squads governance is handled client-side via `@sqds/multisig` TS SDK.

## Known Build Issue
Agent 2 noted a workspace-wide dependency resolution issue: `anchor-spl v0.32.1` → `spl-token-2022` → `solana-zk-sdk` → `solana-instruction = 2.2.1` conflicts with `anchor-lang v0.32.1` selecting `solana-instruction = 2.3.3`. If you hit this, try `cargo update` to resolve, or pin versions in workspace `Cargo.toml`. This is NOT caused by your changes — it's a pre-existing workspace issue.

---

## WHAT YOU MUST DO

### Task 1: Expand VaultState with new fields

Add these fields to the existing `VaultState` struct in `programs/vusd-vault/src/lib.rs`:

```rust
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
```

Add the `CustodyProvider` enum:
```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum CustodyProvider {
    SelfCustody,
    Fireblocks,
    BitGo,
    Anchorage,
}
```

Update `InitSpace` derive and space calculations for VaultState.

Update `initialize_vault` to set defaults for all new fields:
- `custody_provider: CustodyProvider::SelfCustody`
- `custody_authority: ctx.accounts.authority.key()`
- `paused: false`
- `circuit_breaker_threshold: u64::MAX`
- `daily_outflow_total: 0`
- `outflow_window_start: Clock::get()?.unix_timestamp`
- `max_single_transaction: u64::MAX`
- `max_single_deposit: u64::MAX`
- `max_daily_transactions: u32::MAX`
- `daily_transaction_count: 0`

### Task 2: Implement `check_risk_controls()` function

Add this function and call it at the START of every `deposit_with_proof`, `transfer_with_proof`, and `withdraw_with_proof`:

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

Add deposit concentration limit in `deposit_with_proof` BEFORE existing logic:
```rust
require!(amount <= vault_state.max_single_deposit, VaultError::ExceedsDepositLimit);
```

### Task 3: Add new admin instructions

These are the 5 instructions that Agent 4 and Agent 5 are waiting on:

```rust
pub fn update_risk_limits(
    ctx: Context<AdminUpdate>,
    circuit_breaker_threshold: u64,
    max_single_transaction: u64,
    max_single_deposit: u64,
    max_daily_transactions: u32,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault_state;
    vault.circuit_breaker_threshold = circuit_breaker_threshold;
    vault.max_single_transaction = max_single_transaction;
    vault.max_single_deposit = max_single_deposit;
    vault.max_daily_transactions = max_daily_transactions;
    Ok(())
}

pub fn unpause_vault(ctx: Context<AdminUpdate>) -> Result<()> {
    let vault = &mut ctx.accounts.vault_state;
    vault.paused = false;
    vault.daily_outflow_total = 0;
    vault.daily_transaction_count = 0;
    vault.outflow_window_start = Clock::get()?.unix_timestamp;
    Ok(())
}

pub fn update_custody_provider(
    ctx: Context<AdminUpdate>,
    provider: CustodyProvider,
    custody_authority: Pubkey,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault_state;
    vault.custody_provider = provider;
    vault.custody_authority = custody_authority;
    Ok(())
}
```

Reuse the existing admin context pattern (authority signer + vault_state mutable). If no `AdminUpdate` context exists, create one:
```rust
#[derive(Accounts)]
pub struct AdminUpdate<'info> {
    #[account(mut, has_one = authority)]
    pub vault_state: Account<'info, VaultState>,
    pub authority: Signer<'info>,
}
```

### Task 4: Add yield venue management

```rust
#[account]
#[derive(InitSpace)]
pub struct WhitelistedYieldVenue {
    pub venue_address: Pubkey,
    #[max_len(32)]
    pub name: String,
    pub jurisdiction_whitelist: [u8; 32],
    pub allocation_cap_bps: u16,
    pub active: bool,
    pub risk_rating: u8,
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
    let vault = &mut ctx.accounts.vault_state;
    vault.total_assets = vault.total_assets.checked_add(yield_amount)
        .ok_or(VaultError::Overflow)?;
    vault.total_yield_earned = vault.total_yield_earned.checked_add(yield_amount)
        .ok_or(VaultError::Overflow)?;
    refresh_share_price(vault)?;
    emit!(YieldAccrued {
        amount: yield_amount,
        new_total_assets: vault.total_assets,
        new_share_price_numerator: vault.share_price_numerator,
        new_share_price_denominator: vault.share_price_denominator,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
```

**NO Kamino CPI. Do NOT add kamino-lending to Cargo.toml. The `accrue_yield` instruction IS the complete yield mechanism.**

### Task 5: Add new error codes

Add to the existing `VaultError` enum:
```rust
#[msg("Vault is paused")]
VaultPaused,
#[msg("Circuit breaker triggered")]
CircuitBreakerTriggered,
#[msg("Exceeds single transaction limit")]
ExceedsTransactionLimit,
#[msg("Exceeds deposit concentration limit")]
ExceedsDepositLimit,
#[msg("Velocity limit exceeded")]
VelocityLimitExceeded,
#[msg("Exceeds liquid buffer")]
ExceedsLiquidBuffer,
#[msg("Invalid custody provider")]
InvalidCustodyProvider,
#[msg("Arithmetic overflow")]
Overflow,
```

### Task 6: Add new events

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

### Task 7: Write Rust unit tests

Add 15+ `#[cfg(test)]` unit tests in `lib.rs`:

1. `check_risk_controls`: paused vault rejects with `VaultPaused`
2. `check_risk_controls`: exceeds single transaction limit rejects
3. `check_risk_controls`: velocity limit reached rejects
4. `check_risk_controls`: circuit breaker triggers at threshold, sets `paused = true`
5. `check_risk_controls`: rolling window resets after 24h
6. `check_risk_controls`: outflow below threshold passes
7. `check_risk_controls`: non-outflow (deposit) doesn't check circuit breaker
8. Deposit: exceeds concentration limit rejects
9. `unpause_vault`: resets all counters
10. `accrue_yield`: increases `total_assets` and share price
11. `accrue_yield`: share price calculation correct after yield
12. `update_risk_limits`: sets all four limits correctly
13. `update_custody_provider`: sets provider and authority
14. `CustodyProvider` enum serialization roundtrip
15. Existing share math tests still pass with new fields

### Task 8: Build and verify

```bash
anchor build -p vusd-vault
cargo test -p vusd-vault
```

If the workspace-wide `solana-instruction` conflict blocks `anchor build`, try:
1. `cargo update` to let resolver pick compatible versions
2. If that fails, add explicit version pinning in workspace `Cargo.toml`
3. As a last resort, verify with `cargo check -p vusd-vault` and note the blocker in COORDINATION

---

## CURRENT STATE OF THE CODE

`programs/vusd-vault/src/lib.rs` is 1,520 lines with:
- VaultState: 18 fields (authority, usdc_mint, share_mint, usdc_reserve, total_assets, total_shares, share_price_numerator/denominator, yield_source, liquid_buffer_bps, total_yield_earned, aml_thresholds, expired_threshold, emergency_timelock, regulator_pubkey_x/y, bump, reserve_bump)
- ProofBuffer: stores Groth16 proof data
- TransferRecord: proof_hash, transfer_type, amount, timestamp, encrypted_metadata, decryption_authorized, signer
- EmergencyWithdrawal: requester, stealth_account, amount, request_timestamp, executed
- Instructions: initialize_vault, store_proof_data, deposit_with_proof, transfer_with_proof, withdraw_with_proof, request_emergency_withdrawal, execute_emergency_withdrawal, update_aml_thresholds, update_regulator_key, update_emergency_timelock, mark_decryption_authorized
- NUM_PUBLIC_INPUTS = NR_PUBLIC_INPUTS (22, from verifying_key.rs — already delivered by Agent 1)

## FILE OWNERSHIP

```
programs/vusd-vault/Cargo.toml              ← MINOR (NO new external crates)
programs/vusd-vault/src/lib.rs              ← MAJOR EXPANSION
programs/vusd-vault/src/keys/mod.rs         ← NO CHANGE
programs/vusd-vault/src/keys/verifying_key.rs ← DO NOT TOUCH (Agent 1 delivered)
tests/verifier_strict.ts                    ← UPDATE
tests/tvs_shares.ts                         ← UPDATE
```

## DONE CRITERIA
- [ ] VaultState expanded with custody + risk control fields (8 new fields)
- [ ] `CustodyProvider` enum defined
- [ ] `check_risk_controls()` implemented and called in deposit_with_proof, transfer_with_proof, withdraw_with_proof
- [ ] Deposit concentration limit enforced
- [ ] 5 new admin instructions: `update_risk_limits`, `unpause_vault`, `update_custody_provider`, `add_yield_venue`, `remove_yield_venue`
- [ ] 1 new yield instruction: `accrue_yield`
- [ ] `WhitelistedYieldVenue` PDA account defined
- [ ] New error codes added (8 new)
- [ ] New events added (CircuitBreakerTriggered, VaultPaused, VaultUnpaused, YieldAccrued)
- [ ] 15+ Rust unit tests passing
- [ ] `anchor build -p vusd-vault` succeeds (or `cargo check` with blocker noted)
- [ ] `REVAMP-COORDINATION.md` updated with all changes and artifacts marked delivered
