use anchor_lang::prelude::*;
#[cfg(feature = "idl-build")]
use anchor_lang::{Discriminator, IdlBuild};
use anchor_spl::token_interface::{
    self, Burn, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};
use groth16_solana::groth16::Groth16Verifier;
use solana_sha256_hasher::hashv;

pub mod keys;
use keys::verifying_key::{get_verifying_key, NR_PUBLIC_INPUTS};

declare_id!("CUxwkHjKjGyKa5H1qEQySw98yKn33RZFxc9TbVgU6rdu");

pub const NUM_PUBLIC_INPUTS: usize = NR_PUBLIC_INPUTS;
pub const ENCRYPTED_METADATA_START_INDEX: usize = 10;
pub const ENCRYPTED_METADATA_PUBLIC_INPUTS: usize =
    NUM_PUBLIC_INPUTS - ENCRYPTED_METADATA_START_INDEX;
pub const ENCRYPTED_METADATA_BYTES: usize = ENCRYPTED_METADATA_PUBLIC_INPUTS * 32;

pub const DEFAULT_RETAIL_THRESHOLD: u64 = 10_000_000_000;
pub const DEFAULT_ACCREDITED_THRESHOLD: u64 = 1_000_000_000_000;
pub const DEFAULT_INSTITUTIONAL_THRESHOLD: u64 = u64::MAX;
pub const DEFAULT_EXPIRED_THRESHOLD: u64 = 1_000_000_000;

pub const DEFAULT_TIMELOCK: i64 = 259_200;
pub const USDC_DECIMALS: u8 = 6;
pub const DEFAULT_MAX_ORACLE_STALENESS: i64 = 86_400; // 24 hours
pub const DEFAULT_RISK_THRESHOLD: u8 = 70; // 0-100 scale

fn compute_proof_hash(proof_a: &[u8; 64], proof_b: &[u8; 128], proof_c: &[u8; 64]) -> [u8; 32] {
    hashv(&[proof_a.as_slice(), proof_b.as_slice(), proof_c.as_slice()]).to_bytes()
}

fn negate_proof_a(proof_a: &[u8; 64]) -> [u8; 64] {
    let field_prime: [u8; 32] = [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58,
        0x5d, 0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c,
        0xfd, 0x47,
    ];

    let mut result = [0u8; 64];
    result[..32].copy_from_slice(&proof_a[..32]);

    let y = &proof_a[32..64];
    if y.iter().all(|&byte| byte == 0) {
        result[32..64].copy_from_slice(y);
        return result;
    }

    let mut borrow: u16 = 0;
    for index in (0..32).rev() {
        let diff = (field_prime[index] as u16)
            .wrapping_sub(y[index] as u16)
            .wrapping_sub(borrow);
        if diff > 255 {
            result[32 + index] = diff.wrapping_add(256) as u8;
            borrow = 1;
        } else {
            result[32 + index] = diff as u8;
            borrow = 0;
        }
    }

    result
}

fn verify_proof(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]; NUM_PUBLIC_INPUTS],
) -> Result<()> {
    let negated_a = negate_proof_a(proof_a);
    let vk = get_verifying_key();

    let mut verifier = Groth16Verifier::new(&negated_a, proof_b, proof_c, public_inputs, &vk)
        .map_err(|_| error!(VaultError::InvalidProofFormat))?;

    verifier
        .verify()
        .map_err(|_| error!(VaultError::ProofVerificationFailed))?;

    Ok(())
}

#[cfg(test)]
fn u64_to_field_bytes(value: u64) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes[24..].copy_from_slice(&value.to_be_bytes());
    bytes
}

#[cfg(test)]
fn i64_to_field_bytes(value: i64) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes[24..].copy_from_slice(&value.to_be_bytes());
    bytes
}

fn field_bytes_to_u64(bytes: &[u8; 32]) -> u64 {
    let mut tail = [0u8; 8];
    tail.copy_from_slice(&bytes[24..]);
    u64::from_be_bytes(tail)
}

fn field_bytes_to_i64(bytes: &[u8; 32]) -> i64 {
    let mut tail = [0u8; 8];
    tail.copy_from_slice(&bytes[24..]);
    i64::from_be_bytes(tail)
}

fn solana_pubkey_to_field_bytes(pubkey: &Pubkey) -> [u8; 32] {
    pubkey.to_bytes()
}

fn encrypted_metadata_from_public_inputs(public_inputs: &[[u8; 32]; NUM_PUBLIC_INPUTS]) -> Vec<u8> {
    let mut encrypted_metadata = Vec::with_capacity(ENCRYPTED_METADATA_BYTES);
    for input in public_inputs.iter().skip(ENCRYPTED_METADATA_START_INDEX) {
        encrypted_metadata.extend_from_slice(input);
    }
    encrypted_metadata
}

fn validate_all_public_inputs(
    public_inputs: &[[u8; 32]; NUM_PUBLIC_INPUTS],
    registry_root: [u8; 32],
    amount: u64,
    clock_timestamp: i64,
    vault: &VaultState,
    signer: &Pubkey,
    encrypted_metadata: &[u8],
) -> Result<()> {
    require!(
        public_inputs[0] == registry_root,
        VaultError::MerkleRootMismatch
    );
    require!(
        field_bytes_to_u64(&public_inputs[1]) == amount,
        VaultError::AmountMismatch
    );

    let proof_timestamp = field_bytes_to_i64(&public_inputs[2]);
    require!(
        (clock_timestamp - proof_timestamp).abs() <= 60,
        VaultError::StaleProof
    );

    require!(
        field_bytes_to_u64(&public_inputs[3]) == vault.aml_thresholds[0]
            && field_bytes_to_u64(&public_inputs[4]) == vault.aml_thresholds[1]
            && field_bytes_to_u64(&public_inputs[5]) == vault.aml_thresholds[2]
            && field_bytes_to_u64(&public_inputs[6]) == vault.expired_threshold,
        VaultError::ThresholdMismatch
    );
    require!(
        public_inputs[7] == vault.regulator_pubkey_x
            && public_inputs[8] == vault.regulator_pubkey_y,
        VaultError::RegulatorKeyMismatch
    );
    require!(
        public_inputs[9] == solana_pubkey_to_field_bytes(signer),
        VaultError::WalletBindingMismatch
    );

    require!(
        encrypted_metadata.len() == ENCRYPTED_METADATA_BYTES,
        VaultError::EncryptedMetadataLengthMismatch
    );

    for (index, chunk) in encrypted_metadata.chunks_exact(32).enumerate() {
        require!(
            public_inputs[ENCRYPTED_METADATA_START_INDEX + index] == chunk,
            VaultError::EncryptedMetadataMismatch
        );
    }

    Ok(())
}

fn calculate_deposit_shares(total_assets: u64, total_shares: u64, assets_in: u64) -> Result<u64> {
    require!(assets_in > 0, VaultError::ZeroAmount);
    if total_assets == 0 || total_shares == 0 {
        return Ok(assets_in);
    }

    let shares = ((assets_in as u128) * (total_shares as u128) / (total_assets as u128)) as u64;
    require!(shares > 0, VaultError::ZeroShares);
    Ok(shares)
}

fn calculate_withdrawal_assets(total_assets: u64, total_shares: u64, shares: u64) -> Result<u64> {
    require!(shares > 0, VaultError::ZeroShares);
    require!(total_shares > 0, VaultError::ZeroShares);

    let assets = ((shares as u128) * (total_assets as u128) / (total_shares as u128)) as u64;
    require!(assets > 0, VaultError::ZeroAmount);
    Ok(assets)
}

fn update_share_price(total_assets: u64, total_shares: u64) -> Result<(u64, u64)> {
    if total_shares == 0 {
        return Ok((1, 1));
    }
    Ok((total_assets, total_shares))
}

fn refresh_share_price(vault: &mut VaultState) -> Result<()> {
    let (numerator, denominator) = update_share_price(vault.total_assets, vault.total_shares)?;
    vault.share_price_numerator = numerator;
    vault.share_price_denominator = denominator;
    Ok(())
}

fn enforce_deposit_limit(vault: &VaultState, amount: u64) -> Result<()> {
    require!(
        amount <= vault.max_single_deposit,
        VaultError::ExceedsDepositLimit
    );
    Ok(())
}

fn check_risk_controls(
    vault: &mut VaultState,
    amount: u64,
    is_outflow: bool,
    clock: &Clock,
) -> Result<()> {
    require!(!vault.paused, VaultError::VaultPaused);
    require!(
        amount <= vault.max_single_transaction,
        VaultError::ExceedsTransactionLimit
    );

    if clock.unix_timestamp - vault.outflow_window_start >= 86_400 {
        vault.daily_outflow_total = 0;
        vault.daily_transaction_count = 0;
        vault.outflow_window_start = clock.unix_timestamp;
    }

    require!(
        vault.daily_transaction_count < vault.max_daily_transactions,
        VaultError::VelocityLimitExceeded
    );
    vault.daily_transaction_count = vault
        .daily_transaction_count
        .checked_add(1)
        .ok_or(VaultError::Overflow)?;

    if is_outflow {
        let new_total = vault
            .daily_outflow_total
            .checked_add(amount)
            .ok_or(VaultError::Overflow)?;
        if new_total > vault.circuit_breaker_threshold {
            vault.paused = true;
            emit!(CircuitBreakerTriggered {
                daily_outflow: new_total,
                threshold: vault.circuit_breaker_threshold,
                timestamp: clock.unix_timestamp,
            });
            emit!(VaultPaused {
                reason: "Circuit breaker triggered".to_string(),
                timestamp: clock.unix_timestamp,
            });
            return Err(VaultError::CircuitBreakerTriggered.into());
        }
        vault.daily_outflow_total = new_total;
    }

    Ok(())
}

