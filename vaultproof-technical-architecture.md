# VAULTPROOF — TECHNICAL ARCHITECTURE DOCUMENT
## Version 1.0 | StableHacks 2026 | March 14, 2026

---

# DECISION LOG

All architectural decisions recorded from design session:

| # | Decision | Choice |
|---|----------|--------|
| 1 | Credential attributes | Standard: name + nationality + DOB + jurisdiction + accreditation_status + credential_expiry |
| 2 | Token type | Wrapped USDC → vUSDC (VaultProof USDC) |
| 3 | Merkle tree storage | Simple PDA: root + leaves in single account, max ~1000 users |
| 4 | AML threshold model | Tiered: retail <$10k, accredited <$1M, institutional unlimited, based on accreditation_status |
| 5 | Credential expiry | Soft expiry: expired credentials downgraded to $1k threshold |
| 6 | Trapdoor encryption | ElGamal on-chain, proven correct inside the ZK circuit |
| 7 | Trapdoor governance | Squads Protocol 2-of-3 multisig (AMINA + Auditor + Regulator) |
| 8 | Deposit gating | Proof required at deposit AND transfer (maximum compliance) |
| 9 | Balance model | Hybrid: public SPL balance, unlinkable stealth address per deposit |
| 10 | Stealth address generation | Random keypair per deposit, stored by user |
| 11 | Withdrawal flow | Proof required + 72hr emergency escape hatch |
| 12 | Proof generation | Full in-browser, snarkjs WASM, no server |
| 13 | ElGamal metadata | Standard Travel Rule: credential_hash + recipient + amount + timestamp + jurisdiction |
| 14 | Frontend stack | React (Vite) + shadcn/ui + @solana/wallet-adapter |

---

# SYSTEM OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER'S BROWSER                                 │
│                                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │  Credential  │  │   snarkjs    │  │   ElGamal       │  │  Stealth     │ │
│  │  Storage     │  │   WASM       │  │   Encryption    │  │  Keypair     │ │
│  │  (local)     │  │   Prover     │  │   (client-side) │  │  Generator   │ │
│  └──────┬──────┘  └──────┬───────┘  └────────┬────────┘  └──────┬───────┘ │
│         │                │                    │                   │         │
│         ▼                ▼                    ▼                   ▼         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    TRANSACTION BUILDER                               │   │
│  │  Assembles: proof + public_inputs + encrypted_metadata + transfer   │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SOLANA BLOCKCHAIN                                │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────────────────┐   │
│  │   KYC Registry  │  │   Compliance    │  │   vUSDC Vault             │   │
│  │   Program       │  │   Verifier      │  │   Program                 │   │
│  │                 │  │   Program       │  │                           │   │
│  │  • Merkle root  │  │                 │  │  • USDC deposit/withdraw  │   │
│  │  • Add cred     │  │  • Verify proof │  │  • vUSDC mint/burn        │   │
│  │  • Revoke cred  │  │  • Check root   │  │  • Emergency escape       │   │
│  │                 │  │  • Check params │  │  • Stealth account mgmt   │   │
│  └────────┬────────┘  │  • Execute xfer │  └───────────┬───────────────┘   │
│           │           │  • Store trapdoor│              │                   │
│           │           └────────┬────────┘              │                   │
│           │                    │                        │                   │
│           ▼                    ▼                        ▼                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    SQUADS MULTISIG (2-of-3)                         │   │
│  │  Governs: trapdoor decryption, parameter updates, emergency admin  │   │
│  │  Signers: AMINA Compliance | External Auditor | Regulatory Auth    │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# MODULE 1: zkKYC CREDENTIAL ENGINE

## 1.1 Credential Schema

The credential is a structured data object that exists ONLY on the user's device. It is NEVER stored on-chain in plaintext. Only its Poseidon hash (the "leaf") enters the Merkle tree.

```
Credential {
  // Identity fields (private, never on-chain)
  name: Field,                  // Poseidon hash of full name string
  nationality: Field,           // ISO 3166-1 numeric country code (e.g., 756 = Switzerland)
  date_of_birth: Field,         // Unix timestamp of DOB
  jurisdiction: Field,          // Jurisdiction code where user is authorized to transact
  accreditation_status: Field,  // 0 = retail, 1 = accredited, 2 = institutional
  credential_expiry: Field,     // Unix timestamp when credential expires

  // Cryptographic binding (private)
  identity_secret: Field,       // Random secret known only to the user
  issuer_signature: Field,      // AMINA Bank's EdDSA signature over the above fields

  // Merkle proof data (private, changes as tree updates)
  merkle_path_elements: Field[TREE_DEPTH],
  merkle_path_indices: Field[TREE_DEPTH],
}
```

## 1.2 Credential Issuance Flow

