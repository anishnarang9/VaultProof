pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/eddsaposeidon.circom";

include "merkle_tree_verifier.circom";
include "tiered_threshold.circom";
include "elgamal_encrypt.circom";

// VaultProof Compliance Circuit
//
// Proves ALL of the following simultaneously:
//   1. Credential integrity (AMINA's EdDSA signature over credential fields)
//   2. Merkle membership (credential leaf is in the KYC Registry tree)
//   3. Tiered AML threshold (transfer amount <= tier limit)
//   4. Soft expiry (expired credentials downgraded to $1k limit)
//   5. Balance solvency (balance >= transfer amount)
//   6. ElGamal trapdoor encryption (metadata correctly encrypted to regulator key)
//
// treeDepth: Merkle tree depth (20 for 1,048,576 credentials)
// numMetadataFields: Number of Travel Rule metadata fields to encrypt (5)
template VaultProofCompliance(treeDepth, numMetadataFields) {

    // ================================================================
    // PRIVATE INPUTS (known only to user)
    // ================================================================
    signal input name;                  // Poseidon hash of full name
    signal input nationality;           // ISO 3166-1 numeric country code
    signal input dateOfBirth;           // Unix timestamp of DOB
    signal input jurisdiction;          // Jurisdiction code
    signal input accreditationStatus;   // 0=retail, 1=accredited, 2=institutional
    signal input credentialExpiry;      // Unix timestamp when credential expires
    signal input sourceOfFundsHash;     // Poseidon hash of source-of-funds attestation
    signal input credentialVersion;     // Credential format version number

    signal input identitySecret;        // Random secret binding credential to user

    // EdDSA signature from AMINA Bank over the credential
    signal input issuerSigR8x;
    signal input issuerSigR8y;
    signal input issuerSigS;

    signal input balance;               // User's vUSDC stealth account balance

    // Merkle proof path
    signal input merklePathElements[treeDepth];
    signal input merklePathIndices[treeDepth];

    // ElGamal encryption randomness
    signal input elgamalRandomness;

    // Recipient address (private — encrypted in metadata)
    signal input recipientAddress;

    // ================================================================
    // PUBLIC INPUTS (visible on-chain, verified by Solana program)
    // ================================================================
    signal input merkleRoot;
    signal input transferAmount;
    signal input currentTimestamp;
    signal input retailThreshold;
    signal input accreditedThreshold;
    signal input institutionalThreshold;
    signal input expiredThreshold;
    signal input regulatorPubKeyX;      // AMINA's Baby Jubjub ElGamal public key
    signal input regulatorPubKeyY;
    signal input walletPubkey;

    // ElGamal ciphertext outputs: C1(x,y) + numMetadataFields * C2(x,y)
    signal input encryptedMetadata[2 + 2 * numMetadataFields];

    // AMINA Bank's EdDSA public key is hardcoded for the single-issuer model.
    var issuerPubKeyX = 13277427435165878497778222415993513565335242147425444199013288855685581939618;
    var issuerPubKeyY = 13622229784656158136036771217484571176836296686641868549125388198837476602820;

    // ================================================================
    // STAGE 1: CREDENTIAL INTEGRITY
    // ================================================================
    // Hash all credential fields using nested Poseidon
    // leaf = Poseidon(Poseidon(name, nationality), Poseidon(dob, jurisdiction),
    //                 Poseidon(accreditation, expiry), Poseidon(sourceOfFundsHash, version))

    component credHash1 = Poseidon(2);
    credHash1.inputs[0] <== name;
    credHash1.inputs[1] <== nationality;

    component credHash2 = Poseidon(2);
    credHash2.inputs[0] <== dateOfBirth;
    credHash2.inputs[1] <== jurisdiction;

    component credHash3 = Poseidon(2);
    credHash3.inputs[0] <== accreditationStatus;
    credHash3.inputs[1] <== credentialExpiry;

    component credHash4 = Poseidon(2);
    credHash4.inputs[0] <== sourceOfFundsHash;
    credHash4.inputs[1] <== credentialVersion;

    // Combine the four sub-hashes into the credential hash
    component credHashFinal = Poseidon(4);
    credHashFinal.inputs[0] <== credHash1.out;
    credHashFinal.inputs[1] <== credHash2.out;
    credHashFinal.inputs[2] <== credHash3.out;
    credHashFinal.inputs[3] <== credHash4.out;

    // Verify AMINA's EdDSA signature over the credential hash
    component sigVerifier = EdDSAPoseidonVerifier();
    sigVerifier.enabled <== 1;
    sigVerifier.Ax <== issuerPubKeyX;
    sigVerifier.Ay <== issuerPubKeyY;
    sigVerifier.R8x <== issuerSigR8x;
    sigVerifier.R8y <== issuerSigR8y;
    sigVerifier.S <== issuerSigS;
    sigVerifier.M <== credHashFinal.out;

    // ================================================================
    // STAGE 2: MERKLE MEMBERSHIP
    // ================================================================
    // Compute the credential leaf with wallet binding.
    component leafHasher = Poseidon(3);
    leafHasher.inputs[0] <== credHashFinal.out;
    leafHasher.inputs[1] <== identitySecret;
    leafHasher.inputs[2] <== walletPubkey;

    // Verify Merkle proof from leaf to root
    component merkleVerifier = MerkleTreeVerifier(treeDepth);
    merkleVerifier.leaf <== leafHasher.out;
    merkleVerifier.root <== merkleRoot;
    for (var i = 0; i < treeDepth; i++) {
        merkleVerifier.pathElements[i] <== merklePathElements[i];
        merkleVerifier.pathIndices[i] <== merklePathIndices[i];
    }

    // ================================================================
    // STAGE 3 + 4: TIERED AML THRESHOLD WITH SOFT EXPIRY
    // ================================================================
    component threshold = TieredThreshold();
    threshold.accreditationStatus <== accreditationStatus;
    threshold.credentialExpiry <== credentialExpiry;
    threshold.currentTimestamp <== currentTimestamp;
    threshold.retailThreshold <== retailThreshold;
    threshold.accreditedThreshold <== accreditedThreshold;
    threshold.institutionalThreshold <== institutionalThreshold;
    threshold.expiredThreshold <== expiredThreshold;

    // ================================================================
    // STAGE 5: COMPLIANCE CHECKS
    // ================================================================

    // 5a. Transfer amount <= effective threshold (AML check)
    component amlCheck = LessEqThan(64);
    amlCheck.in[0] <== transferAmount;
    amlCheck.in[1] <== threshold.effectiveThreshold;
    amlCheck.out === 1;

    // 5b. Balance >= transfer amount (solvency check)
    component balanceCheck = GreaterEqThan(64);
    balanceCheck.in[0] <== balance;
    balanceCheck.in[1] <== transferAmount;
    balanceCheck.out === 1;

    // ================================================================
    // STAGE 6: ELGAMAL TRAPDOOR ENCRYPTION
    // ================================================================
    // Encrypt 5 Travel Rule metadata fields to the regulator's public key:
    //   [credentialHash, recipientAddress, transferAmount, currentTimestamp, jurisdiction]

    signal metadataFields[numMetadataFields];
    metadataFields[0] <== credHashFinal.out;    // sender identity hash
    metadataFields[1] <== recipientAddress;      // recipient
    metadataFields[2] <== transferAmount;         // amount
    metadataFields[3] <== currentTimestamp;        // timestamp
    metadataFields[4] <== jurisdiction;            // jurisdiction

    component elgamal = ElGamalEncrypt(numMetadataFields);
    elgamal.randomness <== elgamalRandomness;
    for (var i = 0; i < numMetadataFields; i++) {
        elgamal.metadataFields[i] <== metadataFields[i];
    }
    elgamal.regulatorPubKeyX <== regulatorPubKeyX;
    elgamal.regulatorPubKeyY <== regulatorPubKeyY;

    // Constrain encrypted output to match public inputs
    for (var i = 0; i < 2 + 2 * numMetadataFields; i++) {
        elgamal.encryptedMetadata[i] <== encryptedMetadata[i];
    }
}

// Main circuit instantiation:
// treeDepth = 20 (1,048,576 credentials), numMetadataFields = 5
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