fn apply_risk_limit_update(
    vault: &mut VaultState,
    circuit_breaker_threshold: u64,
    max_single_transaction: u64,
    max_single_deposit: u64,
    max_daily_transactions: u32,
) {
    vault.circuit_breaker_threshold = circuit_breaker_threshold;
    vault.max_single_transaction = max_single_transaction;
    vault.max_single_deposit = max_single_deposit;
    vault.max_daily_transactions = max_daily_transactions;
}

fn apply_unpause(vault: &mut VaultState, timestamp: i64) {
    vault.paused = false;
    vault.daily_outflow_total = 0;
    vault.daily_transaction_count = 0;
    vault.outflow_window_start = timestamp;
}

fn apply_custody_provider_update(
    vault: &mut VaultState,
    provider: CustodyProvider,
    custody_authority: Pubkey,
) {
    vault.custody_provider = provider;
    vault.custody_authority = custody_authority;
}

fn apply_accrue_yield(vault: &mut VaultState, yield_amount: u64) -> Result<()> {
    vault.total_assets = vault
        .total_assets
        .checked_add(yield_amount)
        .ok_or(VaultError::Overflow)?;
    vault.total_yield_earned = vault
        .total_yield_earned
        .checked_add(yield_amount)
        .ok_or(VaultError::Overflow)?;
    refresh_share_price(vault)?;
    Ok(())
}

fn authorize_transfer_record_decryption(record: &mut TransferRecord) -> Result<()> {
    record.decryption_authorized = true;
    Ok(())
}

fn check_risk_oracle(oracle: &RiskOracle, clock_timestamp: i64) -> Result<()> {
    require!(oracle.active, VaultError::RiskOracleInactive);
    let staleness = clock_timestamp
        .checked_sub(oracle.last_updated)
        .ok_or(VaultError::Overflow)?;
    require!(
        staleness <= oracle.max_staleness,
        VaultError::RiskOracleStale
    );
    Ok(())
}

fn check_address_risk(
    oracle: &RiskOracle,
    score: Option<&AddressRiskScore>,
    clock_timestamp: i64,
) -> Result<()> {
    check_risk_oracle(oracle, clock_timestamp)?;
    let effective_score = match score {
        Some(s) => s.risk_score,
        None => oracle.default_risk_score,
    };
    require!(
        effective_score <= oracle.risk_threshold,
        VaultError::RiskScoreExceeded
    );
    Ok(())
}

fn populate_transfer_record(
    record: &mut TransferRecord,
    transfer_type: TransferType,
    amount: u64,
    merkle_root_snapshot: [u8; 32],
    proof_hash: [u8; 32],
    encrypted_metadata: Vec<u8>,
    signer: Pubkey,
    mandate_id: [u8; 32],
    bump: u8,
) -> Result<()> {
    record.proof_hash = proof_hash;
    record.transfer_type = transfer_type;
    record.amount = amount;
    record.timestamp = Clock::get()?.unix_timestamp;
    record.merkle_root_snapshot = merkle_root_snapshot;
    record.encrypted_metadata = encrypted_metadata;
    record.decryption_authorized = false;
    record.signer = signer;
    record.mandate_id = mandate_id;
    record.bump = bump;
    Ok(())
}

#[program]
pub mod vusd_vault {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitVault>,
        regulator_pub_key_x: [u8; 32],
        regulator_pub_key_y: [u8; 32],
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        vault.authority = ctx.accounts.authority.key();
        vault.usdc_mint = ctx.accounts.usdc_mint.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.usdc_reserve = ctx.accounts.usdc_reserve.key();
        vault.total_assets = 0;
        vault.total_shares = 0;
        vault.share_price_numerator = 1;
        vault.share_price_denominator = 1;
        vault.yield_source = Pubkey::default();
        vault.liquid_buffer_bps = 0;
        vault.total_yield_earned = 0;
        vault.aml_thresholds = [
            DEFAULT_RETAIL_THRESHOLD,
            DEFAULT_ACCREDITED_THRESHOLD,
            DEFAULT_INSTITUTIONAL_THRESHOLD,
        ];
        vault.expired_threshold = DEFAULT_EXPIRED_THRESHOLD;
        vault.emergency_timelock = DEFAULT_TIMELOCK;
        vault.regulator_pubkey_x = regulator_pub_key_x;
        vault.regulator_pubkey_y = regulator_pub_key_y;
        vault.bump = ctx.bumps.vault_state;
        vault.reserve_bump = ctx.bumps.usdc_reserve;
        vault.custody_provider = CustodyProvider::SelfCustody;
        vault.custody_authority = ctx.accounts.authority.key();
        vault.paused = false;
        vault.circuit_breaker_threshold = u64::MAX;
        vault.daily_outflow_total = 0;
        vault.outflow_window_start = Clock::get()?.unix_timestamp;
        vault.max_single_transaction = u64::MAX;
        vault.max_single_deposit = u64::MAX;
        vault.max_daily_transactions = u32::MAX;
        vault.daily_transaction_count = 0;