```
Step 1: User completes KYC on AMINA Bank portal (simulated in hackathon)
        → User submits: name, nationality, DOB, jurisdiction, accreditation level
        
Step 2: AMINA Bank backend (simulated) performs:
        a. Validates identity documents (simulated — auto-approve in demo)
        b. Assigns accreditation_status (0, 1, or 2)
        c. Sets credential_expiry (e.g., 1 year from now)
        d. Generates identity_secret (random field element, given to user)
        e. Computes credential_hash:
           leaf = Poseidon(
             Poseidon(name, nationality),
             Poseidon(date_of_birth, jurisdiction),
             Poseidon(accreditation_status, credential_expiry),
             identity_secret
           )
        f. Signs the credential fields with AMINA's EdDSA key
        g. Calls KYC Registry Program → add_credential(leaf)
        
Step 3: User receives credential JSON file containing ALL fields above
        → Stored locally in browser (localStorage) and downloadable as backup
        → User is warned: "This file IS your identity in VaultProof. Back it up."
        
Step 4: KYC Registry Program updates on-chain Merkle root
```

## 1.3 KYC Registry Program (Anchor/Rust)

### Account Structure

```rust
#[account]
pub struct KycRegistry {
    pub authority: Pubkey,           // AMINA Bank's admin key (Squads multisig)
    pub merkle_root: [u8; 32],      // Current Poseidon Merkle root
    pub leaf_count: u32,            // Number of active credentials
    pub tree_depth: u8,             // Fixed at 10 (supports 1024 leaves)
    pub leaves: Vec<[u8; 32]>,     // All leaf hashes (for client-side tree construction)
    pub revoked: Vec<[u8; 32]>,    // Revoked credential hashes
    pub bump: u8,
}
```

### Instructions

```rust
// Initialize the registry — called once
pub fn initialize_registry(ctx: Context<InitRegistry>, tree_depth: u8) -> Result<()>

// Add a new KYC credential leaf — authority only (AMINA Bank)
pub fn add_credential(ctx: Context<AddCredential>, leaf_hash: [u8; 32]) -> Result<()>
// Effects: pushes leaf to leaves vec, recomputes merkle_root, increments leaf_count

// Revoke a credential — authority only
pub fn revoke_credential(ctx: Context<RevokeCredential>, leaf_hash: [u8; 32]) -> Result<()>
// Effects: adds to revoked list, recomputes merkle_root excluding revoked leaves

// Update authority to Squads multisig
pub fn transfer_authority(ctx: Context<TransferAuth>, new_authority: Pubkey) -> Result<()>
```

### Merkle Tree Implementation

- Tree depth: 10 (max 1,024 leaves)
- Hash function: Poseidon (SNARK-friendly, same hash used in circuits)
- Empty leaf value: Poseidon(0) — standard sparse Merkle tree convention
- Root recomputation: Done on-chain in add_credential (iterative Poseidon hashing up 10 levels)
- Client-side tree: Frontend downloads all leaves from registry account and builds the full tree locally to generate Merkle proofs for the ZK circuit

### Important: Poseidon On-Chain

Solana doesn't have a native Poseidon precompile. Options:
- **light-poseidon crate**: Light Protocol maintains a Solana-compatible Poseidon implementation. ~40k compute units per hash. 10 levels = ~400k CU. Fits in one transaction.
- Dependency: `light-poseidon = "1.0"` in Cargo.toml

---

# MODULE 2: COMPLIANCE CIRCUIT (Circom)

## 2.1 Circuit Architecture Overview

A single Groth16 circuit that proves ALL of the following simultaneously:

```
┌──────────────────────────────────────────────────────────────────────┐
│                    COMPLIANCE CIRCUIT                                 │
│                                                                      │
│  PRIVATE INPUTS (known only to user):                               │
│    • name, nationality, dob, jurisdiction                           │
│    • accreditation_status, credential_expiry                        │
│    • identity_secret, issuer_signature                              │
│    • balance (read from stealth account)                            │
│    • merkle_path_elements[10], merkle_path_indices[10]              │
│    • elgamal_randomness (for trapdoor encryption)                   │
│                                                                      │
│  PUBLIC INPUTS (visible on-chain, verified by Solana program):      │
│    • merkle_root (must match on-chain KYC Registry root)            │
│    • transfer_amount                                                 │
│    • current_timestamp (from Solana clock sysvar)                   │
│    • regulator_public_key (AMINA's ElGamal pubkey for trapdoor)     │
│    • encrypted_metadata[5] (ElGamal ciphertexts — Travel Rule data) │
│                                                                      │
│  PROOF STAGES:                                                       │
│    1. Credential Integrity  → issuer signature valid                │
│    2. Merkle Membership     → credential in KYC Registry            │
│    3. Tiered AML Threshold  → amount under accreditation limit      │
│    4. Soft Expiry Check     → adjust threshold if expired           │
│    5. Balance Solvency      → balance >= transfer_amount            │
│    6. ElGamal Encryption    → trapdoor metadata encrypted correctly │
│                                                                      │
│  OUTPUT: Single Groth16 proof (~128 bytes)                          │
└──────────────────────────────────────────────────────────────────────┘
```

## 2.2 Circuit Pseudocode (Circom)

