# VAULTPROOF — VC AUDIT FIX ADDENDUM
## Comprehensive Response to 30-Issue Diligence Report
## Attach alongside: vaultproof-technical-architecture.md + vaultproof-track1-addendum.md

---

# DECISION SUMMARY

| Bug # | Issue | Decision | Category |
|-------|-------|----------|----------|
| 1 | Encrypted metadata not stored on-chain | Store full ciphertext in TransferRecord PDA (~320 bytes) | MUST-FIX (code) |
| 2+8 | On-chain verifier ignores most public inputs + stale proofs | Full validation: check ALL public inputs (root, amount, timestamp within 60s, regulator key, issuer key, encrypted metadata) | MUST-FIX (code) |
| 3 | Revocation doesn't work | Rebuild Merkle root on revocation: replace leaf with zero, recompute root. Instant invalidation. | MUST-FIX (code) |
| 4 | AML thresholds hardcoded in circuit | Make thresholds public inputs. Circuit recompile required. On-chain verifier checks threshold inputs match vault state. | MUST-FIX (circuit + code) |
| 5+6 | Regulator key and issuer key not validated | Issuer key stays hardcoded in circuit (single-issuer model). Regulator key validated on-chain as part of full public input validation (Bug #2 fix). | MUST-FIX (code) |
| 7 | KYC registry root is trusted, not verified | Keep trusted authority model. AMINA is FINMA-regulated. Add comprehensive event logging for auditability. Document as deliberate design choice. | DOCUMENT |
| 9 | Credential not bound to wallet | Add wallet pubkey to credential hash. Circuit proves knowledge of private key matching the pubkey in the credential. Credential becomes wallet-specific. | MUST-FIX (circuit + code) |
| 10 | No replay protection | PDA keyed by proof_hash. Replayed proof = already-initialized PDA = automatic Solana rejection. | MUST-FIX (code) |
| 11 | Decryption auth not anchored to real transfer | Require TransferRecord account in instruction context. Anchor deserializes it, proving existence. Auth PDA derived from TransferRecord address. | MUST-FIX (code) |
| 12-14 | Frontend is simulation / fake metrics / Vite starter | Full rewire: real router, real on-chain data, live queries, honest stats. Every flow calls real programs. | MUST-FIX (frontend) |
| 15+19+21 | Doc/code drift, fragile proof buffer, single authority | Code-first reconciliation: update docs to match code, add nonce to proof buffer PDA seed, document authority as Squads-compatible. | SHOULD-FIX (code + docs) |
| 17 | Tree doesn't scale past 1,024 | Light Protocol ZK Compression + depth 20 (1M leaves). Full Merkle tree architecture overhaul. | MUST-FIX (code) |
| 18 | Browser localStorage for credentials | Document in ADRs. Production path: encrypted vault / HSM / Fireblocks key storage. | DOCUMENT |
| 20+22 | Privacy overclaim + 72hr/24hr mismatch | Rebrand to "confidential compliance." Fix timelock to 72hr everywhere. New tagline: "Compliant stablecoins with confidential identity." | MUST-FIX (copy + frontend) |
| 23-25 | Buyer unclear + too many businesses + stablecoin issuer risk | B2B2C protocol with role-based UI. Tokenized Vault Shares (not stablecoin). AMINA is first deployment, protocol is issuer-agnostic. | MUST-FIX (architecture + frontend) |
| 26-30 | Distribution, partner story, moat, diligence signaling, operational maturity | README Production Roadmap table + ADR appendix. Honest about hackathon scope vs production scope. | DOCUMENT |

---

# SECTION 1: CIRCUIT RECOMPILE SPECIFICATION

The circuit must be recompiled with four changes. These are all happening in a single recompile + re-setup.

## Change 1: AML Thresholds → Public Inputs

**Before:** Thresholds hardcoded as constants in tiered_threshold.circom
```circom
// OLD — hardcoded
var RETAIL_THRESHOLD = 10000000000;
var ACCREDITED_THRESHOLD = 1000000000000;
var INSTITUTIONAL_THRESHOLD = 18446744073709551615;
var EXPIRED_THRESHOLD = 1000000000;
```

**After:** Thresholds are public inputs verified on-chain
```circom
// NEW — public inputs
signal input retailThreshold;       // PUBLIC — verified against vault state
signal input accreditedThreshold;   // PUBLIC — verified against vault state
signal input institutionalThreshold;// PUBLIC — verified against vault state
signal input expiredThreshold;      // PUBLIC — verified against vault state
```

**On-chain verifier change:** After proof verification, the Solana program checks:
```rust
// Extract threshold public inputs from proof
let proof_retail_threshold = public_inputs[N]; // index depends on final ordering
let proof_accredited_threshold = public_inputs[N+1];
// ... etc

// Compare against vault state
require!(
    proof_retail_threshold == vault_state.aml_thresholds[0],
    VaultError::ThresholdMismatch
);
// ... for all four thresholds
```

**Impact:** The `update_aml_thresholds` admin instruction now ACTUALLY CHANGES enforcement. When AMINA updates the retail threshold from $10k to $5k, the next proof must use the new threshold as a public input, and the on-chain verifier confirms it matches.

## Change 2: Wallet Binding → Credential Hash

**Before:** Credential leaf = Poseidon(credentialFields, identitySecret)
**After:** Credential leaf = Poseidon(credentialFields, identitySecret, walletPubkey)

```circom
// NEW — wallet binding
signal input walletPubkey;  // PUBLIC — the Solana wallet pubkey that owns this credential

// Wallet pubkey becomes part of the leaf hash
component leafHasher = Poseidon(3);  // was Poseidon(2)
leafHasher.inputs[0] <== credHashFinal.out;
leafHasher.inputs[1] <== identitySecret;
leafHasher.inputs[2] <== walletPubkey;  // NEW — binds credential to wallet
```

**On-chain verifier change:**
```rust
// The walletPubkey in the proof must match the transaction signer
// For deposits: matches the main wallet depositing USDC
// For transfers: matches the stealth account signer
let proof_wallet = public_inputs[WALLET_INDEX];
let signer_bytes = ctx.accounts.signer.key().to_bytes();
let signer_field = bytes_to_field_element(&signer_bytes);
require!(proof_wallet == signer_field, VaultError::WalletBindingMismatch);
```

**Credential issuance change:** When AMINA issues a credential, the user's wallet pubkey is included in the hash. The credential file stores the wallet pubkey. The credential only works with that specific wallet.

**Important UX implication:** If a user loses their wallet, the credential is invalid. They must contact AMINA for re-issuance. This is CORRECT behavior for a compliance system — identity should not be transferable.

## Change 3: Tree Depth 10 → 20

```circom
// OLD
component main {public [...]} = VaultProofCompliance(10);

// NEW
component main {public [...]} = VaultProofCompliance(20);
```

**Circuit impact:**
- Additional constraints: ~3,000 (10 more Poseidon hashes in Merkle verification)
- New total constraints: ~40,300 (up from ~37,260)
- Proof generation time: ~6-9 seconds (up from ~4-7 seconds)
- Powers of Tau: still fits in pot16 (supports up to 65,536 constraints)
- Proof size: unchanged (128 bytes)

## Change 4: Updated Public Inputs Ordering

The full list of public inputs after all changes:

```circom
component main {public [
    // Compliance state
    merkleRoot,              // [0] — checked against KYC registry
    transferAmount,          // [1] — checked against instruction amount
    currentTimestamp,        // [2] — checked within 60s of Solana clock
    
    // Threshold inputs (governable)
    retailThreshold,         // [3] — checked against vault state
    accreditedThreshold,     // [4] — checked against vault state  
    institutionalThreshold,  // [5] — checked against vault state
    expiredThreshold,        // [6] — checked against vault state
    
    // Key material
    regulatorPubKeyX,        // [7] — checked against vault state
    regulatorPubKeyY,        // [8] — checked against vault state
    
    // Wallet binding
    walletPubkey,            // [9] — checked against transaction signer
    
    // ElGamal ciphertext (Travel Rule metadata)
    encryptedMetadata        // [10..N] — stored in TransferRecord for regulator access
]} = VaultProofCompliance(20);
```

**Total public inputs: ~20** (10 scalar + ~10 for ElGamal ciphertext components)

## Trusted Setup Redo

Since the circuit is recompiled, the entire trusted setup must be redone:
```bash
# 1. Recompile circuit
circom compliance.circom --r1cs --wasm --sym -o build/

# 2. New trusted setup
snarkjs powersoftau new bn128 16 pot16_0000.ptau
snarkjs powersoftau contribute pot16_0000.ptau pot16_0001.ptau
snarkjs powersoftau prepare phase2 pot16_0001.ptau pot16_final.ptau
snarkjs groth16 setup build/compliance.r1cs pot16_final.ptau circuit_0000.zkey
snarkjs zkey contribute circuit_0000.zkey circuit_final.zkey
snarkjs zkey export verificationkey circuit_final.zkey verification_key.json

# 3. Generate new verifying key for Solana program
node scripts/parse-vk.js verification_key.json > programs/vusd-vault/src/verifying_key.rs

# 4. Rebuild Solana programs with new verifying key
anchor build

# 5. Update frontend WASM + zkey files
cp build/compliance_js/compliance.wasm app/public/circuits/
cp circuit_final.zkey app/public/circuits/
```

---

# SECTION 2: KYC REGISTRY OVERHAUL (Light Protocol ZK Compression)

## Architecture Change

**Before:** Single PDA account storing all leaves + root. Max 1,024 leaves.

**After:** Light Protocol compressed accounts for leaf storage. On-chain root in a lightweight PDA. Supports 1,048,576 leaves at fractional cost.

## How Light Protocol ZK Compression Works

Light Protocol stores data as compressed accounts in Solana's ledger space (much cheaper than account space). Each compressed account is a leaf in a state tree. The state tree root is stored on-chain. To prove you own a compressed account, you provide a Merkle proof against the state tree root.

This maps perfectly to our KYC registry:
- Each credential leaf = one compressed account
- The state tree root = our KYC Merkle root
- Credential Merkle proofs come from Light's indexer (Photon)
- Our circuit verifies the Merkle proof against the root

## New KYC Registry Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    KYC REGISTRY (Light Protocol)                  │
│                                                                  │
│  On-chain (lightweight PDA):                                     │
│    • authority: Pubkey (AMINA)                                   │
│    • state_tree_pubkey: Pubkey (Light's Merkle tree account)     │
│    • credential_count: u64                                       │
│    • issuer_pubkey: [u8; 32] (AMINA's EdDSA key, for reference) │
│    • revoked_count: u64                                          │
│                                                                  │
│  Light Protocol compressed accounts (off-chain, indexed):        │
│    • Each credential leaf stored as a compressed account          │
│    • Leaf data: credential_hash (32 bytes)                       │
│    • Tree depth: 20 (supports 1,048,576 leaves)                 │
│    • Hash function: Poseidon (matches circuit natively)          │
│                                                                  │
│  Indexer (Photon by Helius):                                     │
│    • Indexes all compressed accounts                             │
│    • Provides Merkle proofs for any leaf                         │
│    • Client queries indexer to get proof for their credential    │
│                                                                  │
│  Revocation:                                                     │
│    • Nullify the compressed account (Light Protocol native op)   │
│    • State tree root updates automatically                       │
│    • Old Merkle proof instantly invalid                          │
└──────────────────────────────────────────────────────────────────┘
```

## New Instructions

```rust
use light_sdk::{
    compressed_account::CompressedAccount,
    merkle_context::PackedMerkleContext,
};

// Initialize registry with Light Protocol state tree
pub fn initialize_registry(
    ctx: Context<InitRegistry>,
    // Light Protocol state tree is created externally and referenced here
    state_tree: Pubkey,
) -> Result<()>

// Add credential — creates a compressed account in Light's state tree
pub fn add_credential(
    ctx: Context<AddCredential>,
    leaf_hash: [u8; 32],
    // Light Protocol proof/context for compressed account creation
    merkle_context: PackedMerkleContext,
) -> Result<()> {
    // 1. Verify authority (AMINA)
    // 2. Create compressed account via Light Protocol CPI
    //    - Account data = leaf_hash
    //    - Automatically added to state tree
    //    - State tree root updates atomically
    // 3. Increment credential_count
    // 4. Emit event: CredentialAdded { leaf_hash, timestamp, credential_count }
}

// Revoke credential — nullifies the compressed account
pub fn revoke_credential(
    ctx: Context<RevokeCredential>,
    leaf_hash: [u8; 32],
    // Light Protocol proof showing the account exists
    merkle_context: PackedMerkleContext,
    merkle_proof: Vec<[u8; 32]>,
) -> Result<()> {
    // 1. Verify authority (AMINA)
    // 2. Nullify compressed account via Light Protocol CPI
    //    - Leaf effectively replaced with zero
    //    - State tree root updates atomically
    //    - Old Merkle proof instantly invalid
    // 3. Increment revoked_count
    // 4. Emit event: CredentialRevoked { leaf_hash, timestamp }
}
```

## Client-Side Merkle Proof Retrieval

```typescript
import { Rpc } from "@lightprotocol/stateless.js";

// Connect to Light Protocol's indexer (Photon)
const rpc = createRpc(SOLANA_RPC_URL, COMPRESSION_RPC_URL);

// Get Merkle proof for a credential leaf
async function getCredentialMerkleProof(leafHash: string): Promise<MerkleProof> {
    // Query the compressed account by its leaf hash
    const accounts = await rpc.getCompressedAccountsByOwner(registryPubkey);
    
    // Find the specific credential
    const credential = accounts.find(a => a.hash === leafHash);
    
    // Get the validity proof (Merkle path)
    const proof = await rpc.getValidityProof([credential.hash]);
    
    return {
        pathElements: proof.merklePath,
        pathIndices: proof.merklePathIndices,
        root: proof.root,
    };
}
```

## Why This Is Better Than The Other Options

1. **Poseidon-native**: Light Protocol uses Poseidon hashing — same as our circuit. Zero hash function mismatch.
2. **Automatic revocation**: Nullifying a compressed account updates the state tree root atomically. No manual root recomputation.
3. **Scalable to millions**: Light's state trees support millions of leaves. Our depth-20 circuit supports 1M Merkle proofs.
4. **Cost**: ~5,000x cheaper than regular Solana accounts for storing credential data.
5. **Solana Foundation signal**: Light Protocol is a key Solana ecosystem project. Using it signals deep Solana-native thinking.
6. **Indexer included**: Photon (by Helius, a hackathon ecosystem partner) provides the indexing — we don't need to run our own.

## Dependencies

```toml
# Cargo.toml
[dependencies]
light-sdk = "0.11"
light-client = "0.9"
light-hasher = "1.1"

# package.json (frontend)
"@lightprotocol/stateless.js": "latest"
"@lightprotocol/compressed-token": "latest"
```

---

# SECTION 3: ON-CHAIN VERIFIER OVERHAUL

## Full Public Input Validation

Every deposit, transfer, and withdrawal instruction now validates ALL public inputs from the ZK proof against on-chain state:

```rust
fn validate_all_public_inputs(
    public_inputs: &[[u8; 32]],
    vault_state: &VaultState,
    registry_root: &[u8; 32],    // from Light Protocol state tree
    signer: &Pubkey,
    clock: &Clock,
    transfer_amount: u64,
    encrypted_metadata: &[u8],
) -> Result<()> {
    
    // [0] Merkle root — must match current Light Protocol state tree root
    require!(
        public_inputs[0] == *registry_root,
        VaultError::MerkleRootMismatch
    );
    
    // [1] Transfer amount — must match the instruction's amount parameter
    let proof_amount = field_element_to_u64(&public_inputs[1]);
    require!(
        proof_amount == transfer_amount,
        VaultError::AmountMismatch
    );
    
    // [2] Timestamp — must be within 60 seconds of current Solana clock
    let proof_timestamp = field_element_to_i64(&public_inputs[2]);
    let clock_timestamp = clock.unix_timestamp;
    require!(
        (clock_timestamp - proof_timestamp).abs() <= 60,
        VaultError::StaleProof
    );
    
    // [3-6] AML thresholds — must match vault state thresholds
    require!(
        field_element_to_u64(&public_inputs[3]) == vault_state.aml_thresholds[0],
        VaultError::ThresholdMismatch
    );
    require!(
        field_element_to_u64(&public_inputs[4]) == vault_state.aml_thresholds[1],
        VaultError::ThresholdMismatch
    );
    require!(
        field_element_to_u64(&public_inputs[5]) == vault_state.aml_thresholds[2],
        VaultError::ThresholdMismatch
    );
    require!(
        field_element_to_u64(&public_inputs[6]) == vault_state.expired_threshold,
        VaultError::ThresholdMismatch
    );
    
    // [7-8] Regulator public key — must match vault state
    require!(
        public_inputs[7] == vault_state.regulator_pubkey_x,
        VaultError::RegulatorKeyMismatch
    );
    require!(
        public_inputs[8] == vault_state.regulator_pubkey_y,
        VaultError::RegulatorKeyMismatch
    );
    
    // [9] Wallet binding — must match transaction signer
    let signer_field = pubkey_to_field_element(signer);
    require!(
        public_inputs[9] == signer_field,
        VaultError::WalletBindingMismatch
    );
    
    // [10..N] Encrypted metadata — stored in TransferRecord (validated by existence)
    // The circuit PROVES these are correct ElGamal encryptions
    // We store them as-is for regulator decryption

    Ok(())
}
```

## Replay Protection via Proof-Hash PDA

```rust
// TransferRecord PDA is now derived from the proof hash
// If the same proof is submitted twice, Solana rejects the second init

#[derive(Accounts)]
#[instruction(proof_hash: [u8; 32])]
pub struct CreateTransferRecord<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + TransferRecord::INIT_SPACE,
        seeds = [b"transfer_record", proof_hash.as_ref()],
        bump,
    )]
    pub transfer_record: Account<'info, TransferRecord>,
    // ...
}

