use anchor_lang::prelude::*;
use solana_poseidon::{hashv as poseidon_hashv, Endianness, Parameters};

declare_id!("NsgKr1qCEUb1vXdwaGvbz3ygG4R4SCrUQm3T8tHoqgD");

pub const STATE_TREE_DEPTH: usize = 20;
pub const MAX_LEAVES: u32 = 1 << STATE_TREE_DEPTH;
const ZERO_VALUE: [u8; 32] = [0u8; 32];

#[program]
pub mod kyc_registry {
    use super::*;

    pub fn initialize_registry(
        ctx: Context<InitRegistry>,
        state_tree_pubkey: Pubkey,
        issuer_pubkey: [u8; 32],
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.state_tree.key(),
            state_tree_pubkey,
            KycError::StateTreePubkeyMismatch
        );

        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.state_tree = state_tree_pubkey;
        registry.credential_count = 0;
        registry.revoked_count = 0;
        registry.issuer_pubkey = issuer_pubkey;
        registry.merkle_root = compute_empty_root()?;
        registry.bump = ctx.bumps.registry;

        let state_tree = &mut ctx.accounts.state_tree;
        state_tree.registry = registry.key();
        state_tree.root = registry.merkle_root;
        state_tree.depth = STATE_TREE_DEPTH as u8;
        state_tree.next_index = 0;
        state_tree.bump = ctx.bumps.state_tree;

        Ok(())
    }

    pub fn add_credential(
        ctx: Context<AddCredential>,
        leaf_hash: [u8; 32],
        merkle_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        let state_tree = &mut ctx.accounts.state_tree;

        require!(state_tree.next_index < MAX_LEAVES, KycError::StateTreeFull);

        let zero_leaf = zero_leaf_hash()?;
        let current_root =
            compute_root_from_proof(zero_leaf, state_tree.next_index, &merkle_proof)?;
        require!(
            current_root == state_tree.root,
            KycError::InvalidMerkleProof
        );

        let credential_leaf = &mut ctx.accounts.credential_leaf;
        credential_leaf.registry = registry.key();
        credential_leaf.state_tree = state_tree.key();
        credential_leaf.leaf_hash = leaf_hash;
        credential_leaf.leaf_index = state_tree.next_index;
        credential_leaf.active = true;
        credential_leaf.bump = ctx.bumps.credential_leaf;

        state_tree.root = compute_root_from_proof(leaf_hash, state_tree.next_index, &merkle_proof)?;
        registry.merkle_root = state_tree.root;
        state_tree.next_index = state_tree
            .next_index
            .checked_add(1)
            .ok_or_else(|| error!(KycError::MathOverflow))?;

        registry.credential_count = registry
            .credential_count
            .checked_add(1)
            .ok_or_else(|| error!(KycError::MathOverflow))?;

        emit!(CredentialAdded {
            leaf_hash,
            timestamp: Clock::get()?.unix_timestamp,
            credential_count: registry.credential_count,
            leaf_index: credential_leaf.leaf_index,
            new_root: state_tree.root,
        });

        Ok(())
    }

    pub fn revoke_credential(
        ctx: Context<RevokeCredential>,
        leaf_hash: [u8; 32],
        merkle_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        let state_tree = &mut ctx.accounts.state_tree;
        let credential_leaf = &mut ctx.accounts.credential_leaf;

        require!(credential_leaf.active, KycError::AlreadyRevoked);
        require!(
            credential_leaf.leaf_hash == leaf_hash,
            KycError::CredentialLeafMismatch
        );

        let current_root =
            compute_root_from_proof(leaf_hash, credential_leaf.leaf_index, &merkle_proof)?;
        require!(
            current_root == state_tree.root,
            KycError::InvalidMerkleProof
        );

        let zero_leaf = zero_leaf_hash()?;
        state_tree.root =
            compute_root_from_proof(zero_leaf, credential_leaf.leaf_index, &merkle_proof)?;
        registry.merkle_root = state_tree.root;
        credential_leaf.active = false;
        registry.revoked_count = registry
            .revoked_count
            .checked_add(1)
            .ok_or_else(|| error!(KycError::MathOverflow))?;

        emit!(CredentialRevoked {
            leaf_hash,
            timestamp: Clock::get()?.unix_timestamp,
            revoked_count: registry.revoked_count,
            new_root: state_tree.root,
        });

        Ok(())
    }

    pub fn transfer_authority(
        ctx: Context<TransferAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.registry.authority = new_authority;
        Ok(())
    }
}

#[account]
pub struct KycRegistry {
    pub authority: Pubkey,
    pub state_tree: Pubkey,
    pub credential_count: u64,
    pub revoked_count: u64,
    pub issuer_pubkey: [u8; 32],
    pub merkle_root: [u8; 32],
    pub bump: u8,
}

impl KycRegistry {
    pub const fn space() -> usize {
        8 + 32 + 32 + 8 + 8 + 32 + 32 + 1
    }
}

#[account]
pub struct StateTree {
    pub registry: Pubkey,
    pub root: [u8; 32],
    pub depth: u8,
    pub next_index: u32,
    pub bump: u8,
}

impl StateTree {
    pub const fn space() -> usize {
        8 + 32 + 32 + 1 + 4 + 1
    }
}

#[account]
pub struct CredentialLeaf {
    pub registry: Pubkey,
    pub state_tree: Pubkey,
    pub leaf_hash: [u8; 32],
    pub leaf_index: u32,
    pub active: bool,
    pub bump: u8,
}

impl CredentialLeaf {
    pub const fn space() -> usize {
        8 + 32 + 32 + 32 + 4 + 1 + 1
    }
}