```circom
pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/escalarmulany.circom";  // for ElGamal
include "circomlib/circuits/babyjub.circom";         // for EdDSA/ElGamal

template VaultProofCompliance(treeDepth) {

    // ============================================================
    // PRIVATE INPUTS
    // ============================================================
    signal input name;
    signal input nationality;
    signal input dateOfBirth;
    signal input jurisdiction;
    signal input accreditationStatus;    // 0=retail, 1=accredited, 2=institutional
    signal input credentialExpiry;        // unix timestamp
    signal input identitySecret;
    signal input issuerSigR8x;           // EdDSA signature R.x
    signal input issuerSigR8y;           // EdDSA signature R.y
    signal input issuerSigS;             // EdDSA signature S
    signal input balance;                // user's vUSDC balance
    signal input merklePathElements[treeDepth];
    signal input merklePathIndices[treeDepth];
    signal input elgamalRandomness;      // random scalar for ElGamal encryption

    // ============================================================
    // PUBLIC INPUTS
    // ============================================================
    signal input merkleRoot;
    signal input transferAmount;
    signal input currentTimestamp;
    signal input regulatorPubKeyX;       // AMINA's ElGamal public key
    signal input regulatorPubKeyY;
    // ElGamal ciphertext outputs (public, stored on-chain)
    signal input encryptedMetadata[10];  // 5 plaintexts × 2 (C1, C2) each

    // ============================================================
    // STAGE 1: CREDENTIAL INTEGRITY (verify AMINA's signature)
    // ============================================================
    // Hash all credential fields to get the signed message
    component credHash1 = Poseidon(2);
    credHash1.inputs[0] <== name;
    credHash1.inputs[1] <== nationality;

    component credHash2 = Poseidon(2);
    credHash2.inputs[0] <== dateOfBirth;
    credHash2.inputs[1] <== jurisdiction;

    component credHash3 = Poseidon(2);
    credHash3.inputs[0] <== accreditationStatus;
    credHash3.inputs[1] <== credentialExpiry;

    component credHashFinal = Poseidon(3);
    credHashFinal.inputs[0] <== credHash1.out;
    credHashFinal.inputs[1] <== credHash2.out;
    credHashFinal.inputs[2] <== credHash3.out;

    // EdDSA signature verification over credHashFinal
    // Using circomlib's EdDSAPoseidonVerifier
    // This proves AMINA Bank actually signed these credential fields
    component sigVerifier = EdDSAPoseidonVerifier();
    sigVerifier.enabled <== 1;
    sigVerifier.Ax <== issuerPubKeyX;   // hardcoded AMINA pubkey (constant in circuit)
    sigVerifier.Ay <== issuerPubKeyY;
    sigVerifier.R8x <== issuerSigR8x;
    sigVerifier.R8y <== issuerSigR8y;
    sigVerifier.S <== issuerSigS;
    sigVerifier.M <== credHashFinal.out;

    // ============================================================
    // STAGE 2: MERKLE MEMBERSHIP (credential is in KYC Registry)
    // ============================================================
    // Compute leaf = Poseidon(credHashFinal, identitySecret)
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== credHashFinal.out;
    leafHasher.inputs[1] <== identitySecret;

    // Verify Merkle path from leaf to root
    component merkleVerifier = MerkleTreeVerifier(treeDepth);
    merkleVerifier.leaf <== leafHasher.out;
    merkleVerifier.root <== merkleRoot;
    for (var i = 0; i < treeDepth; i++) {
        merkleVerifier.pathElements[i] <== merklePathElements[i];
        merkleVerifier.pathIndices[i] <== merklePathIndices[i];
    }
    // Constraint: computed root === public merkleRoot
    // (enforced inside MerkleTreeVerifier template)

    // ============================================================
    // STAGE 3: TIERED AML THRESHOLD
    // ============================================================
    // Determine threshold based on accreditation status
    // retail (0) = 10,000 | accredited (1) = 1,000,000 | institutional (2) = 2^64 (unlimited)
    
    signal tierThreshold;
    
    // Compute: threshold = 10000 + accreditationStatus * 990000
    //          + (accreditationStatus == 2) * (2^64 - 1000000)
    // Using multiplexer logic:
    
    component isAccredited = IsEqual();
    isAccredited.in[0] <== accreditationStatus;
    isAccredited.in[1] <== 1;
    
    component isInstitutional = IsEqual();
    isInstitutional.in[0] <== accreditationStatus;
    isInstitutional.in[1] <== 2;
    
    // retailThreshold = 10000 (in smallest unit, e.g., cents or 6-decimal USDC)
    // For USDC with 6 decimals: $10,000 = 10000 * 1000000 = 10000000000
    var RETAIL_THRESHOLD = 10000000000;       // $10,000 in USDC base units
    var ACCREDITED_THRESHOLD = 1000000000000; // $1,000,000 in USDC base units
    var INSTITUTIONAL_THRESHOLD = 18446744073709551615; // max u64, effectively unlimited

    tierThreshold <== RETAIL_THRESHOLD
        + isAccredited.out * (ACCREDITED_THRESHOLD - RETAIL_THRESHOLD)
        + isInstitutional.out * (INSTITUTIONAL_THRESHOLD - ACCREDITED_THRESHOLD);

    // ============================================================
    // STAGE 4: SOFT EXPIRY CHECK
    // ============================================================
    // If credential is expired, override threshold to EXPIRED_THRESHOLD
    var EXPIRED_THRESHOLD = 1000000000; // $1,000 in USDC base units
    
    component isExpired = LessThan(64);
    isExpired.in[0] <== credentialExpiry;
    isExpired.in[1] <== currentTimestamp;
    // isExpired.out = 1 if expired, 0 if valid

    signal effectiveThreshold;
    effectiveThreshold <== tierThreshold + isExpired.out * (EXPIRED_THRESHOLD - tierThreshold);
    // If expired: effectiveThreshold = EXPIRED_THRESHOLD
    // If valid:   effectiveThreshold = tierThreshold

    // ============================================================
    // STAGE 5: COMPLIANCE CHECKS
    // ============================================================
    
    // 5a. Transfer amount <= effective threshold
    component amlCheck = LessEqThan(64);
    amlCheck.in[0] <== transferAmount;
    amlCheck.in[1] <== effectiveThreshold;
    amlCheck.out === 1;

    // 5b. Balance >= transfer amount (solvency)
    component balanceCheck = GreaterEqThan(64);
    balanceCheck.in[0] <== balance;
    balanceCheck.in[1] <== transferAmount;
    balanceCheck.out === 1;

    // ============================================================
    // STAGE 6: ELGAMAL TRAPDOOR ENCRYPTION
    // ============================================================
    // Encrypt 5 metadata fields to regulator's public key:
    //   [credHashFinal, recipientAddress, transferAmount, currentTimestamp, jurisdiction]
    //
    // ElGamal encryption for each field m:
    //   C1 = r * G          (ephemeral public key)
    //   C2 = m * G + r * PK (encrypted message)
    //   where r = elgamalRandomness, PK = regulatorPubKey, G = generator
    //
    // The circuit PROVES that encryptedMetadata (public output) is the correct
    // encryption of the private metadata under the regulator's key.
    // This means the sender CANNOT lie about what they encrypted.

    signal metadataFields[5];
    metadataFields[0] <== credHashFinal.out;   // sender identity (hashed)
    metadataFields[1] <== recipientAddress;     // would need to be added as input
    metadataFields[2] <== transferAmount;
    metadataFields[3] <== currentTimestamp;
    metadataFields[4] <== jurisdiction;

    // ElGamal encryption components (using Baby Jubjub curve)
    // For each metadata field, compute C1 and C2
    // C1 = r * G (same for all — one randomness)
    component c1 = EscalarMulFix(253, GENERATOR_POINT);
    c1.e <== elgamalRandomness;
    // encryptedMetadata[0] should equal c1.out[0] (x-coordinate)
    // encryptedMetadata[1] should equal c1.out[1] (y-coordinate)

    // For each field: C2_i = m_i * G + r * PK
    // This requires scalar multiplication and point addition
    // Using circomlib's EscalarMulAny for r * PK
    component rPK = EscalarMulAny(253);
    rPK.e <== elgamalRandomness;
    rPK.p[0] <== regulatorPubKeyX;
    rPK.p[1] <== regulatorPubKeyY;

    // For each metadata field m_i:
    //   mG_i = m_i * G
    //   C2_i = mG_i + rPK
    // Constrain that public encryptedMetadata matches computed ciphertexts

    // NOTE: Full implementation requires 5 EscalarMulFix + 5 BabyAdd components
    // This is the most compute-intensive part of the circuit (~15k constraints)
    // See implementation notes below for optimization strategies
}

component main {public [
    merkleRoot,
    transferAmount,
    currentTimestamp,
    regulatorPubKeyX,
    regulatorPubKeyY,
    encryptedMetadata
]} = VaultProofCompliance(10);
```