        Ok(())
    }

    pub fn store_proof_data(
        ctx: Context<StoreProofData>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: [[u8; 32]; NUM_PUBLIC_INPUTS],
    ) -> Result<()> {
        let buffer = &mut ctx.accounts.proof_buffer;
        buffer.owner = ctx.accounts.payer.key();
        buffer.proof_hash = compute_proof_hash(&proof_a, &proof_b, &proof_c);
        buffer.proof_a = proof_a;
        buffer.proof_b = proof_b;
        buffer.proof_c = proof_c;
        buffer.public_inputs = public_inputs;
        buffer.bump = ctx.bumps.proof_buffer;
        Ok(())
    }

    pub fn deposit_with_proof(
        ctx: Context<DepositWithProof>,
        amount: u64,
        mandate_id: [u8; 32],
    ) -> Result<()> {
        let clock = Clock::get()?;

        // KYT risk oracle check (strict mode)
        check_address_risk(
            &ctx.accounts.risk_oracle,
            ctx.accounts.address_risk_score.as_deref().map(|v| &**v),
            clock.unix_timestamp,
        )?;

        {
            let vault_state = &mut ctx.accounts.vault_state;
            check_risk_controls(vault_state, amount, false, &clock)?;
            enforce_deposit_limit(vault_state, amount)?;
        }

        let buffer = &ctx.accounts.proof_buffer;
        verify_proof(
            &buffer.proof_a,
            &buffer.proof_b,
            &buffer.proof_c,
            &buffer.public_inputs,
        )?;

        let registry_root = ctx.accounts.kyc_registry.merkle_root;
        let encrypted_metadata = encrypted_metadata_from_public_inputs(&buffer.public_inputs);
        validate_all_public_inputs(
            &buffer.public_inputs,
            registry_root,
            amount,
            clock.unix_timestamp,
            &ctx.accounts.vault_state,
            &ctx.accounts.user.key(),
            &encrypted_metadata,
        )?;

        let shares_to_mint = calculate_deposit_shares(
            ctx.accounts.vault_state.total_assets,
            ctx.accounts.vault_state.total_shares,
            amount,
        )?;

        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_usdc_account.to_account_info(),
                to: ctx.accounts.usdc_reserve.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
            },
        );
        token_interface::transfer_checked(transfer_ctx, amount, USDC_DECIMALS)?;

        let vault_seeds = &[b"vault_state".as_ref(), &[ctx.accounts.vault_state.bump]];
        let signer_seeds = &[&vault_seeds[..]];
        let mint_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.stealth_share_account.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            signer_seeds,
        );
        token_interface::mint_to(mint_ctx, shares_to_mint)?;

        let vault = &mut ctx.accounts.vault_state;
        vault.total_assets = vault
            .total_assets
            .checked_add(amount)
            .ok_or(VaultError::Overflow)?;
        vault.total_shares = vault
            .total_shares
            .checked_add(shares_to_mint)
            .ok_or(VaultError::Overflow)?;
        refresh_share_price(vault)?;

        populate_transfer_record(
            &mut ctx.accounts.transfer_record,
            TransferType::Deposit,
            amount,
            registry_root,
            buffer.proof_hash,
            encrypted_metadata,
            ctx.accounts.user.key(),
            mandate_id,
            ctx.bumps.transfer_record,
        )?;

        emit!(DepositVerified {
            amount,
            shares: shares_to_mint,
            proof_hash: buffer.proof_hash,
            timestamp: ctx.accounts.transfer_record.timestamp,
        });

        Ok(())
    }

    pub fn transfer_with_proof(
        ctx: Context<TransferWithProof>,
        amount: u64,
        mandate_id: [u8; 32],
    ) -> Result<()> {
        let clock = Clock::get()?;

        check_address_risk(
            &ctx.accounts.risk_oracle,
            ctx.accounts.address_risk_score.as_deref().map(|v| &**v),
            clock.unix_timestamp,
        )?;

        check_risk_controls(&mut ctx.accounts.vault_state, amount, false, &clock)?;

        let buffer = &ctx.accounts.proof_buffer;
        verify_proof(
            &buffer.proof_a,
            &buffer.proof_b,
            &buffer.proof_c,
            &buffer.public_inputs,
        )?;

        let registry_root = ctx.accounts.kyc_registry.merkle_root;
        let encrypted_metadata = encrypted_metadata_from_public_inputs(&buffer.public_inputs);
        validate_all_public_inputs(
            &buffer.public_inputs,
            registry_root,
            amount,
            clock.unix_timestamp,
            &ctx.accounts.vault_state,
            &ctx.accounts.sender.key(),
            &encrypted_metadata,
        )?;

        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.sender_stealth_account.to_account_info(),
                to: ctx.accounts.recipient_stealth_account.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
                mint: ctx.accounts.share_mint.to_account_info(),
            },
        );
        token_interface::transfer_checked(transfer_ctx, amount, USDC_DECIMALS)?;

        populate_transfer_record(
            &mut ctx.accounts.transfer_record,
            TransferType::Transfer,
            amount,
            registry_root,
            buffer.proof_hash,
            encrypted_metadata,
            ctx.accounts.sender.key(),
            mandate_id,
            ctx.bumps.transfer_record,
        )?;

        emit!(TransferVerified {
            amount,
            proof_hash: buffer.proof_hash,
            timestamp: ctx.accounts.transfer_record.timestamp,
        });

        Ok(())
    }

    pub fn withdraw_with_proof(
        ctx: Context<WithdrawWithProof>,
        amount: u64,
        mandate_id: [u8; 32],
    ) -> Result<()> {
        let clock = Clock::get()?;

        check_address_risk(
            &ctx.accounts.risk_oracle,
            ctx.accounts.address_risk_score.as_deref().map(|v| &**v),
            clock.unix_timestamp,
        )?;

        check_risk_controls(&mut ctx.accounts.vault_state, amount, true, &clock)?;

        let buffer = &ctx.accounts.proof_buffer;
        verify_proof(
            &buffer.proof_a,
            &buffer.proof_b,
            &buffer.proof_c,
            &buffer.public_inputs,
        )?;

        let registry_root = ctx.accounts.kyc_registry.merkle_root;
        let encrypted_metadata = encrypted_metadata_from_public_inputs(&buffer.public_inputs);
        validate_all_public_inputs(
            &buffer.public_inputs,
            registry_root,
            amount,
            clock.unix_timestamp,
            &ctx.accounts.vault_state,
            &ctx.accounts.stealth_owner.key(),
            &encrypted_metadata,
        )?;

        let usdc_out = calculate_withdrawal_assets(
            ctx.accounts.vault_state.total_assets,
            ctx.accounts.vault_state.total_shares,
            amount,
        )?;

        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.stealth_share_account.to_account_info(),
                authority: ctx.accounts.stealth_owner.to_account_info(),
            },
        );
        token_interface::burn(burn_ctx, amount)?;

        let reserve_seeds = &[
            b"usdc_reserve".as_ref(),
            &[ctx.accounts.vault_state.reserve_bump],
        ];
        let reserve_signer = &[&reserve_seeds[..]];
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.usdc_reserve.to_account_info(),
                to: ctx.accounts.user_usdc_account.to_account_info(),
                authority: ctx.accounts.usdc_reserve.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
            },
            reserve_signer,
        );
        token_interface::transfer_checked(transfer_ctx, usdc_out, USDC_DECIMALS)?;

        let vault = &mut ctx.accounts.vault_state;
        vault.total_assets = vault
            .total_assets
            .checked_sub(usdc_out)
            .ok_or(VaultError::Underflow)?;
        vault.total_shares = vault
            .total_shares
            .checked_sub(amount)
            .ok_or(VaultError::Underflow)?;
        refresh_share_price(vault)?;

        populate_transfer_record(
            &mut ctx.accounts.transfer_record,
            TransferType::Withdrawal,
            amount,
            registry_root,
            buffer.proof_hash,
            encrypted_metadata,
            ctx.accounts.stealth_owner.key(),
            mandate_id,
            ctx.bumps.transfer_record,
        )?;

        emit!(WithdrawalVerified {
            shares: amount,
            assets_out: usdc_out,
            proof_hash: buffer.proof_hash,
            timestamp: ctx.accounts.transfer_record.timestamp,
        });

        Ok(())
    }

    pub fn request_emergency_withdrawal(ctx: Context<RequestEmergency>, amount: u64) -> Result<()> {
        let emergency = &mut ctx.accounts.emergency;
        emergency.requester = ctx.accounts.requester.key();
        emergency.stealth_account = ctx.accounts.stealth_share_account.key();
        emergency.amount = amount;
        emergency.request_timestamp = Clock::get()?.unix_timestamp;
        emergency.executed = false;
        emergency.bump = ctx.bumps.emergency;

        emit!(EmergencyRequested {
            requester: emergency.requester,
            amount,
            unlock_time: emergency.request_timestamp + ctx.accounts.vault_state.emergency_timelock,
        });

        Ok(())
    }

    pub fn execute_emergency_withdrawal(ctx: Context<ExecuteEmergency>) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;
        let unlock_time =
            ctx.accounts.emergency.request_timestamp + ctx.accounts.vault_state.emergency_timelock;
        require!(current_time >= unlock_time, VaultError::TimelockNotExpired);

        let shares = ctx.accounts.emergency.amount;
        let usdc_out = calculate_withdrawal_assets(
            ctx.accounts.vault_state.total_assets,
            ctx.accounts.vault_state.total_shares,
            shares,
        )?;

        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.stealth_share_account.to_account_info(),
                authority: ctx.accounts.requester.to_account_info(),
            },
        );
        token_interface::burn(burn_ctx, shares)?;

        let reserve_seeds = &[
            b"usdc_reserve".as_ref(),
            &[ctx.accounts.vault_state.reserve_bump],
        ];
        let reserve_signer = &[&reserve_seeds[..]];
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.usdc_reserve.to_account_info(),
                to: ctx.accounts.requester_usdc_account.to_account_info(),
                authority: ctx.accounts.usdc_reserve.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
            },
            reserve_signer,
        );
        token_interface::transfer_checked(transfer_ctx, usdc_out, USDC_DECIMALS)?;

        let vault = &mut ctx.accounts.vault_state;
        vault.total_assets = vault
            .total_assets
            .checked_sub(usdc_out)
            .ok_or(VaultError::Underflow)?;
        vault.total_shares = vault
            .total_shares
            .checked_sub(shares)
            .ok_or(VaultError::Underflow)?;
        refresh_share_price(vault)?;

        ctx.accounts.emergency.executed = true;

        emit!(EmergencyExecuted {
            requester: ctx.accounts.emergency.requester,
            amount: shares,
        });

        Ok(())
    }

    pub fn update_aml_thresholds(
        ctx: Context<AdminUpdate>,
        retail: u64,
        accredited: u64,
        institutional: u64,
        expired: u64,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        vault.aml_thresholds = [retail, accredited, institutional];
        vault.expired_threshold = expired;
        Ok(())
    }

    pub fn update_regulator_key(
        ctx: Context<AdminUpdate>,
        new_pub_key_x: [u8; 32],
        new_pub_key_y: [u8; 32],
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        vault.regulator_pubkey_x = new_pub_key_x;
        vault.regulator_pubkey_y = new_pub_key_y;
        Ok(())
    }

    pub fn update_emergency_timelock(
        ctx: Context<AdminUpdate>,
        new_timelock_seconds: i64,
    ) -> Result<()> {
        require!(new_timelock_seconds >= 0, VaultError::InvalidTimelock);
        ctx.accounts.vault_state.emergency_timelock = new_timelock_seconds;
        Ok(())
    }

    pub fn update_risk_limits(
        ctx: Context<AdminUpdate>,
        circuit_breaker_threshold: u64,
        max_single_transaction: u64,
        max_single_deposit: u64,
        max_daily_transactions: u32,
    ) -> Result<()> {
        apply_risk_limit_update(
            &mut ctx.accounts.vault_state,
            circuit_breaker_threshold,
            max_single_transaction,
            max_single_deposit,
            max_daily_transactions,
        );
        Ok(())
    }

    pub fn unpause_vault(ctx: Context<AdminUpdate>) -> Result<()> {
        let clock = Clock::get()?;
        apply_unpause(&mut ctx.accounts.vault_state, clock.unix_timestamp);
        emit!(VaultUnpaused {
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    pub fn update_custody_provider(
        ctx: Context<AdminUpdate>,
        provider: CustodyProvider,
        custody_authority: Pubkey,
    ) -> Result<()> {
        apply_custody_provider_update(&mut ctx.accounts.vault_state, provider, custody_authority);
        Ok(())
    }

    pub fn add_yield_venue(
        ctx: Context<AddYieldVenue>,
        venue_address: Pubkey,
        name: String,
        jurisdiction_whitelist: [u8; 32],
        allocation_cap_bps: u16,
        risk_rating: u8,
    ) -> Result<()> {
        let venue = &mut ctx.accounts.yield_venue;
        venue.venue_address = venue_address;
        venue.name = name;
        venue.jurisdiction_whitelist = jurisdiction_whitelist;
        venue.allocation_cap_bps = allocation_cap_bps;
        venue.active = true;
        venue.risk_rating = risk_rating;
        venue.bump = ctx.bumps.yield_venue;

        if ctx.accounts.vault_state.yield_source == Pubkey::default() {
            ctx.accounts.vault_state.yield_source = venue_address;
        }

        Ok(())
    }

    pub fn remove_yield_venue(ctx: Context<RemoveYieldVenue>) -> Result<()> {
        if ctx.accounts.vault_state.yield_source == ctx.accounts.yield_venue.venue_address {
            ctx.accounts.vault_state.yield_source = Pubkey::default();
        }
        Ok(())
    }

    pub fn accrue_yield(ctx: Context<AccrueYield>, yield_amount: u64) -> Result<()> {
        let clock = Clock::get()?;
        let vault = &mut ctx.accounts.vault_state;
        apply_accrue_yield(vault, yield_amount)?;
        emit!(YieldAccrued {
            amount: yield_amount,
            new_total_assets: vault.total_assets,
            new_share_price_numerator: vault.share_price_numerator,
            new_share_price_denominator: vault.share_price_denominator,
            timestamp: clock.unix_timestamp,
        });
        Ok(())
    }

    pub fn mark_decryption_authorized(ctx: Context<MarkDecryptionAuthorized>) -> Result<()> {
        authorize_transfer_record_decryption(&mut ctx.accounts.transfer_record)
    }

    // ================================================================
    // RISK ORACLE (KYT Control Plane)
    // ================================================================

    pub fn initialize_risk_oracle(
        ctx: Context<InitRiskOracle>,
        risk_authority: Pubkey,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.risk_oracle;
        oracle.vault = ctx.accounts.vault_state.key();
        oracle.risk_authority = risk_authority;
        oracle.default_risk_score = 0;
        oracle.risk_threshold = DEFAULT_RISK_THRESHOLD;
        oracle.max_staleness = DEFAULT_MAX_ORACLE_STALENESS;
        oracle.last_updated = Clock::get()?.unix_timestamp;
        oracle.active = true;
        oracle.bump = ctx.bumps.risk_oracle;

        emit!(RiskOracleInitialized {
            vault: oracle.vault,
            risk_authority,
            timestamp: oracle.last_updated,
        });

        Ok(())
    }

    pub fn update_risk_score(
        ctx: Context<UpdateRiskScore>,
        address: Pubkey,
        risk_score: u8,
    ) -> Result<()> {
        require!(risk_score <= 100, VaultError::InvalidRiskScore);

        let score_account = &mut ctx.accounts.address_risk_score;
        let old_score = score_account.risk_score;
        score_account.address = address;
        score_account.risk_score = risk_score;
        score_account.last_updated = Clock::get()?.unix_timestamp;
        score_account.bump = ctx.bumps.address_risk_score;

        let oracle = &mut ctx.accounts.risk_oracle;
        oracle.last_updated = score_account.last_updated;

        emit!(RiskScoreUpdated {
            address,
            old_score,
            new_score: risk_score,
            timestamp: score_account.last_updated,
        });

        Ok(())
    }

    pub fn update_risk_oracle_config(
        ctx: Context<UpdateRiskOracleConfig>,
        risk_threshold: u8,
        max_staleness: i64,
        default_risk_score: u8,
    ) -> Result<()> {
        require!(risk_threshold <= 100, VaultError::InvalidRiskScore);
        require!(default_risk_score <= 100, VaultError::InvalidRiskScore);
        require!(max_staleness > 0, VaultError::InvalidTimelock);

        let oracle = &mut ctx.accounts.risk_oracle;
        oracle.risk_threshold = risk_threshold;
        oracle.max_staleness = max_staleness;
        oracle.default_risk_score = default_risk_score;
        Ok(())
    }

    // ================================================================
    // CONFIDENTIAL TRANSFERS (Dual-Mint Architecture)
    // ================================================================

    pub fn setup_confidential_vault(
        ctx: Context<SetupConfidentialVault>,
        auditor_elgamal_pubkey: [u8; 32],
    ) -> Result<()> {
        let config = &mut ctx.accounts.confidential_config;
        config.vault = ctx.accounts.vault_state.key();
        config.confidential_share_mint = ctx.accounts.confidential_share_mint.key();
        config.auditor_elgamal_pubkey = auditor_elgamal_pubkey;
        config.total_confidential_shares = 0;
        config.enabled = true;
        config.bump = ctx.bumps.confidential_config;

        emit!(ConfidentialMintInitialized {
            vault: config.vault,
            confidential_share_mint: config.confidential_share_mint,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn convert_to_confidential(
        ctx: Context<ConvertToConfidential>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(
            ctx.accounts.confidential_config.enabled,
            VaultError::ConfidentialTransfersDisabled
        );

        // Burn standard shares
        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.user_share_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token_interface::burn(burn_ctx, amount)?;

        // Mint confidential shares
        let vault_seeds = &[b"vault_state".as_ref(), &[ctx.accounts.vault_state.bump]];
        let signer_seeds = &[&vault_seeds[..]];
        let mint_ctx = CpiContext::new_with_signer(
            ctx.accounts.confidential_token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.confidential_share_mint.to_account_info(),
                to: ctx.accounts.user_confidential_account.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            signer_seeds,
        );
        token_interface::mint_to(mint_ctx, amount)?;

        let config = &mut ctx.accounts.confidential_config;
        config.total_confidential_shares = config
            .total_confidential_shares
            .checked_add(amount)
            .ok_or(VaultError::Overflow)?;

        let vault = &mut ctx.accounts.vault_state;
        vault.total_shares = vault
            .total_shares
            .checked_sub(amount)
            .ok_or(VaultError::Underflow)?;

        emit!(SharesConvertedToConfidential {
            user: ctx.accounts.user.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn convert_from_confidential(
        ctx: Context<ConvertFromConfidential>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(
            ctx.accounts.confidential_config.enabled,
            VaultError::ConfidentialTransfersDisabled
        );

        // Burn confidential shares
        let burn_ctx = CpiContext::new(
            ctx.accounts.confidential_token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.confidential_share_mint.to_account_info(),
                from: ctx.accounts.user_confidential_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token_interface::burn(burn_ctx, amount)?;

        // Mint standard shares
        let vault_seeds = &[b"vault_state".as_ref(), &[ctx.accounts.vault_state.bump]];
        let signer_seeds = &[&vault_seeds[..]];
        let mint_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.user_share_account.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            signer_seeds,
        );
        token_interface::mint_to(mint_ctx, amount)?;

        let config = &mut ctx.accounts.confidential_config;
        config.total_confidential_shares = config
            .total_confidential_shares
            .checked_sub(amount)
            .ok_or(VaultError::Underflow)?;

        let vault = &mut ctx.accounts.vault_state;
        vault.total_shares = vault
            .total_shares
            .checked_add(amount)
            .ok_or(VaultError::Overflow)?;

        emit!(SharesConvertedToStandard {
            user: ctx.accounts.user.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum CustodyProvider {
    SelfCustody,
    Fireblocks,
    BitGo,
    Anchorage,
}

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub authority: Pubkey,
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
    pub custody_provider: CustodyProvider,
    pub custody_authority: Pubkey,
    pub paused: bool,
    pub circuit_breaker_threshold: u64,
    pub daily_outflow_total: u64,
    pub outflow_window_start: i64,
    pub max_single_transaction: u64,
    pub max_single_deposit: u64,
    pub max_daily_transactions: u32,
    pub daily_transaction_count: u32,
}

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

#[account]
pub struct ProofBuffer {
    pub owner: Pubkey,
    pub proof_hash: [u8; 32],
    pub proof_a: [u8; 64],
    pub proof_b: [u8; 128],
    pub proof_c: [u8; 64],
    pub public_inputs: [[u8; 32]; NUM_PUBLIC_INPUTS],
    pub bump: u8,
}

impl ProofBuffer {
    pub const SPACE: usize = 8 + 32 + 32 + 64 + 128 + 64 + (32 * NUM_PUBLIC_INPUTS) + 1;
}

#[account]
#[derive(InitSpace)]
pub struct EmergencyWithdrawal {
    pub requester: Pubkey,
    pub stealth_account: Pubkey,
    pub amount: u64,
    pub request_timestamp: i64,
    pub executed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum TransferType {
    Deposit,
    Transfer,
    Withdrawal,
}

#[account]
#[derive(InitSpace)]
pub struct TransferRecord {
    pub proof_hash: [u8; 32],
    pub transfer_type: TransferType,
    pub amount: u64,
    pub timestamp: i64,
    pub merkle_root_snapshot: [u8; 32],
    #[max_len(384)]
    pub encrypted_metadata: Vec<u8>,
    pub decryption_authorized: bool,
    pub signer: Pubkey,
    pub mandate_id: [u8; 32],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ConfidentialVaultConfig {
    pub vault: Pubkey,
    pub confidential_share_mint: Pubkey,
    pub auditor_elgamal_pubkey: [u8; 32],
    pub total_confidential_shares: u64,
    pub enabled: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RiskOracle {
    pub vault: Pubkey,
    pub risk_authority: Pubkey,
    pub default_risk_score: u8,
    pub risk_threshold: u8,
    pub max_staleness: i64,
    pub last_updated: i64,
    pub active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AddressRiskScore {
    pub oracle: Pubkey,
    pub address: Pubkey,
    pub risk_score: u8,
    pub last_updated: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"vault_state"],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        mint::decimals = USDC_DECIMALS,
        mint::authority = vault_state,
    )]
    pub share_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = usdc_reserve,
        seeds = [b"usdc_reserve"],
        bump,
    )]
    pub usdc_reserve: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct StoreProofData<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = ProofBuffer::SPACE,
        seeds = [b"proof_buffer", payer.key().as_ref()],
        bump,
    )]
    pub proof_buffer: Box<Account<'info, ProofBuffer>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositWithProof<'info> {
    #[account(
        mut,
        seeds = [b"vault_state"],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    pub kyc_registry: Box<Account<'info, kyc_registry::KycRegistry>>,

    #[account(
        seeds = [b"risk_oracle", vault_state.key().as_ref()],
        bump = risk_oracle.bump,
    )]
    pub risk_oracle: Box<Account<'info, RiskOracle>>,

    pub address_risk_score: Option<Box<Account<'info, AddressRiskScore>>>,

    #[account(
        mut,
        constraint = usdc_mint.key() == vault_state.usdc_mint @ VaultError::InvalidMint,
    )]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = share_mint.key() == vault_state.share_mint @ VaultError::InvalidMint,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = user,
    )]
    pub user_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"usdc_reserve"],
        bump = vault_state.reserve_bump,
    )]
    pub usdc_reserve: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = share_mint,
    )]
    pub stealth_share_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"proof_buffer", user.key().as_ref()],
        bump = proof_buffer.bump,
        constraint = proof_buffer.owner == user.key() @ VaultError::Unauthorized,
        close = user,
    )]
    pub proof_buffer: Box<Account<'info, ProofBuffer>>,

    #[account(
        init,
        payer = user,
        space = 8 + TransferRecord::INIT_SPACE,
        seeds = [b"transfer_record", proof_buffer.proof_hash.as_ref()],
        bump,
    )]
    pub transfer_record: Box<Account<'info, TransferRecord>>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct TransferWithProof<'info> {
    #[account(
        mut,
        seeds = [b"vault_state"],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    pub kyc_registry: Box<Account<'info, kyc_registry::KycRegistry>>,

    #[account(
        seeds = [b"risk_oracle", vault_state.key().as_ref()],
        bump = risk_oracle.bump,
    )]
    pub risk_oracle: Box<Account<'info, RiskOracle>>,

    pub address_risk_score: Option<Box<Account<'info, AddressRiskScore>>>,

    #[account(
        constraint = share_mint.key() == vault_state.share_mint @ VaultError::InvalidMint,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = share_mint,
    )]
    pub sender_stealth_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = share_mint,
    )]
    pub recipient_stealth_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"proof_buffer", sender.key().as_ref()],
        bump = proof_buffer.bump,
        constraint = proof_buffer.owner == sender.key() @ VaultError::Unauthorized,
        close = sender,
    )]
    pub proof_buffer: Box<Account<'info, ProofBuffer>>,

    #[account(
        init,
        payer = sender,
        space = 8 + TransferRecord::INIT_SPACE,
        seeds = [b"transfer_record", proof_buffer.proof_hash.as_ref()],
        bump,
    )]
    pub transfer_record: Box<Account<'info, TransferRecord>>,

    #[account(mut)]
    pub sender: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawWithProof<'info> {
    #[account(
        mut,
        seeds = [b"vault_state"],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    pub kyc_registry: Box<Account<'info, kyc_registry::KycRegistry>>,

    #[account(
        seeds = [b"risk_oracle", vault_state.key().as_ref()],
        bump = risk_oracle.bump,
    )]
    pub risk_oracle: Box<Account<'info, RiskOracle>>,

    pub address_risk_score: Option<Box<Account<'info, AddressRiskScore>>>,

    #[account(
        constraint = usdc_mint.key() == vault_state.usdc_mint @ VaultError::InvalidMint,
    )]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = share_mint.key() == vault_state.share_mint @ VaultError::InvalidMint,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"usdc_reserve"],
        bump = vault_state.reserve_bump,
    )]
    pub usdc_reserve: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = share_mint,
    )]
    pub stealth_share_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = usdc_mint,
    )]
    pub user_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [b"proof_buffer", stealth_owner.key().as_ref()],
        bump = proof_buffer.bump,
        constraint = proof_buffer.owner == stealth_owner.key() @ VaultError::Unauthorized,
        close = stealth_owner,
    )]
    pub proof_buffer: Box<Account<'info, ProofBuffer>>,

    #[account(
        init,
        payer = stealth_owner,
        space = 8 + TransferRecord::INIT_SPACE,
        seeds = [b"transfer_record", proof_buffer.proof_hash.as_ref()],
        bump,
    )]
    pub transfer_record: Box<Account<'info, TransferRecord>>,

    #[account(mut)]
    pub stealth_owner: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RequestEmergency<'info> {
    #[account(
        seeds = [b"vault_state"],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = requester,
        space = 8 + EmergencyWithdrawal::INIT_SPACE,
        seeds = [b"emergency", requester.key().as_ref()],
        bump,
    )]
    pub emergency: Account<'info, EmergencyWithdrawal>,

    #[account(
        token::mint = vault_state.share_mint,
    )]
    pub stealth_share_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub requester: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteEmergency<'info> {
    #[account(
        mut,
        seeds = [b"vault_state"],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(
        mut,
        seeds = [b"emergency", requester.key().as_ref()],
        bump = emergency.bump,
        constraint = emergency.requester == requester.key() @ VaultError::Unauthorized,
        constraint = !emergency.executed @ VaultError::AlreadyExecuted,
    )]
    pub emergency: Box<Account<'info, EmergencyWithdrawal>>,

    #[account(
        mut,
        constraint = share_mint.key() == vault_state.share_mint @ VaultError::InvalidMint,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = usdc_mint.key() == vault_state.usdc_mint @ VaultError::InvalidMint,
    )]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [b"usdc_reserve"],
        bump = vault_state.reserve_bump,
    )]
    pub usdc_reserve: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = stealth_share_account.key() == emergency.stealth_account @ VaultError::InvalidStealthAccount,
    )]
    pub stealth_share_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = requester,
    )]
    pub requester_usdc_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub requester: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminUpdate<'info> {
    #[account(
        mut,
        seeds = [b"vault_state"],
        bump = vault_state.bump,
        has_one = authority @ VaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(venue_address: Pubkey)]