#[derive(Accounts)]
#[instruction(state_tree_pubkey: Pubkey, issuer_pubkey: [u8; 32])]
pub struct InitRegistry<'info> {
    #[account(
        init,
        payer = authority,
        space = KycRegistry::space(),
        seeds = [b"kyc_registry"],
        bump,
    )]
    pub registry: Account<'info, KycRegistry>,

    #[account(
        init,
        payer = authority,
        space = StateTree::space(),
        seeds = [b"state_tree", registry.key().as_ref()],
        bump,
        constraint = state_tree.key() == state_tree_pubkey @ KycError::StateTreePubkeyMismatch,
    )]
    pub state_tree: Account<'info, StateTree>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(leaf_hash: [u8; 32], merkle_proof: Vec<[u8; 32]>)]
pub struct AddCredential<'info> {
    #[account(
        mut,
        seeds = [b"kyc_registry"],
        bump = registry.bump,
        has_one = authority,
    )]
    pub registry: Account<'info, KycRegistry>,

    #[account(
        mut,
        seeds = [b"state_tree", registry.key().as_ref()],
        bump = state_tree.bump,
        address = registry.state_tree,
        constraint = state_tree.registry == registry.key() @ KycError::StateTreeRegistryMismatch,
        constraint = state_tree.depth == STATE_TREE_DEPTH as u8 @ KycError::InvalidStateTreeDepth,
    )]
    pub state_tree: Account<'info, StateTree>,

    #[account(
        init,
        payer = authority,
        space = CredentialLeaf::space(),
        seeds = [b"credential_leaf", registry.key().as_ref(), leaf_hash.as_ref()],
        bump,
    )]
    pub credential_leaf: Account<'info, CredentialLeaf>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(leaf_hash: [u8; 32], merkle_proof: Vec<[u8; 32]>)]
pub struct RevokeCredential<'info> {
    #[account(
        mut,
        seeds = [b"kyc_registry"],
        bump = registry.bump,
        has_one = authority,
    )]
    pub registry: Account<'info, KycRegistry>,

    #[account(
        mut,
        seeds = [b"state_tree", registry.key().as_ref()],
        bump = state_tree.bump,
        address = registry.state_tree,
        constraint = state_tree.registry == registry.key() @ KycError::StateTreeRegistryMismatch,
    )]
    pub state_tree: Account<'info, StateTree>,

    #[account(
        mut,
        seeds = [b"credential_leaf", registry.key().as_ref(), leaf_hash.as_ref()],
        bump = credential_leaf.bump,
        constraint = credential_leaf.registry == registry.key() @ KycError::CredentialLeafMismatch,
        constraint = credential_leaf.state_tree == state_tree.key() @ KycError::CredentialLeafMismatch,
    )]
    pub credential_leaf: Account<'info, CredentialLeaf>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        seeds = [b"kyc_registry"],
        bump = registry.bump,
        has_one = authority,
    )]
    pub registry: Account<'info, KycRegistry>,

    pub authority: Signer<'info>,
}

#[event]
pub struct CredentialAdded {
    pub leaf_hash: [u8; 32],
    pub timestamp: i64,
    pub credential_count: u64,
    pub leaf_index: u32,
    pub new_root: [u8; 32],
}

#[event]
pub struct CredentialRevoked {
    pub leaf_hash: [u8; 32],
    pub timestamp: i64,
    pub revoked_count: u64,
    pub new_root: [u8; 32],
}

#[error_code]
pub enum KycError {
    #[msg("The supplied state tree pubkey does not match the expected account.")]
    StateTreePubkeyMismatch,
    #[msg("The state tree is full.")]
    StateTreeFull,
    #[msg("The supplied Merkle proof does not match the current root.")]
    InvalidMerkleProof,
    #[msg("The supplied Merkle proof has the wrong length.")]
    InvalidMerkleProofLength,
    #[msg("The state tree registry reference is invalid.")]
    StateTreeRegistryMismatch,
    #[msg("The state tree depth is invalid.")]
    InvalidStateTreeDepth,
    #[msg("The credential leaf account does not match the supplied leaf.")]
    CredentialLeafMismatch,
    #[msg("This credential has already been revoked.")]
    AlreadyRevoked,
    #[msg("A math overflow occurred.")]
    MathOverflow,
    #[msg("Poseidon hashing failed.")]
    PoseidonHashFailed,
}

fn compute_empty_root() -> Result<[u8; 32]> {
    let mut current = zero_leaf_hash()?;
    for _ in 0..STATE_TREE_DEPTH {
        current = hash_pair(&current, &current)?;
    }
    Ok(current)
}

fn zero_leaf_hash() -> Result<[u8; 32]> {
    poseidon_hash(&[&ZERO_VALUE])
}

fn compute_root_from_proof(
    leaf_hash: [u8; 32],
    leaf_index: u32,
    merkle_proof: &[[u8; 32]],
) -> Result<[u8; 32]> {
    require!(
        merkle_proof.len() == STATE_TREE_DEPTH,
        KycError::InvalidMerkleProofLength
    );

    let mut current = leaf_hash;
    let mut cursor = leaf_index;

    for sibling in merkle_proof.iter() {
        current = if cursor % 2 == 0 {
            hash_pair(&current, sibling)?
        } else {
            hash_pair(sibling, &current)?
        };
        cursor /= 2;
    }

    Ok(current)
}

fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> Result<[u8; 32]> {
    poseidon_hash(&[left, right])
}

fn poseidon_hash(inputs: &[&[u8]]) -> Result<[u8; 32]> {
    poseidon_hashv(Parameters::Bn254X5, Endianness::BigEndian, inputs)
        .map(|hash| hash.to_bytes())
        .map_err(|_| error!(KycError::PoseidonHashFailed))
}