## 2.3 Circuit Complexity Estimate

| Stage | Components Used | Estimated Constraints |
|-------|----------------|----------------------|
| Credential hash (Poseidon x4) | 4× Poseidon | ~1,200 |
| EdDSA signature verification | EdDSAPoseidonVerifier | ~6,000 |
| Merkle proof (10 levels) | 10× Poseidon + 10× Switcher | ~3,000 |
| Tiered threshold (comparators) | 2× IsEqual + arithmetic | ~500 |
| Soft expiry (LessThan) | 1× LessThan(64) | ~200 |
| AML check (LessEqThan) | 1× LessEqThan(64) | ~200 |
| Balance check (GreaterEqThan) | 1× GreaterEqThan(64) | ~200 |
| ElGamal encryption (5 fields) | 6× EscalarMul + 5× BabyAdd | ~15,000 |
| **TOTAL** | | **~26,300** |

- Powers of Tau file needed: `pot16` (supports up to 65,536 constraints)
- Estimated proof generation time in browser (WASM): **4-8 seconds**
- Estimated on-chain verification: **~200,000 compute units** (fits single transaction)
- Proof size: **128 bytes** (2 G1 points + 1 G2 point)

## 2.4 ElGamal Implementation Notes

The ElGamal encryption inside the circuit is the most complex component. Implementation strategy:

1. Use the **Baby Jubjub** curve (native to circomlib, same curve used by EdDSA)
2. Generator point G is a constant embedded in the circuit
3. Regulator's public key PK = sk * G (sk is AMINA's private scalar, never in circuit)
4. Single randomness `r` for all 5 metadata fields (one C1, five C2s)
5. **Optimization**: Since C1 = r * G is the same for all fields, compute it once

**Decryption by regulator** (off-chain, after Squads multisig approval):
```
For each encrypted field (C1, C2_i):
  shared_secret = sk * C1        (using AMINA's private key)
  m_i * G = C2_i - shared_secret
  m_i = discrete_log(m_i * G)    (use lookup table for small field values)
```