pub struct AddYieldVenue<'info> {
    #[account(
        mut,
        seeds = [b"vault_state"],
        bump = vault_state.bump,
        has_one = authority @ VaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = authority,
        space = 8 + WhitelistedYieldVenue::INIT_SPACE,
        seeds = [b"yield_venue", vault_state.key().as_ref(), venue_address.as_ref()],
        bump,
    )]
    pub yield_venue: Account<'info, WhitelistedYieldVenue>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveYieldVenue<'info> {
    #[account(
        mut,
        seeds = [b"vault_state"],
        bump = vault_state.bump,
        has_one = authority @ VaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        close = authority,
        seeds = [
            b"yield_venue",
            vault_state.key().as_ref(),
            yield_venue.venue_address.as_ref(),
        ],
        bump = yield_venue.bump,
    )]
    pub yield_venue: Account<'info, WhitelistedYieldVenue>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AccrueYield<'info> {
    #[account(
        mut,
        seeds = [b"vault_state"],
        bump = vault_state.bump,
        has_one = authority @ VaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct MarkDecryptionAuthorized<'info> {
    #[account(
        mut,
        seeds = [b"vault_state"],
        bump = vault_state.bump,
        has_one = authority @ VaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(mut)]
    pub transfer_record: Account<'info, TransferRecord>,

    pub authority: Signer<'info>,
}

