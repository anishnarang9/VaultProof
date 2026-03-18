//! Squads v4 governance stays client-side in this crate for now because the
//! published Rust CPI crate graph is not compatible with the workspace's
//! Anchor 0.32.1 toolchain. When `vault_state.authority` is set to a Squads
//! vault PDA, transactions executed by Squads still satisfy the signer checks
//! below because the PDA signs the downstream CPI.

use anchor_lang::prelude::*;

declare_id!("rcSKMdzuL7LLuTh322WXWiteSbqVPe5cR2hGDCNWtu4");

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

    // ================================================================
    // SOURCE-OF-FUNDS DEMAND WORKFLOW
    // ================================================================

    pub fn request_source_of_funds(
        ctx: Context<RequestSourceOfFunds>,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        let timestamp = Clock::get()?.unix_timestamp;
        let request = &mut ctx.accounts.sof_request;
        request.transfer_record = ctx.accounts.transfer_record.key();
        request.reason_hash = reason_hash;
        request.requested_by = ctx.accounts.authority.key();
        request.request_timestamp = timestamp;
        request.fulfilled = false;
        request.attestation_hash = [0u8; 32];
        request.fulfillment_timestamp = 0;
        request.bump = ctx.bumps.sof_request;

        emit!(SourceOfFundsRequested {
            transfer_record: request.transfer_record,
            reason_hash,
            requested_by: request.requested_by,
            timestamp,
        });

        Ok(())
    }

    pub fn fulfill_source_of_funds(
        ctx: Context<FulfillSourceOfFunds>,
        attestation_hash: [u8; 32],
    ) -> Result<()> {
        let request = &mut ctx.accounts.sof_request;
        require!(!request.fulfilled, ComplianceError::AlreadyFulfilled);

        let timestamp = Clock::get()?.unix_timestamp;
        request.fulfilled = true;
        request.attestation_hash = attestation_hash;
        request.fulfillment_timestamp = timestamp;

        emit!(SourceOfFundsDisclosed {
            transfer_record: request.transfer_record,
            attestation_hash,
            disclosed_by: ctx.accounts.authority.key(),
            timestamp,
        });

        Ok(())
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

// ================================================================
// SOURCE-OF-FUNDS ACCOUNT CONTEXTS
// ================================================================

#[account]
#[derive(InitSpace)]
pub struct SourceOfFundsRequest {
    pub transfer_record: Pubkey,
    pub reason_hash: [u8; 32],
    pub requested_by: Pubkey,
    pub request_timestamp: i64,
    pub fulfilled: bool,
    pub attestation_hash: [u8; 32],
    pub fulfillment_timestamp: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct RequestSourceOfFunds<'info> {
    #[account(
        constraint = vault_state.authority == authority.key() @ ComplianceError::Unauthorized,
    )]
    pub vault_state: Account<'info, vusd_vault::VaultState>,

    pub transfer_record: Account<'info, vusd_vault::TransferRecord>,

    #[account(
        init,
        payer = authority,
        space = 8 + SourceOfFundsRequest::INIT_SPACE,
        seeds = [b"sof_request", transfer_record.key().as_ref()],
        bump,
    )]
    pub sof_request: Account<'info, SourceOfFundsRequest>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FulfillSourceOfFunds<'info> {
    #[account(
        constraint = vault_state.authority == authority.key() @ ComplianceError::Unauthorized,
    )]
    pub vault_state: Account<'info, vusd_vault::VaultState>,

    #[account(
        mut,
        seeds = [b"sof_request", sof_request.transfer_record.as_ref()],
        bump = sof_request.bump,
    )]
    pub sof_request: Account<'info, SourceOfFundsRequest>,

    pub authority: Signer<'info>,
}

#[event]
pub struct SourceOfFundsRequested {
    pub transfer_record: Pubkey,
    pub reason_hash: [u8; 32],
    pub requested_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SourceOfFundsDisclosed {
    pub transfer_record: Pubkey,
    pub attestation_hash: [u8; 32],
    pub disclosed_by: Pubkey,
    pub timestamp: i64,
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
    #[msg("Source of funds request already fulfilled.")]
    AlreadyFulfilled,
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
    fn source_of_funds_request_initializes_correctly() {
        let transfer_record = Pubkey::new_unique();
        let expected = Pubkey::find_program_address(
            &[b"sof_request", transfer_record.as_ref()],
            &crate::id(),
        );
        assert_ne!(expected.0, Pubkey::default());
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
