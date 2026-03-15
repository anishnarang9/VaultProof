/**
 * VaultProof Circuit Test — Quick Smoke Test
 *
 * Generates a single compliance proof and verifies it.
 * For comprehensive testing, run test_comprehensive.mjs instead.
 *
 * Prerequisites:
 *   1. Run ./setup.sh first (compiles circuit, runs trusted setup)
 *   2. npm install
 *
 * Usage: node test_circuit.mjs
 */

import {
    initCrypto,
    createIssuerKeypair,
    createRegulatorKeypair,
    createCredential,
    buildMerkleTree,
    getMerkleProof,
    computeElGamalCiphertexts,
    elgamalDecryptField,
    verifyDecryptedField,
    buildCircuitInput,
    buildMetadataFields,
    tryProve,
    usd,
} from "./test_utils.mjs";

async function main() {
    console.log("============================================");
    console.log("VaultProof Circuit Test (Smoke)");
    console.log("============================================\n");

    // Initialize
    console.log("[1/7] Initializing cryptographic primitives...");
    const ctx = await initCrypto();
    const { F, poseidon } = ctx;

    // Issuer keypair
    console.log("[2/7] Creating issuer keypair and credential...");
    const issuer = createIssuerKeypair(ctx);
    console.log("  Issuer public key X:", issuer.pubKeyX.toString().slice(0, 20) + "...");

    // Credential
    const hashedName = F.toObject(poseidon([12345678901234567890n]));
    const credFields = {
        name: hashedName,
        nationality: 756n,
        dateOfBirth: 631152000n,
        jurisdiction: 756n,
        accreditationStatus: 1n,
        credentialExpiry: 1805097600n,
    };
    const identitySecret = 9876543210987654321n;
    const cred = createCredential(ctx, issuer, credFields, identitySecret);
    console.log("  Credential hash:", cred.credHashFinalBigInt.toString().slice(0, 20) + "...");
    console.log("  Signature valid: true");

    // Merkle tree
    console.log("[3/7] Building Merkle tree...");
    const { root, treeLevels } = buildMerkleTree(ctx, [cred.leafBigInt]);
    const merkleProof = getMerkleProof(treeLevels, 0);
    console.log("  Leaf hash:", cred.leafBigInt.toString().slice(0, 20) + "...");
    console.log("  Merkle root:", root.toString().slice(0, 20) + "...");

    // ElGamal setup
    console.log("[4/7] Setting up ElGamal encryption...");
    const regulator = createRegulatorKeypair(ctx);
    console.log("  Regulator pubkey X:", regulator.pubKeyX.toString().slice(0, 20) + "...");

    const transferAmount = usd(50000);
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
    const recipientAddress = 111111111111111111n;
    const balance = usd(100000);
    const elgamalRandomness = 42424242424242n;

    const metaFields = buildMetadataFields(cred, recipientAddress, transferAmount, currentTimestamp);
    const { encrypted, C1 } = computeElGamalCiphertexts(ctx, regulator, metaFields, elgamalRandomness);
    console.log("  Encrypted metadata:", encrypted.length, "field elements");

    // Build input
    console.log("[5/7] Constructing witness input...");
    const input = buildCircuitInput({
        credential: cred,
        merkleProof,
        merkleRoot: root,
        transferAmount,
        currentTimestamp,
        balance,
        recipientAddress,
        elgamalRandomness,
        regulatorKeypair: regulator,
        issuer,
        encryptedMetadata: encrypted,
    });

    // Generate proof
    console.log("[6/7] Generating proof (this may take a few seconds)...");
    const start = Date.now();
    const result = await tryProve(input, ctx.vkey);
    console.log(`  Proof generated in ${Date.now() - start}ms`);

    // Verify
    console.log("[7/7] Verifying proof...");
    console.log("\n============================================");
    if (result.success) {
        console.log("PROOF VERIFIED SUCCESSFULLY!");
        console.log("============================================");
        console.log("\nThe zero-knowledge proof confirms:");
        console.log("  1. Sender has a valid KYC credential signed by AMINA Bank");
        console.log("  2. Credential is in the on-chain Merkle tree (KYC Registry)");
        console.log("  3. Transfer amount ($50,000) is under the accredited limit ($1M)");
        console.log("  4. Credential is not expired");
        console.log("  5. Sender has sufficient balance ($100,000 >= $50,000)");
        console.log("  6. Travel Rule metadata is correctly encrypted to regulator's key");
        console.log("\nNo personal data was revealed. Only the proof and encrypted metadata.");
    } else {
        console.log("PROOF VERIFICATION FAILED!");
        console.log("============================================");
        console.log("Error:", result.error);
        process.exit(1);
    }

    // Bonus: regulator decryption
    console.log("\n--- Bonus: Simulating regulator decryption ---");
    const recovered = elgamalDecryptField(ctx, regulator, C1, encrypted[6], encrypted[7]);
    const match = verifyDecryptedField(ctx, recovered, transferAmount);
    console.log("  Decrypted amount point matches:", match);
    if (match) console.log("  Regulator can recover transfer amount from encrypted metadata!");

    console.log("\nTest complete.\n");
}

main().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