**Important**: ElGamal on Baby Jubjub encrypts field elements, not arbitrary data. The metadata fields (credential hash, amount, timestamp, jurisdiction) are all field elements, so this works natively. Recipient address (Solana pubkey = 32 bytes) would need to be split into two field elements.

## 2.5 Helper Circuit Templates Needed

```
circuits/
├── compliance.circom           # Main circuit (above)
├── merkle_tree_verifier.circom # Poseidon Merkle proof checker
├── elgamal_encrypt.circom      # Baby Jubjub ElGamal encryption
├── tiered_threshold.circom     # Accreditation-based threshold selector
└── lib/
    └── (circomlib installed via npm)
```

---

# MODULE 3: ON-CHAIN VERIFIER & TRANSFER GATEWAY

## 3.1 Program Architecture

Three Anchor programs, deployed separately:

```
programs/
├── kyc-registry/          # Module 1: Merkle tree management
├── compliance-verifier/   # Module 2+3: Proof verification + transfer execution
└── vusd-vault/            # Module 3: USDC wrapping, vUSDC minting, escrow
```

## 3.2 vUSDC Vault Program

### Account Structure

```rust
#[account]
pub struct VaultState {
    pub authority: Pubkey,              // Squads multisig
    pub usdc_mint: Pubkey,              // USDC mint address (devnet)
    pub vusd_mint: Pubkey,              // vUSDC mint address (created by vault)
    pub usdc_reserve: Pubkey,           // PDA holding deposited USDC
    pub total_deposited: u64,           // Total USDC in reserve
    pub total_vusd_supply: u64,         // Total vUSDC minted (should equal total_deposited)
    pub aml_thresholds: [u64; 3],       // [retail, accredited, institutional] in USDC base units
    pub expired_threshold: u64,         // Threshold for expired credentials
    pub emergency_timelock: i64,        // 72 hours in seconds (259200)
    pub bump: u8,
}

#[account]
pub struct EmergencyWithdrawal {
    pub requester: Pubkey,
    pub stealth_account: Pubkey,        // Which stealth vUSDC account to withdraw from
    pub amount: u64,
    pub request_timestamp: i64,
    pub executed: bool,
    pub bump: u8,
}

#[account]
pub struct TransferRecord {
    pub proof_hash: [u8; 32],           // Hash of the ZK proof (for deduplication)
    pub encrypted_metadata: Vec<u8>,    // ElGamal ciphertexts (~320 bytes)
    pub timestamp: i64,
    pub merkle_root_at_time: [u8; 32],  // Snapshot of which KYC root was used
    pub bump: u8,
}
```

### Instructions

```rust
// === DEPOSIT FLOW ===

// Step 1: User generates ZK proof (in browser) proving they have valid zkKYC
// Step 2: User calls deposit_with_proof

pub fn deposit_with_proof(
    ctx: Context<DepositWithProof>,
    amount: u64,
    // ZK proof components
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: Vec<[u8; 32]>,
    // Stealth account
    stealth_token_account: Pubkey,      // User's pre-created stealth vUSDC account
    // ElGamal encrypted metadata
    encrypted_metadata: Vec<u8>,
) -> Result<()> {
    // 1. Verify ZK proof using groth16-solana
    // 2. Verify public_inputs[0] (merkle_root) matches on-chain KYC registry root
    // 3. Verify transfer_amount in public_inputs matches `amount`
    // 4. Transfer USDC from user's wallet to vault reserve (PDA)
    // 5. Mint vUSDC to user's stealth_token_account
    // 6. Create TransferRecord with encrypted metadata
    // 7. Emit event: DepositVerified { amount, proof_hash, timestamp }
}

// === TRANSFER FLOW ===

pub fn transfer_with_proof(
    ctx: Context<TransferWithProof>,
    amount: u64,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: Vec<[u8; 32]>,
    encrypted_metadata: Vec<u8>,
) -> Result<()> {
    // 1. Verify ZK proof
    // 2. Verify merkle_root matches on-chain
    // 3. Transfer vUSDC from sender's stealth account to recipient's stealth account
    // 4. Create TransferRecord with encrypted metadata
    // 5. Emit event: TransferVerified { amount, proof_hash, timestamp }
}

// === WITHDRAWAL FLOW ===

pub fn withdraw_with_proof(
    ctx: Context<WithdrawWithProof>,
    amount: u64,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: Vec<[u8; 32]>,
    encrypted_metadata: Vec<u8>,
) -> Result<()> {
    // 1. Verify ZK proof
    // 2. Burn vUSDC from user's stealth account
    // 3. Transfer USDC from vault reserve to user's main wallet
    // 4. Create TransferRecord
    // 5. Emit event: WithdrawalVerified { amount, proof_hash, timestamp }
}

// === EMERGENCY ESCAPE HATCH ===

pub fn request_emergency_withdrawal(
    ctx: Context<RequestEmergency>,
    stealth_account: Pubkey,
    amount: u64,
) -> Result<()> {
    // 1. Create EmergencyWithdrawal account with current timestamp
    // 2. NO proof required
    // 3. Emit event: EmergencyRequested { requester, amount, unlock_time }
}

pub fn execute_emergency_withdrawal(
    ctx: Context<ExecuteEmergency>,
) -> Result<()> {
    // 1. Verify current_time >= request_timestamp + 72 hours
    // 2. Verify not already executed
    // 3. Burn vUSDC, transfer USDC to requester
    // 4. Mark executed = true
    // 5. Emit event: EmergencyExecuted { requester, amount }
}

// === ADMIN (Squads multisig only) ===

pub fn update_aml_thresholds(
    ctx: Context<AdminUpdate>,
    retail: u64,
    accredited: u64,
    institutional: u64,
    expired: u64,
) -> Result<()>

pub fn update_emergency_timelock(
    ctx: Context<AdminUpdate>,
    new_timelock_seconds: i64,
) -> Result<()>
```