// Proof hash computation — use Solana's native SHA-256 for reliability
fn compute_proof_hash(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
) -> [u8; 32] {
    let mut hasher = solana_program::hash::Hasher::default();
    hasher.hash(proof_a);
    hasher.hash(proof_b);
    hasher.hash(proof_c);
    hasher.result().to_bytes()
}
```

## TransferRecord — Now Stores Full Ciphertext

```rust
#[account]
pub struct TransferRecord {
    pub proof_hash: [u8; 32],              // Unique identifier (PDA seed)
    pub transfer_type: TransferType,        // Deposit, Transfer, Withdraw
    pub amount: u64,                        // Transfer amount (public from proof)
    pub timestamp: i64,                     // Solana clock at verification time
    pub merkle_root_snapshot: [u8; 32],     // Registry root used for this proof
    pub encrypted_metadata: Vec<u8>,        // FULL ElGamal ciphertext (~320 bytes)
    pub decryption_authorized: bool,        // Set to true after multisig approval
    pub signer: Pubkey,                     // Transaction signer (stealth or main wallet)
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum TransferType {
    Deposit,
    Transfer,
    Withdrawal,
}
```

## Decryption Authorization — Anchored to Real TransferRecord

```rust
#[derive(Accounts)]
pub struct AuthorizeDecryption<'info> {
    #[account(
        constraint = authority.key() == vault_state.authority @ VaultError::Unauthorized
    )]
    pub authority: Signer<'info>,
    
    pub vault_state: Account<'info, VaultState>,
    
    // MUST provide the actual TransferRecord — proves it exists
    #[account(
        mut,
        seeds = [b"transfer_record", transfer_record.proof_hash.as_ref()],
        bump = transfer_record.bump,
    )]
    pub transfer_record: Account<'info, TransferRecord>,
    
    // Authorization record derived from the TransferRecord's address
    #[account(
        init,
        payer = payer,
        space = 8 + DecryptionAuthorization::INIT_SPACE,
        seeds = [b"decryption_auth", transfer_record.key().as_ref()],
        bump,
    )]
    pub authorization: Account<'info, DecryptionAuthorization>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn authorize_decryption(
    ctx: Context<AuthorizeDecryption>,
    reason_hash: [u8; 32],  // Hash of court order or investigation reference
) -> Result<()> {
    // 1. Authority verified by Anchor constraint
    // 2. TransferRecord proven to exist by account deserialization
    // 3. Set decryption flag on TransferRecord
    ctx.accounts.transfer_record.decryption_authorized = true;
    
    // 4. Create authorization audit record
    let auth = &mut ctx.accounts.authorization;
    auth.transfer_record = ctx.accounts.transfer_record.key();
    auth.authorized_by = ctx.accounts.authority.key();
    auth.reason_hash = reason_hash;
    auth.timestamp = Clock::get()?.unix_timestamp;
    
    // 5. Emit event for audit trail
    emit!(DecryptionAuthorized {
        transfer_record: ctx.accounts.transfer_record.key(),
        reason_hash,
        authorized_by: ctx.accounts.authority.key(),
        timestamp: auth.timestamp,
    });
    
    Ok(())
}
```

---

# SECTION 4: TOKENIZED VAULT SHARES (TVS) REFRAME

## What Changes

**Before:** vUSDC — looks like a stablecoin. VaultProof looks like an issuer.
**After:** Vault Shares — looks like fund units. VaultProof looks like a regulated fund operator.

## Share Price Mechanics

```
share_price = total_vault_assets / total_shares_outstanding