// ================================================================
// RISK ORACLE ACCOUNT CONTEXTS
// ================================================================

#[derive(Accounts)]
pub struct InitRiskOracle<'info> {
    #[account(
        seeds = [b"vault_state"],
        bump = vault_state.bump,
        has_one = authority @ VaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = authority,
        space = 8 + RiskOracle::INIT_SPACE,
        seeds = [b"risk_oracle", vault_state.key().as_ref()],
        bump,
    )]
    pub risk_oracle: Account<'info, RiskOracle>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(address: Pubkey)]
pub struct UpdateRiskScore<'info> {
    #[account(
        seeds = [b"vault_state"],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [b"risk_oracle", vault_state.key().as_ref()],
        bump = risk_oracle.bump,
        constraint = risk_oracle.risk_authority == risk_authority.key() @ VaultError::Unauthorized,
    )]
    pub risk_oracle: Account<'info, RiskOracle>,

    #[account(
        init_if_needed,
        payer = risk_authority,
        space = 8 + AddressRiskScore::INIT_SPACE,
        seeds = [b"risk_score", risk_oracle.key().as_ref(), address.as_ref()],
        bump,
    )]
    pub address_risk_score: Account<'info, AddressRiskScore>,

    #[account(mut)]
    pub risk_authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRiskOracleConfig<'info> {
    #[account(
        seeds = [b"vault_state"],
        bump = vault_state.bump,
        has_one = authority @ VaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [b"risk_oracle", vault_state.key().as_ref()],
        bump = risk_oracle.bump,
    )]
    pub risk_oracle: Account<'info, RiskOracle>,

    pub authority: Signer<'info>,
}