## 3.3 Proof Verification (groth16-solana Integration)

```rust
use groth16_solana::groth16::Groth16Verifier;

// Verifying key generated from the compiled circuit (embedded as constant)
const VERIFYING_KEY: &[u8] = include_bytes!("../keys/verifying_key.bin");

fn verify_compliance_proof(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]],
) -> Result<bool> {
    // IMPORTANT: proof_a must have its y-coordinate negated
    // This is a known requirement of groth16-solana
    let mut negated_proof_a = *proof_a;
    negate_y_coordinate(&mut negated_proof_a);

    let mut verifier = Groth16Verifier::new(
        &negated_proof_a,
        proof_b,
        proof_c,
        public_inputs,
        VERIFYING_KEY,
    ).map_err(|_| ErrorCode::InvalidProofFormat)?;

    verifier.verify()
        .map_err(|_| ErrorCode::ProofVerificationFailed)
}
```

## 3.4 Stealth Address Flow

```
DEPOSIT:
1. User generates random Solana keypair in browser:
   const stealthKeypair = Keypair.generate();
   
2. User creates an Associated Token Account for vUSDC on the stealth address:
   stealthATA = getAssociatedTokenAddress(vusdMint, stealthKeypair.publicKey)
   
3. User stores stealthKeypair in localStorage alongside credential:
   {
     credential: { ... },
     stealthAccounts: [
       { publicKey: "...", secretKey: "...", depositAmount: 50000, timestamp: ... }
     ]
   }

4. User calls deposit_with_proof, specifying stealthATA as the destination

5. vUSDC is minted to stealthATA — no link between user's main wallet and stealth address

TRANSFER:
1. User signs the transfer transaction with stealthKeypair (NOT their main wallet)
2. This is possible because the user has the stealth secret key stored locally
3. On-chain, the transaction comes FROM the stealth address — no link to real identity

WITHDRAWAL:
1. User specifies their main wallet as the USDC destination
2. User signs with stealthKeypair
3. USDC goes to main wallet, vUSDC burned from stealth
4. NOTE: This creates a link between stealth and main wallet at withdrawal time
   — acceptable because the ZK proof still hides identity, and the encrypted
     metadata is only decryptable by the Squads multisig
```

---

# MODULE 5: REGULATORY TRAPDOOR

## 5.1 Squads Protocol Integration

### Setup (One-Time)

```typescript
// Create 2-of-3 Squads multisig
const multisig = await squads.createMultisig({
  threshold: 2,
  members: [
    { key: aminaComplianceOfficer.publicKey, permissions: ALL },
    { key: externalAuditor.publicKey, permissions: ALL },
    { key: regulatoryAuthority.publicKey, permissions: ALL },
  ],
});

// Transfer VaultState authority to multisig
await program.methods
  .transferAuthority(multisig.publicKey)
  .accounts({ currentAuthority: deployer.publicKey })
  .rpc();
```

### Decryption Request Flow

```
Step 1: AMINA Compliance Officer identifies suspicious TransferRecord
        → Creates a Squads transaction proposal containing:
          - TransferRecord account address
          - Reason hash (e.g., hash of court order document)
          - Decryption request instruction

Step 2: External Auditor reviews the proposal in Squads UI
        → Approves (signs) the transaction
        → 2-of-3 threshold met

Step 3: Squads executes the multisig transaction
        → Calls compliance-verifier program's `authorize_decryption` instruction
        → On-chain event emitted: DecryptionAuthorized {
              transfer_record: Pubkey,
              reason_hash: [u8; 32],
              approvers: [Pubkey; 2],
              timestamp: i64,
          }

Step 4: Off-chain, AMINA uses their ElGamal private key to decrypt:
        → Reads encrypted_metadata from TransferRecord
        → Performs ElGamal decryption using AMINA's sk
        → Recovers: sender_credential_hash, recipient, amount, timestamp, jurisdiction
        → Cross-references credential_hash with their internal KYC database
        → Full identity revealed ONLY to authorized compliance team
```

### On-Chain Decryption Authorization