At launch: 
  - User deposits 10,000 USDC
  - Gets 10,000 vault shares (price = $1.00)

After yield accrual:
  - Vault now holds 10,500 USDC (earned 500 USDC yield)
  - 10,000 shares outstanding
  - share_price = 10,500 / 10,000 = $1.05
  - Each share is now worth $1.05

On redemption:
  - User burns 5,000 shares
  - Gets 5,000 × $1.05 = $5,250 USDC
```

## Updated VaultState Account

```rust
#[account]
pub struct VaultState {
    pub authority: Pubkey,                  // Admin (Squads multisig address)
    pub usdc_mint: Pubkey,                  // USDC mint (devnet)
    pub share_mint: Pubkey,                 // Vault share token mint
    pub usdc_reserve: Pubkey,              // PDA holding deposited USDC
    
    // Share accounting
    pub total_assets: u64,                  // Total USDC under management (deposits + yield)
    pub total_shares: u64,                  // Total vault shares outstanding
    pub share_price_numerator: u64,         // share_price = numerator / denominator
    pub share_price_denominator: u64,       // Avoids floating point
    
    // Compliance config
    pub aml_thresholds: [u64; 3],          // [retail, accredited, institutional]
    pub expired_threshold: u64,             // Degraded threshold for expired credentials
    pub regulator_pubkey_x: [u8; 32],      // ElGamal public key X coordinate
    pub regulator_pubkey_y: [u8; 32],      // ElGamal public key Y coordinate
    
