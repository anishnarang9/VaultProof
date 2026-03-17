//! Squads v4 governance stays client-side in this crate for now because the
//! published Rust CPI crate graph is not compatible with the workspace's
//! Anchor 0.32.1 toolchain. When `vault_state.authority` is set to a Squads
//! vault PDA, transactions executed by Squads still satisfy the signer checks
//! below because the PDA signs the downstream CPI.

use anchor_lang::prelude::*;

declare_id!("BsEMZCJzj3SqwSj6z2F3X8m9rFHjLubgBzMeSgj8Lp6K");

#[allow(dead_code)]
fn derive_decryption_authorization_address(transfer_record: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"decryption_auth", transfer_record.as_ref()],
        &crate::id(),
    )
}

fn build_decryption_authorized_event(
    transfer_record: Pubkey,
    reason_hash: [u8; 32],
    authorized_by: Pubkey,
    timestamp: i64,
) -> DecryptionAuthorized {
    DecryptionAuthorized {
        transfer_record,
        reason_hash,
        authorized_by,
        timestamp,
    }
}

#[program]
pub mod compliance_admin {
    use super::*;

    pub fn authorize_decryption(
        ctx: Context<AuthorizeDecryption>,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        let cpi_accounts = vusd_vault::cpi::accounts::MarkDecryptionAuthorized {
            vault_state: ctx.accounts.vault_state.to_account_info(),
            transfer_record: ctx.accounts.transfer_record.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.vusd_vault_program.to_account_info(),
            cpi_accounts,
        );
        vusd_vault::cpi::mark_decryption_authorized(cpi_ctx)?;

        let timestamp = Clock::get()?.unix_timestamp;
        let auth = &mut ctx.accounts.decryption_auth;
        auth.transfer_record = ctx.accounts.transfer_record.key();
        auth.reason_hash = reason_hash;
        auth.authorized_by = ctx.accounts.authority.key();
        auth.timestamp = timestamp;
        auth.bump = ctx.bumps.decryption_auth;

        emit!(build_decryption_authorized_event(
            ctx.accounts.transfer_record.key(),
            reason_hash,
            ctx.accounts.authority.key(),
            timestamp,
        ));

        Ok(())
    }

    pub fn update_aml_thresholds(
        ctx: Context<UpdateThresholds>,
        retail: u64,
        accredited: u64,
        institutional: u64,
        expired: u64,
    ) -> Result<()> {
        let cpi_accounts = vusd_vault::cpi::accounts::AdminUpdate {
            vault_state: ctx.accounts.vault_state.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.vusd_vault_program.to_account_info(),
            cpi_accounts,
        );
        vusd_vault::cpi::update_aml_thresholds(cpi_ctx, retail, accredited, institutional, expired)
    }

    pub fn update_regulator_key(
        ctx: Context<UpdateRegulatorKey>,
        new_pub_key_x: [u8; 32],
        new_pub_key_y: [u8; 32],
    ) -> Result<()> {
        let cpi_accounts = vusd_vault::cpi::accounts::AdminUpdate {
            vault_state: ctx.accounts.vault_state.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.vusd_vault_program.to_account_info(),
            cpi_accounts,
        );
        vusd_vault::cpi::update_regulator_key(cpi_ctx, new_pub_key_x, new_pub_key_y)
    }
}

#[account]
#[derive(InitSpace)]
pub struct DecryptionAuthorization {
    pub transfer_record: Pubkey,
    pub reason_hash: [u8; 32],
    pub authorized_by: Pubkey,
    pub timestamp: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct AuthorizeDecryption<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + DecryptionAuthorization::INIT_SPACE,
        seeds = [b"decryption_auth", transfer_record.key().as_ref()],
        bump,
    )]
    pub decryption_auth: Account<'info, DecryptionAuthorization>,

    #[account(
        mut,
        constraint = vault_state.authority == authority.key() @ ComplianceError::Unauthorized,
    )]
    pub vault_state: Account<'info, vusd_vault::VaultState>,

    #[account(mut)]
    pub transfer_record: Account<'info, vusd_vault::TransferRecord>,

    // The signer may be a human authority today or a Squads vault PDA once the
    // client-side governance flow proposes, approves, and executes this call.
    #[account(mut)]
    pub authority: Signer<'info>,

    pub vusd_vault_program: Program<'info, vusd_vault::program::VusdVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateThresholds<'info> {
    #[account(
        mut,
        constraint = vault_state.authority == authority.key() @ ComplianceError::Unauthorized,
    )]
    pub vault_state: Account<'info, vusd_vault::VaultState>,

    pub authority: Signer<'info>,
    pub vusd_vault_program: Program<'info, vusd_vault::program::VusdVault>,
}

#[derive(Accounts)]
pub struct UpdateRegulatorKey<'info> {
    #[account(
        mut,
        constraint = vault_state.authority == authority.key() @ ComplianceError::Unauthorized,
    )]
    pub vault_state: Account<'info, vusd_vault::VaultState>,

    pub authority: Signer<'info>,
    pub vusd_vault_program: Program<'info, vusd_vault::program::VusdVault>,
}

#[event]
pub struct DecryptionAuthorized {
    pub transfer_record: Pubkey,
    pub reason_hash: [u8; 32],
    pub authorized_by: Pubkey,
    pub timestamp: i64,
}

#[error_code]
pub enum ComplianceError {
    #[msg("Unauthorized: caller is not the vault authority.")]
    Unauthorized,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decryption_authorization_is_seeded_by_transfer_record_address() {
        let transfer_record = Pubkey::new_unique();
        let expected = Pubkey::find_program_address(
            &[b"decryption_auth", transfer_record.as_ref()],
            &crate::id(),
        );

        assert_eq!(
            derive_decryption_authorization_address(&transfer_record),
            expected
        );
    }

    #[test]
    fn decryption_authorization_event_uses_real_transfer_record_key() {
        let transfer_record = Pubkey::new_unique();
        let reason_hash = [9u8; 32];
        let authorized_by = Pubkey::new_unique();
        let timestamp = 1_763_077_200;

        let event = build_decryption_authorized_event(
            transfer_record,
            reason_hash,
            authorized_by,
            timestamp,
        );

        assert_eq!(event.transfer_record, transfer_record);
        assert_eq!(event.reason_hash, reason_hash);
        assert_eq!(event.authorized_by, authorized_by);
        assert_eq!(event.timestamp, timestamp);
    }
}