```rust
#[account]
pub struct DecryptionAuthorization {
    pub transfer_record: Pubkey,
    pub reason_hash: [u8; 32],
    pub authorized_by: Pubkey,          // Squads multisig address
    pub timestamp: i64,
    pub bump: u8,
}

pub fn authorize_decryption(
    ctx: Context<AuthorizeDecryption>,
    transfer_record: Pubkey,
    reason_hash: [u8; 32],
) -> Result<()> {
    // 1. Verify caller is the Squads multisig (authority)
    // 2. Verify transfer_record exists
    // 3. Create DecryptionAuthorization record (permanent on-chain audit trail)
    // 4. Emit event
    // NOTE: Actual decryption happens off-chain. This instruction only AUTHORIZES it
    //       and creates an immutable record that the decryption was approved.
}
```

## 5.2 ElGamal Key Management

```
AMINA's ElGamal keypair (Baby Jubjub curve):
  - Private key (sk): Stored securely by AMINA Bank (HSM in production, env variable in hackathon)
  - Public key (PK = sk * G): Published on-chain in VaultState account
  - All proofs encrypt metadata to this public key
  - Rotation: New keypair can be set by Squads multisig via update_regulator_key instruction
    (old key retained for decrypting historical records)
```

---

# FRONTEND ARCHITECTURE

## Page Structure

```
src/
├── App.tsx                      # Router + wallet provider setup
├── pages/
│   ├── Home.tsx                 # Landing page with product overview
│   ├── Credential.tsx           # Module 1: Mock AMINA KYC portal
│   ├── Deposit.tsx              # Deposit USDC → get vUSDC (with proof)
│   ├── Transfer.tsx             # Transfer vUSDC (with proof)
│   ├── Withdraw.tsx             # Withdraw vUSDC → USDC (with proof)
│   ├── Dashboard.tsx            # Compliance dashboard (transfer history, stats)
│   └── Compliance.tsx           # Module 5: Regulatory view (Squads multisig demo)
├── components/
│   ├── ProofGenerator.tsx       # snarkjs WASM proof generation component
│   ├── CredentialManager.tsx    # localStorage credential CRUD
│   ├── StealthAccountManager.tsx # Random keypair generation + storage
│   ├── TransferRecordTable.tsx  # Display verified transfers
│   └── ui/                     # shadcn/ui components
├── lib/
│   ├── circuits/               # Compiled circuit WASM + zkey files
│   ├── merkle.ts               # Client-side Merkle tree construction
│   ├── elgamal.ts              # ElGamal encryption helper (Baby Jubjub)
│   ├── stealth.ts              # Stealth keypair generation
│   └── program.ts              # Anchor program client
└── hooks/
    ├── useProofGeneration.ts    # Hook wrapping snarkjs prove
    ├── useCredential.ts         # Hook for credential state
    └── useVaultProof.ts         # Hook for program interactions
```

## Proof Generation Flow (Browser)

```typescript
// useProofGeneration.ts

import * as snarkjs from "snarkjs";

export async function generateComplianceProof(
  credential: Credential,
  transferAmount: bigint,
  currentTimestamp: bigint,
  merkleRoot: bigint,
  regulatorPubKey: [bigint, bigint],
  stealthBalance: bigint,
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {

  // 1. Build Merkle proof client-side
  const merkleProof = buildMerkleProof(credential.leafHash, allLeaves);

  // 2. Generate ElGamal randomness
  const elgamalRandomness = randomFieldElement();

  // 3. Construct witness input
  const input = {
    // Private inputs
    name: credential.name,
    nationality: credential.nationality,
    dateOfBirth: credential.dateOfBirth,
    jurisdiction: credential.jurisdiction,
    accreditationStatus: credential.accreditationStatus,
    credentialExpiry: credential.credentialExpiry,
    identitySecret: credential.identitySecret,
    issuerSigR8x: credential.signature.R8x,
    issuerSigR8y: credential.signature.R8y,
    issuerSigS: credential.signature.S,
    balance: stealthBalance.toString(),
    merklePathElements: merkleProof.pathElements,
    merklePathIndices: merkleProof.pathIndices,
    elgamalRandomness: elgamalRandomness.toString(),

    // Public inputs
    merkleRoot: merkleRoot.toString(),
    transferAmount: transferAmount.toString(),
    currentTimestamp: currentTimestamp.toString(),
    regulatorPubKeyX: regulatorPubKey[0].toString(),
    regulatorPubKeyY: regulatorPubKey[1].toString(),
    encryptedMetadata: computeElGamalCiphertexts(...), // pre-computed to match circuit
  };

  // 4. Generate proof (WASM, runs in browser, 4-8 seconds)
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    "/circuits/compliance.wasm",     // Compiled circuit WASM
    "/circuits/compliance_final.zkey" // Proving key
  );

  return { proof, publicSignals };
}
```

## Demo Flow (What Judges See)