    // Registry reference
    pub kyc_registry: Pubkey,              // KYC Registry program address
    pub state_tree: Pubkey,                // Light Protocol state tree address
    
    // Risk controls
    pub emergency_timelock: i64,            // 72 hours (259200 seconds)
    pub circuit_breaker_threshold: u64,     // Max 24h outflow before auto-pause
    pub circuit_breaker_triggered: bool,
    
    // Yield config
    pub yield_source: Option<Pubkey>,       // Whitelisted lending protocol
    pub liquid_buffer_bps: u16,             // Basis points kept liquid (e.g., 2000 = 20%)
    pub total_yield_earned: u64,            // Cumulative yield
    
    // Custody
    pub custody_provider: CustodyProvider,
    
    pub bump: u8,
}
```

## Updated Deposit Flow

```rust
pub fn deposit_with_proof(
    ctx: Context<DepositWithProof>,
    amount: u64,                    // USDC amount to deposit
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: Vec<[u8; 32]>,
    encrypted_metadata: Vec<u8>,    // FULL ciphertext, not hash
) -> Result<()> {
    // 1. Validate ALL public inputs (Section 3)
    validate_all_public_inputs(...)?;
    
    // 2. Verify ZK proof
    verify_groth16_proof(&proof_a, &proof_b, &proof_c, &public_inputs)?;
    
    // 3. Compute shares to mint
    let shares = if vault_state.total_shares == 0 {
        amount  // First deposit: 1:1
    } else {
        // shares = amount * total_shares / total_assets
        (amount as u128 * vault_state.total_shares as u128 
            / vault_state.total_assets as u128) as u64
    };
    
    // 4. Transfer USDC from user to vault reserve
    transfer_usdc(user_ata, vault_reserve, amount)?;
    
    // 5. Mint vault shares to user's stealth account
    mint_shares(share_mint, stealth_share_ata, shares)?;
    
    // 6. Update accounting
    vault_state.total_assets += amount;
    vault_state.total_shares += shares;
    
    // 7. Create TransferRecord with FULL encrypted metadata
    create_transfer_record(
        proof_hash,
        TransferType::Deposit,
        amount,
        &encrypted_metadata,  // Full ciphertext stored on-chain
        merkle_root_snapshot,
    )?;
    
    Ok(())
}
```

---

# SECTION 5: FRONTEND FULL REWIRE SPECIFICATION

## What Must Change

Every page must connect to real on-chain data. No hardcoded stats. No timed animations pretending to be proof generation. No Vite starter page.

### App.tsx — Replace Entirely

```typescript
// REPLACE the Vite counter page with the real app
import { WalletProvider } from "@solana/wallet-adapter-react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Navbar } from "./components/layout/Navbar";
import { Home, Credential, Deposit, Transfer, Withdraw, Dashboard, Compliance } from "./pages";