// ================================================================
// CONFIDENTIAL TRANSFER ACCOUNT CONTEXTS
// ================================================================

#[derive(Accounts)]
pub struct SetupConfidentialVault<'info> {
    #[account(
        seeds = [b"vault_state"],
        bump = vault_state.bump,
        has_one = authority @ VaultError::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = authority,
        space = 8 + ConfidentialVaultConfig::INIT_SPACE,
        seeds = [b"confidential_config", vault_state.key().as_ref()],
        bump,
    )]
    pub confidential_config: Account<'info, ConfidentialVaultConfig>,

    /// The Token-2022 mint with ConfidentialTransfer extension, created externally.
    /// Must have vault_state as mint authority.
    #[account(
        constraint = confidential_share_mint.key() != vault_state.share_mint @ VaultError::InvalidMint,
    )]
    pub confidential_share_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConvertToConfidential<'info> {
    #[account(
        mut,
        seeds = [b"vault_state"],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(
        mut,
        seeds = [b"confidential_config", vault_state.key().as_ref()],
        bump = confidential_config.bump,
    )]
    pub confidential_config: Box<Account<'info, ConfidentialVaultConfig>>,

    #[account(
        mut,
        constraint = share_mint.key() == vault_state.share_mint @ VaultError::InvalidMint,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = confidential_share_mint.key() == confidential_config.confidential_share_mint @ VaultError::InvalidMint,
    )]
    pub confidential_share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = share_mint,
        token::authority = user,
    )]
    pub user_share_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = confidential_share_mint,
    )]
    pub user_confidential_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub confidential_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ConvertFromConfidential<'info> {
    #[account(
        mut,
        seeds = [b"vault_state"],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(
        mut,
        seeds = [b"confidential_config", vault_state.key().as_ref()],
        bump = confidential_config.bump,
    )]
    pub confidential_config: Box<Account<'info, ConfidentialVaultConfig>>,

    #[account(
        mut,
        constraint = share_mint.key() == vault_state.share_mint @ VaultError::InvalidMint,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = confidential_share_mint.key() == confidential_config.confidential_share_mint @ VaultError::InvalidMint,
    )]
    pub confidential_share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = share_mint,
    )]
    pub user_share_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = confidential_share_mint,
        token::authority = user,
    )]
    pub user_confidential_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub confidential_token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct DepositVerified {
    pub amount: u64,
    pub shares: u64,
    pub proof_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct TransferVerified {
    pub amount: u64,
    pub proof_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct WithdrawalVerified {
    pub shares: u64,
    pub assets_out: u64,
    pub proof_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct EmergencyRequested {
    pub requester: Pubkey,
    pub amount: u64,
    pub unlock_time: i64,
}

#[event]
pub struct EmergencyExecuted {
    pub requester: Pubkey,
    pub amount: u64,
}

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

#[event]
pub struct RiskOracleInitialized {
    pub vault: Pubkey,
    pub risk_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct RiskScoreUpdated {
    pub address: Pubkey,
    pub old_score: u8,
    pub new_score: u8,
    pub timestamp: i64,
}

#[event]
pub struct ConfidentialMintInitialized {
    pub vault: Pubkey,
    pub confidential_share_mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SharesConvertedToConfidential {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct SharesConvertedToStandard {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum VaultError {
    #[msg("Invalid proof format.")]
    InvalidProofFormat,
    #[msg("ZK proof verification failed.")]
    ProofVerificationFailed,
    #[msg("Merkle root in proof does not match the registry root.")]
    MerkleRootMismatch,
    #[msg("Transfer amount in proof does not match the instruction parameter.")]
    AmountMismatch,
    #[msg("Proof timestamp is stale.")]
    StaleProof,
    #[msg("Threshold inputs do not match vault state.")]
    ThresholdMismatch,
    #[msg("Regulator key inputs do not match vault state.")]
    RegulatorKeyMismatch,
    #[msg("Wallet public input does not match the signer.")]
    WalletBindingMismatch,
    #[msg("Encrypted metadata length is invalid.")]
    EncryptedMetadataLengthMismatch,
    #[msg("Encrypted metadata does not match the proof public inputs.")]
    EncryptedMetadataMismatch,
    #[msg("Invalid mint address.")]
    InvalidMint,
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
    #[msg("Arithmetic overflow.")]
    Overflow,
    #[msg("Arithmetic underflow.")]
    Underflow,
    #[msg("Emergency timelock has not expired.")]
    TimelockNotExpired,
    #[msg("Emergency withdrawal already executed.")]
    AlreadyExecuted,
    #[msg("Unauthorized.")]
    Unauthorized,
    #[msg("Invalid stealth token account.")]
    InvalidStealthAccount,
    #[msg("Invalid timelock value.")]
    InvalidTimelock,
    #[msg("Proof hash mismatch.")]
    ProofHashMismatch,
    #[msg("Zero amount is not allowed.")]
    ZeroAmount,
    #[msg("Zero shares are not allowed.")]
    ZeroShares,
    #[msg("Risk oracle is not active.")]
    RiskOracleInactive,
    #[msg("Risk oracle data is stale.")]
    RiskOracleStale,
    #[msg("Address risk score exceeds threshold.")]
    RiskScoreExceeded,
    #[msg("Invalid risk score (must be 0-100).")]
    InvalidRiskScore,
    #[msg("Confidential transfers are not enabled for this vault.")]
    ConfidentialTransfersDisabled,
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_METADATA_LEN: usize = (NUM_PUBLIC_INPUTS - 10) * 32;

    fn sample_vault_state() -> VaultState {
        VaultState {
            authority: Pubkey::new_unique(),
            usdc_mint: Pubkey::new_unique(),
            share_mint: Pubkey::new_unique(),
            usdc_reserve: Pubkey::new_unique(),
            total_assets: 10_000_000,
            total_shares: 10_000_000,
            share_price_numerator: 1,
            share_price_denominator: 1,
            yield_source: Pubkey::new_unique(),
            liquid_buffer_bps: 2_000,
            total_yield_earned: 0,
            aml_thresholds: [
                DEFAULT_RETAIL_THRESHOLD,
                DEFAULT_ACCREDITED_THRESHOLD,
                DEFAULT_INSTITUTIONAL_THRESHOLD,
            ],
            expired_threshold: DEFAULT_EXPIRED_THRESHOLD,
            emergency_timelock: DEFAULT_TIMELOCK,
            regulator_pubkey_x: [7u8; 32],
            regulator_pubkey_y: [8u8; 32],
            bump: 1,
            reserve_bump: 2,
            custody_provider: CustodyProvider::SelfCustody,
            custody_authority: Pubkey::new_unique(),
            paused: false,
            circuit_breaker_threshold: u64::MAX,
            daily_outflow_total: 0,
            outflow_window_start: 1_763_077_200,
            max_single_transaction: u64::MAX,
            max_single_deposit: u64::MAX,
            max_daily_transactions: u32::MAX,
            daily_transaction_count: 0,
        }
    }

    fn sample_clock(timestamp: i64) -> Clock {
        Clock {
            slot: 0,
            epoch_start_timestamp: 0,
            epoch: 0,
            leader_schedule_epoch: 0,
            unix_timestamp: timestamp,
        }
    }

    fn build_valid_public_inputs(
        vault: &VaultState,
        signer: &Pubkey,
        merkle_root: [u8; 32],
        amount: u64,
        timestamp: i64,
        encrypted_metadata: &[u8],
    ) -> [[u8; 32]; NUM_PUBLIC_INPUTS] {
        let mut public_inputs = [[0u8; 32]; NUM_PUBLIC_INPUTS];
        public_inputs[0] = merkle_root;
        public_inputs[1] = u64_to_field_bytes(amount);
        public_inputs[2] = i64_to_field_bytes(timestamp);
        public_inputs[3] = u64_to_field_bytes(vault.aml_thresholds[0]);
        public_inputs[4] = u64_to_field_bytes(vault.aml_thresholds[1]);
        public_inputs[5] = u64_to_field_bytes(vault.aml_thresholds[2]);
        public_inputs[6] = u64_to_field_bytes(vault.expired_threshold);
        public_inputs[7] = vault.regulator_pubkey_x;
        public_inputs[8] = vault.regulator_pubkey_y;
        public_inputs[9] = solana_pubkey_to_field_bytes(signer);

        for (index, chunk) in encrypted_metadata.chunks_exact(32).enumerate() {
            public_inputs[10 + index].copy_from_slice(chunk);
        }

        public_inputs
    }

    fn assert_error_name(err: anchor_lang::error::Error, name: &str) {
        assert!(
            format!("{err:?}").contains(name),
            "expected error containing {name}, got {err:?}"
        );
    }

    #[test]
    fn strict_validate_all_public_inputs_accepts_valid_bundle() {
        let vault = sample_vault_state();
        let signer = Pubkey::new_unique();
        let timestamp = 1_763_077_200;
        let amount = 42_000_000;
        let merkle_root = [3u8; 32];
        let encrypted_metadata = vec![11u8; TEST_METADATA_LEN];
        let public_inputs = build_valid_public_inputs(
            &vault,
            &signer,
            merkle_root,
            amount,
            timestamp,
            &encrypted_metadata,
        );

        validate_all_public_inputs(
            &public_inputs,
            merkle_root,
            amount,
            timestamp + 30,
            &vault,
            &signer,
            &encrypted_metadata,
        )
        .unwrap();
    }

    #[test]
    fn strict_rejects_merkle_root_mismatch() {
        let vault = sample_vault_state();
        let signer = Pubkey::new_unique();
        let timestamp = 1_763_077_200;
        let amount = 42_000_000;
        let encrypted_metadata = vec![13u8; TEST_METADATA_LEN];
        let public_inputs = build_valid_public_inputs(
            &vault,
            &signer,
            [3u8; 32],
            amount,
            timestamp,
            &encrypted_metadata,
        );

        let err = validate_all_public_inputs(
            &public_inputs,
            [9u8; 32],
            amount,
            timestamp,
            &vault,
            &signer,
            &encrypted_metadata,
        )
        .unwrap_err();

        assert_error_name(err, "MerkleRootMismatch");
    }

    #[test]
    fn strict_rejects_amount_mismatch() {
        let vault = sample_vault_state();
        let signer = Pubkey::new_unique();
        let timestamp = 1_763_077_200;
        let amount = 42_000_000;
        let encrypted_metadata = vec![17u8; TEST_METADATA_LEN];
        let public_inputs = build_valid_public_inputs(
            &vault,
            &signer,
            [3u8; 32],
            amount,
            timestamp,
            &encrypted_metadata,
        );

        let err = validate_all_public_inputs(
            &public_inputs,
            [3u8; 32],
            amount + 1,
            timestamp,
            &vault,
            &signer,
            &encrypted_metadata,
        )
        .unwrap_err();

        assert_error_name(err, "AmountMismatch");
    }

    #[test]
    fn strict_rejects_stale_timestamp() {
        let vault = sample_vault_state();
        let signer = Pubkey::new_unique();
        let timestamp = 1_763_077_200;
        let amount = 42_000_000;
        let encrypted_metadata = vec![19u8; TEST_METADATA_LEN];
        let public_inputs = build_valid_public_inputs(
            &vault,
            &signer,
            [3u8; 32],
            amount,
            timestamp,
            &encrypted_metadata,
        );

        let err = validate_all_public_inputs(
            &public_inputs,
            [3u8; 32],
            amount,
            timestamp + 61,
            &vault,
            &signer,
            &encrypted_metadata,
        )
        .unwrap_err();

        assert_error_name(err, "StaleProof");
    }

    #[test]
    fn strict_rejects_threshold_mismatch() {
        let vault = sample_vault_state();
        let signer = Pubkey::new_unique();
        let timestamp = 1_763_077_200;
        let amount = 42_000_000;
        let encrypted_metadata = vec![23u8; TEST_METADATA_LEN];
        let mut public_inputs = build_valid_public_inputs(
            &vault,
            &signer,
            [3u8; 32],
            amount,
            timestamp,
            &encrypted_metadata,
        );
        public_inputs[3] = u64_to_field_bytes(DEFAULT_RETAIL_THRESHOLD + 1);

        let err = validate_all_public_inputs(
            &public_inputs,
            [3u8; 32],
            amount,
            timestamp,
            &vault,
            &signer,
            &encrypted_metadata,
        )
        .unwrap_err();

        assert_error_name(err, "ThresholdMismatch");
    }

    #[test]
    fn strict_rejects_regulator_key_mismatch() {
        let vault = sample_vault_state();
        let signer = Pubkey::new_unique();
        let timestamp = 1_763_077_200;
        let amount = 42_000_000;
        let encrypted_metadata = vec![29u8; TEST_METADATA_LEN];
        let mut public_inputs = build_valid_public_inputs(
            &vault,
            &signer,
            [3u8; 32],
            amount,
            timestamp,
            &encrypted_metadata,
        );
        public_inputs[7] = [99u8; 32];

        let err = validate_all_public_inputs(
            &public_inputs,
            [3u8; 32],
            amount,
            timestamp,
            &vault,
            &signer,
            &encrypted_metadata,
        )
        .unwrap_err();

        assert_error_name(err, "RegulatorKeyMismatch");
    }

    #[test]
    fn strict_rejects_wallet_binding_mismatch() {
        let vault = sample_vault_state();
        let signer = Pubkey::new_unique();
        let timestamp = 1_763_077_200;
        let amount = 42_000_000;
        let encrypted_metadata = vec![31u8; TEST_METADATA_LEN];
        let mut public_inputs = build_valid_public_inputs(
            &vault,
            &signer,
            [3u8; 32],
            amount,
            timestamp,
            &encrypted_metadata,
        );
        public_inputs[9] = solana_pubkey_to_field_bytes(&Pubkey::new_unique());

        let err = validate_all_public_inputs(
            &public_inputs,
            [3u8; 32],
            amount,
            timestamp,
            &vault,
            &signer,
            &encrypted_metadata,
        )
        .unwrap_err();

        assert_error_name(err, "WalletBindingMismatch");
    }

    #[test]
    fn strict_replay_protection_hash_uses_all_proof_points() {
        let proof_a = [1u8; 64];
        let proof_b = [2u8; 128];
        let proof_c = [3u8; 64];
        let baseline = compute_proof_hash(&proof_a, &proof_b, &proof_c);

        let mut changed_b = proof_b;
        changed_b[0] ^= 0xAA;
        let mut changed_c = proof_c;
        changed_c[0] ^= 0x55;

        assert_ne!(baseline, compute_proof_hash(&proof_a, &changed_b, &proof_c));
        assert_ne!(baseline, compute_proof_hash(&proof_a, &proof_b, &changed_c));
    }

    #[test]
    fn strict_transfer_record_keeps_full_ciphertext_bytes() {
        let encrypted_metadata = vec![41u8; TEST_METADATA_LEN];
        let record = TransferRecord {
            proof_hash: [1u8; 32],
            transfer_type: TransferType::Deposit,
            amount: 42_000_000,
            timestamp: 1_763_077_200,
            merkle_root_snapshot: [2u8; 32],
            encrypted_metadata: encrypted_metadata.clone(),
            decryption_authorized: false,
            signer: Pubkey::new_unique(),
            mandate_id: [0u8; 32],
            bump: 1,
        };

        assert!(record.encrypted_metadata.len() > 32);
    }

    #[test]
    fn strict_decryption_authorization_marks_transfer_record() {
        let mut record = TransferRecord {
            proof_hash: [1u8; 32],
            transfer_type: TransferType::Transfer,
            amount: 7_000_000,
            timestamp: 1_763_077_200,
            merkle_root_snapshot: [2u8; 32],
            encrypted_metadata: vec![43u8; TEST_METADATA_LEN],
            decryption_authorized: false,
            signer: Pubkey::new_unique(),
            mandate_id: [0u8; 32],
            bump: 1,
        };

        authorize_transfer_record_decryption(&mut record).unwrap();

        assert!(record.decryption_authorized);
    }

    #[test]
    fn risk_paused_vault_rejects() {
        let mut vault = sample_vault_state();
        vault.paused = true;

        let err =
            check_risk_controls(&mut vault, 10, false, &sample_clock(1_763_077_200)).unwrap_err();

        assert_error_name(err, "VaultPaused");
    }

    #[test]
    fn risk_exceeds_single_transaction_limit_rejects() {
        let mut vault = sample_vault_state();
        vault.max_single_transaction = 100;

        let err =
            check_risk_controls(&mut vault, 101, false, &sample_clock(1_763_077_200)).unwrap_err();

        assert_error_name(err, "ExceedsTransactionLimit");
    }

    #[test]
    fn risk_velocity_limit_reached_rejects() {
        let mut vault = sample_vault_state();
        vault.max_daily_transactions = 2;
        vault.daily_transaction_count = 2;

        let err =
            check_risk_controls(&mut vault, 10, false, &sample_clock(1_763_077_200)).unwrap_err();

        assert_error_name(err, "VelocityLimitExceeded");
    }

    #[test]
    fn risk_circuit_breaker_triggers_and_sets_paused() {
        let mut vault = sample_vault_state();
        vault.circuit_breaker_threshold = 100;
        vault.daily_outflow_total = 90;

        let err =
            check_risk_controls(&mut vault, 11, true, &sample_clock(1_763_077_200)).unwrap_err();

        assert_error_name(err, "CircuitBreakerTriggered");
        assert!(vault.paused);
        assert_eq!(vault.daily_outflow_total, 90);
    }

    #[test]
    fn risk_rolling_window_resets_after_24h() {
        let mut vault = sample_vault_state();
        vault.outflow_window_start = 1_763_000_000;
        vault.daily_outflow_total = 55;
        vault.max_daily_transactions = 2;
        vault.daily_transaction_count = 2;
        let clock = sample_clock(vault.outflow_window_start + 86_400);

        check_risk_controls(&mut vault, 10, false, &clock).unwrap();

        assert_eq!(vault.daily_outflow_total, 0);
        assert_eq!(vault.daily_transaction_count, 1);
        assert_eq!(vault.outflow_window_start, clock.unix_timestamp);
    }

    #[test]
    fn risk_outflow_below_threshold_passes() {
        let mut vault = sample_vault_state();
        vault.circuit_breaker_threshold = 100;
        vault.daily_outflow_total = 80;

        check_risk_controls(&mut vault, 20, true, &sample_clock(1_763_077_200)).unwrap();

        assert_eq!(vault.daily_outflow_total, 100);
        assert_eq!(vault.daily_transaction_count, 1);
        assert!(!vault.paused);
    }

    #[test]
    fn risk_non_outflow_does_not_check_circuit_breaker() {
        let mut vault = sample_vault_state();
        vault.circuit_breaker_threshold = 50;
        vault.daily_outflow_total = 40;

        check_risk_controls(&mut vault, 75, false, &sample_clock(1_763_077_200)).unwrap();

        assert_eq!(vault.daily_outflow_total, 40);
        assert_eq!(vault.daily_transaction_count, 1);
        assert!(!vault.paused);
    }

    #[test]
    fn risk_deposit_concentration_limit_rejects() {
        let mut vault = sample_vault_state();
        vault.max_single_deposit = 25;

        let err = enforce_deposit_limit(&vault, 26).unwrap_err();

        assert_error_name(err, "ExceedsDepositLimit");
    }

    #[test]
    fn risk_deposit_concentration_limit_accepts_allowed_amount() {
        let mut vault = sample_vault_state();
        vault.max_single_deposit = 25;

        enforce_deposit_limit(&vault, 25).unwrap();
    }

    #[test]
    fn admin_unpause_resets_all_counters() {
        let mut vault = sample_vault_state();
        vault.paused = true;
        vault.daily_outflow_total = 500;
        vault.daily_transaction_count = 12;

        apply_unpause(&mut vault, 1_763_155_555);

        assert!(!vault.paused);
        assert_eq!(vault.daily_outflow_total, 0);
        assert_eq!(vault.daily_transaction_count, 0);
        assert_eq!(vault.outflow_window_start, 1_763_155_555);
    }

    #[test]
    fn admin_update_risk_limits_sets_all_fields() {
        let mut vault = sample_vault_state();

        apply_risk_limit_update(&mut vault, 1_000, 250, 125, 16);

        assert_eq!(vault.circuit_breaker_threshold, 1_000);
        assert_eq!(vault.max_single_transaction, 250);
        assert_eq!(vault.max_single_deposit, 125);
        assert_eq!(vault.max_daily_transactions, 16);
    }

    #[test]
    fn custody_update_provider_sets_provider_and_authority() {
        let mut vault = sample_vault_state();
        let custody_authority = Pubkey::new_unique();

        apply_custody_provider_update(&mut vault, CustodyProvider::Anchorage, custody_authority);

        assert_eq!(vault.custody_provider, CustodyProvider::Anchorage);
        assert_eq!(vault.custody_authority, custody_authority);
    }

    #[test]
    fn custody_provider_serialization_roundtrip() {
        let provider = CustodyProvider::BitGo;
        let encoded = provider.try_to_vec().unwrap();
        let decoded = CustodyProvider::try_from_slice(&encoded).unwrap();

        assert_eq!(decoded, provider);
    }

    #[test]
    fn yield_accrue_increases_total_assets_and_share_price() {
        let mut vault = sample_vault_state();
        vault.total_assets = 10_000;
        vault.total_shares = 10_000;
        vault.share_price_numerator = 1;
        vault.share_price_denominator = 1;

        apply_accrue_yield(&mut vault, 500).unwrap();

        assert_eq!(vault.total_assets, 10_500);
        assert_eq!(vault.share_price_numerator, 10_500);
        assert_eq!(vault.share_price_denominator, 10_000);
    }

    #[test]
    fn yield_accrue_share_price_calculation_correct_after_yield() {
        let mut vault = sample_vault_state();
        vault.total_assets = 25_000;
        vault.total_shares = 20_000;

        apply_accrue_yield(&mut vault, 5_000).unwrap();

        assert_eq!(vault.share_price_numerator, 30_000);
        assert_eq!(vault.share_price_denominator, 20_000);
    }

    #[test]
    fn yield_accrue_tracks_total_yield_earned() {
        let mut vault = sample_vault_state();
        vault.total_yield_earned = 700;

        apply_accrue_yield(&mut vault, 300).unwrap();

        assert_eq!(vault.total_yield_earned, 1_000);
    }

    #[test]
    fn share_first_deposit_mints_one_to_one() {
        let minted = calculate_deposit_shares(0, 0, 10_000).unwrap();
        assert_eq!(minted, 10_000);
    }

    #[test]
    fn share_price_increases_after_yield() {
        let (num, denom) = update_share_price(10_500, 10_000).unwrap();
        assert_eq!((num, denom), (10_500, 10_000));
    }

    #[test]
    fn share_second_deposit_uses_current_price() {
        let minted = calculate_deposit_shares(10_500, 10_000, 1_050).unwrap();
        assert_eq!(minted, 1_000);
    }

    #[test]
    fn share_withdrawal_returns_correct_assets() {
        let assets = calculate_withdrawal_assets(10_500, 10_000, 1_000).unwrap();
        assert_eq!(assets, 1_050);
    }

    #[test]
    fn share_zero_shares_cannot_be_withdrawn() {
        let err = calculate_withdrawal_assets(10_500, 10_000, 0).unwrap_err();
        assert_error_name(err, "ZeroShares");
    }

    #[test]
    fn share_accounting_stays_consistent_over_multiple_ops() {
        let first_mint = calculate_deposit_shares(0, 0, 10_000).unwrap();
        let mut total_assets = 10_000;
        let mut total_shares = first_mint;

        total_assets += 500;
        let second_mint = calculate_deposit_shares(total_assets, total_shares, 1_050).unwrap();
        total_assets += 1_050;
        total_shares += second_mint;

        let withdrawn_assets =
            calculate_withdrawal_assets(total_assets, total_shares, 500).unwrap();
        total_assets -= withdrawn_assets;
        total_shares -= 500;

        assert_eq!(total_assets, 11_025);
        assert_eq!(total_shares, 10_500);
    }

    fn sample_risk_oracle(last_updated: i64) -> RiskOracle {
        RiskOracle {
            vault: Pubkey::new_unique(),
            risk_authority: Pubkey::new_unique(),
            default_risk_score: 0,
            risk_threshold: DEFAULT_RISK_THRESHOLD,
            max_staleness: DEFAULT_MAX_ORACLE_STALENESS,
            last_updated,
            active: true,
            bump: 1,
        }
    }

    #[test]
    fn risk_oracle_accepts_fresh_oracle_with_low_default() {
        let oracle = sample_risk_oracle(1_763_077_200);
        check_address_risk(&oracle, None, 1_763_077_200 + 100).unwrap();
    }

    #[test]
    fn risk_oracle_rejects_stale_oracle() {
        let oracle = sample_risk_oracle(1_763_000_000);
        let err = check_address_risk(
            &oracle,
            None,
            1_763_000_000 + DEFAULT_MAX_ORACLE_STALENESS + 1,
        )
        .unwrap_err();
        assert_error_name(err, "RiskOracleStale");
    }

    #[test]
    fn risk_oracle_rejects_inactive() {
        let mut oracle = sample_risk_oracle(1_763_077_200);
        oracle.active = false;
        let err = check_address_risk(&oracle, None, 1_763_077_200 + 100).unwrap_err();
        assert_error_name(err, "RiskOracleInactive");
    }

    #[test]
    fn risk_oracle_uses_address_score_when_present() {
        let oracle = sample_risk_oracle(1_763_077_200);
        let score = AddressRiskScore {
            oracle: oracle.vault,
            address: Pubkey::new_unique(),
            risk_score: 90,
            last_updated: 1_763_077_200,
            bump: 1,
        };
        let err = check_address_risk(&oracle, Some(&score), 1_763_077_200 + 100).unwrap_err();
        assert_error_name(err, "RiskScoreExceeded");
    }

    #[test]
    fn risk_oracle_passes_address_score_below_threshold() {
        let oracle = sample_risk_oracle(1_763_077_200);
        let score = AddressRiskScore {
            oracle: oracle.vault,
            address: Pubkey::new_unique(),
            risk_score: 50,
            last_updated: 1_763_077_200,
            bump: 1,
        };
        check_address_risk(&oracle, Some(&score), 1_763_077_200 + 100).unwrap();
    }

    #[test]
    fn risk_oracle_default_score_can_exceed_threshold() {
        let mut oracle = sample_risk_oracle(1_763_077_200);
        oracle.default_risk_score = 80;
        let err = check_address_risk(&oracle, None, 1_763_077_200 + 100).unwrap_err();
        assert_error_name(err, "RiskScoreExceeded");
    }

    #[test]
    fn mandate_id_preserved_in_transfer_record() {
        let mandate = [42u8; 32];
        let record = TransferRecord {
            proof_hash: [1u8; 32],
            transfer_type: TransferType::Deposit,
            amount: 1_000_000,
            timestamp: 1_763_077_200,
            merkle_root_snapshot: [2u8; 32],
            encrypted_metadata: vec![0u8; TEST_METADATA_LEN],
            decryption_authorized: false,
            signer: Pubkey::new_unique(),
            mandate_id: mandate,
            bump: 1,
        };
        assert_eq!(record.mandate_id, mandate);
    }
}