```
SCREEN 1: "AMINA Bank KYC Portal" (mock)
  → Clean form: Name, Nationality (dropdown), DOB, Jurisdiction, Accreditation tier
  → User fills in details
  → "Issue Credential" button
  → Success animation: "Credential issued ✓ — stored securely in your browser"
  → Shows credential card (redacted): "****** | Switzerland | Accredited | Expires: 2027-03-14"

SCREEN 2: "Deposit USDC"
  → Connect wallet (Phantom)
  → Shows USDC balance in connected wallet
  → Amount input field
  → "Generate Compliance Proof" button
  → Progress: "Proving identity..." → "Checking compliance..." → "Encrypting metadata..."
  → Timer showing proof generation (~5 seconds)
  → "Proof generated ✓ — Submit to Solana"
  → Transaction confirmed: "50,000 vUSDC deposited to stealth account"
  → Stealth address shown (clearly different from main wallet)

SCREEN 3: "Transfer vUSDC"
  → Shows stealth account balance
  → Recipient stealth address input
  → Amount input
  → Same proof generation flow
  → Transaction confirmed
  → "On-chain: Verified transfer. No personal data visible."

SCREEN 4: "Compliance Dashboard"
  → Total verified transfers: 3
  → Total volume: $125,000
  → Active credentials: 2
  → Compliance rate: 100%
  → Transfer log table: [timestamp | status: VERIFIED | proof_hash | amount (if public)]
  → "Zero personal data stored on-chain" badge

SCREEN 5: "Regulatory View" (AMINA Compliance Demo)
  → Shows Squads multisig interface (embedded or linked)
  → Officer selects a TransferRecord to investigate
  → Creates decryption proposal
  → Second signer (auditor) approves
  → Encrypted metadata decrypted
  → Reveals: Sender identity hash → cross-references to "Alice, Switzerland, Accredited"
  → "This is the only way to see who made this transfer."
```

---

# BUILD PRIORITY ORDER

Given 10 days and the goal of shipping the full product:

```
DAY 1-2: FOUNDATION
  □ Set up monorepo (Anchor + React + Circom)
  □ Write and compile the Circom compliance circuit
  □ Test circuit with snarkjs CLI (generate proofs, verify locally)
  □ Generate trusted setup (powers of tau + circuit-specific)

DAY 3-4: SOLANA PROGRAMS
  □ KYC Registry program (Anchor) — initialize, add_credential, Poseidon Merkle root
  □ Vault program skeleton — deposit_with_proof instruction
  □ Integrate groth16-solana verifier into vault program
  □ Test on local validator: submit proof → verify → mint vUSDC

DAY 5-6: TRANSFER + WITHDRAWAL
  □ transfer_with_proof instruction
  □ withdraw_with_proof instruction
  □ Emergency escape hatch (request + execute after timelock)
  □ TransferRecord creation with encrypted metadata storage
  □ End-to-end test: deposit → transfer → withdraw

DAY 7-8: FRONTEND + STEALTH ADDRESSES
  □ React app with shadcn/ui
  □ Credential issuance page (mock AMINA portal)
  □ snarkjs WASM integration (in-browser proof generation)
  □ Stealth keypair generation + localStorage management
  □ Deposit, transfer, withdraw pages with proof generation
  □ Dashboard with transfer history

DAY 9: SQUADS + TRAPDOOR + POLISH
  □ Squads multisig setup
  □ authorize_decryption instruction
  □ Compliance view page showing decryption flow
  □ Deploy everything to Solana devnet
  □ End-to-end testing on devnet

DAY 10: SUBMISSION
  □ Record 3-minute demo video
  □ Write README with architecture diagrams
  □ Clean up repo, add comments
  □ Submit on DoraHacks before deadline
```

---

# DEPENDENCIES & VERSIONS

```
# Circom / ZK
circom: 2.1.x
snarkjs: 0.7.x
circomlib: 2.0.x (installed via npm in circuits/ directory)

# Solana
solana-cli: 1.18.x+ (needed for alt_bn128 syscalls)
anchor: 0.30.x
groth16-solana: 0.2.x
light-poseidon: 1.0.x
spl-token: latest
squads-multisig-program: latest SDK

# Frontend
react: 18.x
vite: 5.x
@solana/web3.js: 1.x
@solana/wallet-adapter-react: latest
@solana/spl-token: latest
shadcn/ui: latest
snarkjs: 0.7.x (browser WASM bundle)
```

---

# RISK REGISTER

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ElGamal in circuit too complex | HIGH | HIGH | Fallback: nacl box encryption off-circuit. Describe ElGamal as production upgrade. |
| groth16-solana byte format issues | HIGH | MEDIUM | Follow exact negation pattern from wkennedy/solana-zk-proof-example repo |
| Proof generation >10 seconds in browser | MEDIUM | MEDIUM | Reduce circuit (drop EdDSA sig verification — largest component). Use pot14 instead of pot16. |
| Poseidon on-chain hits compute limit | MEDIUM | MEDIUM | Use light-poseidon crate. If still over, compute Merkle root off-chain and submit as argument with separate verification. |
| Squads SDK integration issues | MEDIUM | LOW | Fallback to single authority. Note Squads as production feature. |
| Random stealth keypair lost by user | LOW | HIGH | Add "Export Stealth Keys" button. Warn prominently in UI. |
| Circuit doesn't compile (constraint issues) | MEDIUM | HIGH | Build incrementally: start with Merkle-only circuit, add stages one by one. Test after each addition. |

**Highest-risk item: ElGamal inside the circuit.** If this proves too difficult to implement in Circom within the timeline, the fallback is:
1. Do ElGamal encryption in JavaScript (off-circuit)
2. Store the ciphertexts on-chain
3. Add a note: "Production version proves encryption correctness inside the ZK circuit"
4. This still demonstrates the concept — judges will understand the upgrade path

---

# END OF TECHNICAL ARCHITECTURE DOCUMENT