function App() {
    return (
        <WalletProvider wallets={wallets}>
            <BrowserRouter>
                <Navbar />
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/credential" element={<Credential />} />
                    <Route path="/deposit" element={<Deposit />} />
                    <Route path="/transfer" element={<Transfer />} />
                    <Route path="/withdraw" element={<Withdraw />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/compliance" element={<Compliance />} />
                </Routes>
            </BrowserRouter>
        </WalletProvider>
    );
}
```

### Stats — Live On-Chain Queries

```typescript
// REPLACE hardcoded stats with real queries
async function fetchDashboardStats(program: Program): Promise<Stats> {
    const vaultState = await program.account.vaultState.fetch(VAULT_PDA);
    const registryState = await program.account.kycRegistry.fetch(REGISTRY_PDA);
    
    // Fetch all TransferRecords
    const records = await program.account.transferRecord.all();
    
    return {
        totalTransfers: records.length,                    // REAL count
        totalVolume: records.reduce((sum, r) => sum + r.account.amount, 0),  // REAL volume
        activeCredentials: registryState.credentialCount,   // REAL count from registry
        complianceRate: 100,                                // All verified transfers are compliant by definition
        totalAssets: vaultState.totalAssets,                // REAL vault TVL
        sharePrice: vaultState.totalAssets / vaultState.totalShares, // REAL share price
    };
}
```

### Proof Generation — Real snarkjs, Not Timers

```typescript
// REPLACE setTimeout-based animations with REAL proof generation
async function generateProofForDeposit(credential, amount, vaultState) {
    setStep("Loading circuit..."); // Step 1 — real
    const wasmBuffer = await fetch("/circuits/compliance.wasm").then(r => r.arrayBuffer());
    const zkeyBuffer = await fetch("/circuits/compliance_final.zkey").then(r => r.arrayBuffer());
    
    setStep("Fetching Merkle proof..."); // Step 2 — real
    const merkleProof = await getCredentialMerkleProof(credential.leafHash);
    
    setStep("Building witness..."); // Step 3 — real
    const input = buildCircuitInput(credential, amount, merkleProof, vaultState);
    
    setStep("Generating zero-knowledge proof..."); // Step 4 — REAL, takes 6-9 seconds
    const startTime = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input, wasmBuffer, zkeyBuffer
    );
    const proofTime = (Date.now() - startTime) / 1000;
    
    setStep("Encrypting metadata..."); // Step 5 — real ElGamal encryption
    const encryptedMetadata = encryptTravelRuleData(credential, amount, vaultState.regulatorKey);
    
    return { proof, publicSignals, encryptedMetadata, proofTime };
}
```

### Credential Count — Must Not Exceed Tree Capacity

```typescript
// Stats display — use real numbers, ensure consistency
const credentialCount = registryState.credentialCount;  // Real on-chain value
// This will be 0-5 during demo, which is HONEST
// Never display a number > 1,048,576 (tree depth 20 capacity)
```

### Timelock — 72 Hours Everywhere

```typescript
// Withdraw page — fix the 24hr → 72hr mismatch
const EMERGENCY_TIMELOCK_SECONDS = 259200; // 72 hours, matches on-chain
const EMERGENCY_TIMELOCK_DISPLAY = "72 hours"; // Display text
```

---

# SECTION 6: MESSAGING REBRAND

## Old Branding → New Branding

| Element | Old | New |
|---------|-----|-----|
| Tagline | "Private stablecoins that prove they're clean" | "Compliant stablecoins with confidential identity" |
| Category | Privacy protocol | Confidential compliance infrastructure |
| Token | vUSDC (stablecoin) | Vault shares (fund units) |
| What's hidden | "Everything" (overclaim) | Identity, KYC data, credential details (accurate) |
| What's visible | Not discussed | Vault share balances on stealth accounts (honest) |
| Key phrase | "Private" | "Confidential" (matches Solana terminology) |
| Buyer | Unclear | B2B2C: Protocol sells to institutions, institutions serve investors |
| Positioning | "Another Tornado Cash but compliant" | "Institutional DeFi vault with ZK-native compliance" |

## Privacy Model Documentation

Add to README:

```markdown
## Privacy Model

VaultProof provides **confidential identity**, not anonymous transactions.

### What IS confidential:
- Your identity (KYC data never touches the blockchain)
- Your credential details (accreditation level, jurisdiction, expiry)
- The link between your real wallet and your vault position
- Transaction metadata (encrypted, only decryptable by authorized parties)

### What is NOT confidential:
- Vault share balances on stealth accounts (visible on-chain)
- The fact that a verified transfer occurred (TransferRecords are public)
- Withdrawal links stealth account back to main wallet

### Why this design:
Institutional regulators require balance auditability. Full balance privacy 
(like Zcash or Tornado Cash) is incompatible with institutional fund reporting 
requirements. VaultProof's model provides the confidentiality institutions need 
(identity protection, competitive intelligence protection) while maintaining 
the transparency regulators require (balance visibility, audit trail).
```

---

# SECTION 7: DOCUMENTATION — PRODUCTION ROADMAP + ADRs

## README Production Roadmap Table

```markdown
## Hackathon Scope vs Production Scope

| Component | Hackathon | Production |
|-----------|-----------|------------|
| Tree capacity | 1,048,576 (depth 20) | Same or deeper |
| Tree storage | Light Protocol ZK Compression | Same |
| Credential storage | Browser localStorage | Encrypted vault / HSM / Fireblocks |
| Issuer model | Single issuer (AMINA) | Multi-issuer whitelist |
| Custody | Self-custody (PDA) | Fireblocks MPC wallet |
| Governance | Single authority key | Squads Protocol multisig |
| Yield source | Simulated | Kamino / marginfi / Solstice (whitelisted) |
| KYC validation | Simulated (auto-approve) | AMINA Bank real KYC pipeline |
| Circuit thresholds | Governable via public inputs | Same + circuit version management |
| Proof generation | Browser WASM (~6-9s) | Browser WASM + optional Sindri API |
| Network | Solana devnet | Solana mainnet |
```

## Architecture Decision Records

Include ADRs for the 6 most important design choices:

**ADR-001: Trusted Authority for KYC Registry**
- Decision: Registry authority can submit roots without on-chain verification
- Context: AMINA Bank is FINMA-regulated; false roots would constitute banking fraud
- Consequences: Central trust point; mitigated by comprehensive event logging
- Alternative considered: Full on-chain Merkle recomputation (rejected: unnecessary given regulated authority)

**ADR-002: Light Protocol for Merkle Tree Storage**
- Decision: Use Light Protocol ZK Compression instead of raw PDA storage
- Context: Need Poseidon-native hashing matching circuit, cost efficiency, scalability
- Consequences: External dependency on Light Protocol SDK; mitigated by their audit status and Solana Foundation backing
- Alternative considered: SPL Account Compression (rejected: uses Keccak, incompatible with circuit)

**ADR-003: Tokenized Vault Shares Model**
- Decision: Issue vault shares (not wrapped stablecoin) representing proportional claim on vault assets
- Context: Avoid stablecoin issuer classification; align with Track 1 institutional fund framing
- Consequences: Share price fluctuates with yield; requires share accounting math
- Alternative considered: Wrapped USDC 1:1 (rejected: regulatory classification risk)

**ADR-004: Browser-Based Proof Generation**
- Decision: All ZK proof computation happens client-side in WASM
- Context: Maximum privacy — private inputs never leave user's device
- Consequences: 6-9 second proof generation; limited by client hardware
- Alternative considered: Sindri cloud API (rejected: private inputs would leave device)

**ADR-005: ElGamal Trapdoor Inside Circuit**
- Decision: Prove correct encryption of Travel Rule metadata inside the ZK circuit
- Context: Sender cannot lie about what they encrypted; regulator gets guaranteed-correct data
- Consequences: ~15,000 additional circuit constraints; adds ~2 seconds to proof time
- Alternative considered: Off-circuit nacl box encryption (rejected: sender could encrypt garbage)

**ADR-006: Wallet-Bound Credentials**
- Decision: Credential hash includes user's wallet pubkey; non-transferable
- Context: Prevents credential sharing/lending; maintains 1:1 identity-to-wallet binding
- Consequences: Wallet loss = credential loss (re-issuance required from AMINA)
- Alternative considered: Bearer credential (rejected: identity lending breaks compliance model)

---

# SECTION 8: ISSUES EXPLICITLY NOT FIXED (WITH JUSTIFICATION)

| Bug # | Issue | Why Not Fixed | Documented Where |
|-------|-------|---------------|------------------|
| 7 | Trusted authority for Merkle root | Correct design for regulated institution model | ADR-001 |
| 17 (partial) | Browser localStorage | Hackathon constraint; production path clear | ADR-004 + Roadmap table |
| 18 | Not production-grade storage | Same as above | Roadmap table |
| 21 (partial) | Single authority vs Squads | Authority field IS a Pubkey — set it to Squads address | Documented in code comments |
| 26 | No distribution moat | Hackathon scope; moat comes from AMINA pilot | README business section |
| 27 | Partner story simulated | Explicitly labeled as demo; AMINA pilot is the real validation | README |
| 28 | Moat unclear | ZK compliance + institutional relationships + regulatory alignment | README business section |
| 29 | Diligence signaling weak | Fixed by this addendum + ADRs + roadmap table | This document |
| 30 | Operations over-indexed on elegance | Fixed by honest scope documentation + production roadmap | This document |

---

# BUILD ORDER FOR FIXES

```
PHASE 1: CIRCUIT RECOMPILE (Day 1-2)
  □ Add AML thresholds as public inputs
  □ Add wallet pubkey to credential hash + leaf computation
  □ Increase tree depth from 10 to 20
  □ Update public input ordering
  □ Recompile circuit
  □ Redo trusted setup
  □ Generate new verifying key
  □ Run all 31 circuit tests with new circuit
  □ Update frontend WASM + zkey files

PHASE 2: LIGHT PROTOCOL INTEGRATION (Day 2-3)
  □ Install Light Protocol SDK
  □ Rewrite KYC Registry to use compressed accounts
  □ Implement add_credential with Light CPI
  □ Implement revoke_credential with Light nullification
  □ Test: add credential → verify root changes
  □ Test: revoke credential → verify old proof fails
  □ Update client-side Merkle proof retrieval to use Photon indexer

PHASE 3: ON-CHAIN VERIFIER FIXES (Day 3-4)
  □ Implement validate_all_public_inputs function
  □ Add timestamp check (within 60s of Solana clock)
  □ Add threshold checks against vault state
  □ Add regulator key check against vault state
  □ Add wallet binding check against signer
  □ Implement proof-hash PDA for replay protection
  □ Store FULL encrypted metadata in TransferRecord
  □ Implement decryption authorization with account verification
  □ Update vault to TVS model (share accounting, share price)

PHASE 4: FRONTEND FULL REWIRE (Day 4-6)
  □ Replace App.tsx with real router + wallet provider
  □ Wire credential page to real KYC Registry program
  □ Wire deposit page to real proof generation + vault program
  □ Wire transfer page to real proof generation
  □ Wire withdraw page to real proof generation + emergency hatch
  □ Wire dashboard to live on-chain queries
  □ Wire compliance page to real TransferRecord reading
  □ Replace all hardcoded stats with live data
  □ Fix 72hr timelock display everywhere
  □ Apply "confidential compliance" branding throughout

PHASE 5: DOCUMENTATION (Day 6-7)
  □ Update technical architecture doc to match code
  □ Write Production Roadmap table in README
  □ Write 6 ADRs
  □ Write Privacy Model section
  □ Remove all overclaiming language
  □ Ensure consistency between docs and code

PHASE 6: INTEGRATION TESTING (Day 7-8)
  □ Re-run all 32 integration tests with new architecture
  □ Add tests for new features (replay protection, full validation, TVS shares)
  □ Test Light Protocol integration end-to-end
  □ Test revocation actually invalidates proofs
  □ Test threshold governance actually changes enforcement

PHASE 7: DEVNET DEPLOY + VIDEO (Day 9-10)
  □ Deploy all programs to devnet
  □ Configure frontend for devnet
  □ Pre-create test credentials
  □ Record 3-minute demo video
  □ Final submission on DoraHacks
```

---

# END OF FIX ADDENDUM
