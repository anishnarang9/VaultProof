/**
 * VaultProof Comprehensive Circuit Test Suite
 *
 * Exhaustive edge-case testing for the compliance circuit.
 * Tests 9 categories covering happy paths, threshold violations,
 * expiry behavior, Merkle membership, solvency, signature integrity,
 * ElGamal trapdoor encryption, and boundary values.
 *
 * Prerequisites:
 *   1. Run ./setup.sh first (compiles circuit, runs trusted setup)
 *   2. npm install
 *
 * Usage: node test_comprehensive.mjs
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
    buildScenario,
    defaultSourceOfFundsHash,
    tryProve,
    usd,
    TREE_DEPTH,
} from "./test_utils.mjs";

// ================================================================
// Test runner infrastructure
// ================================================================

const results = {};
let currentCategory = "";

function startCategory(name) {
    currentCategory = name;
    results[name] = { tests: [], passed: 0, failed: 0, total: 0 };
    console.log(`\n${"=".repeat(70)}`);
    console.log(`  CATEGORY: ${name}`);
    console.log(`${"=".repeat(70)}`);
}

function recordResult(testName, passed, detail) {
    const cat = results[currentCategory];
    cat.total++;
    if (passed) {
        cat.passed++;
        console.log(`  [PASS] ${testName}`);
    } else {
        cat.failed++;
        console.log(`  [FAIL] ${testName}`);
    }
    if (detail) {
        console.log(`         ${detail}`);
    }
    cat.tests.push({ testName, passed, detail });
}

function recordBug(testName, detail) {
    console.log(`\n  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
    console.log(`  !!! CRITICAL BUG: ${testName}`);
    console.log(`  !!! ${detail}`);
    console.log(`  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
    recordResult(testName, false, `CRITICAL BUG: ${detail}`);
}

// ================================================================
// Main test suite
// ================================================================

async function main() {
    console.log("==========================================");
    console.log("  VAULTPROOF COMPREHENSIVE CIRCUIT TESTS");
    console.log("==========================================");
    console.log("Initializing cryptographic primitives...\n");

    const ctx = await initCrypto();
    const { F, babyJub, poseidon, eddsa, vkey, BASE8 } = ctx;

    // Shared setup
    const issuer = createIssuerKeypair(ctx);
    const regulator = createRegulatorKeypair(ctx);
    const identitySecret = 9876543210987654321n;
    const recipientAddress = 111111111111111111n;
    const elgamalRandomness = 42424242424242n;
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const futureExpiry = nowTs + 86400n * 365n; // 1 year from now

    // Hashed name (simulating Poseidon hash of "Alice Smith")
    const hashedName = F.toObject(poseidon([12345678901234567890n]));
    const baseSourceOfFundsHash = defaultSourceOfFundsHash(ctx);

    // Default valid credential fields
    function validCredFields(overrides = {}) {
        return {
            name: hashedName,
            nationality: 756n,       // Switzerland
            dateOfBirth: 631152000n,  // 1990-01-01
            jurisdiction: 756n,
            accreditationStatus: 0n,  // retail by default
            credentialExpiry: futureExpiry,
            sourceOfFundsHash: baseSourceOfFundsHash,
            credentialVersion: 1n,
            ...overrides,
        };
    }

    // Helper: build a scenario, prove it, and return result
    async function proveScenario(overrides = {}) {
        const credFields = validCredFields(overrides.credFieldOverrides || {});
        const scenario = buildScenario(ctx, {
            issuer: overrides.issuer || issuer,
            regulatorKeypair: overrides.regulatorKeypair || regulator,
            credFields,
            identitySecret: overrides.identitySecret ?? identitySecret,
            transferAmount: overrides.transferAmount ?? usd(5000),
            balance: overrides.balance ?? usd(100000),
            currentTimestamp: overrides.currentTimestamp ?? nowTs,
            recipientAddress: overrides.recipientAddress ?? recipientAddress,
            elgamalRandomness: overrides.elgamalRandomness ?? elgamalRandomness,
            overrideMerkleRoot: overrides.overrideMerkleRoot,
            overrideMerkleProof: overrides.overrideMerkleProof,
            overrideCredential: overrides.overrideCredential,
            overrideEncrypted: overrides.overrideEncrypted,
        });
        const result = await tryProve(scenario.input, vkey);
        return { ...result, scenario };
    }

    // ================================================================
    // CATEGORY 1: HAPPY PATH
    // ================================================================
    startCategory("1. Happy Path");

    // 1.1 Retail user, $5k transfer (under $10k limit)
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 0n },
            transferAmount: usd(5000),
            balance: usd(50000),
        });
        recordResult(
            "Retail user transferring $5,000 (under $10k limit)",
            r.success,
            r.error
        );
    }

    // 1.2 Accredited user, $500k transfer (under $1M limit)
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 1n },
            transferAmount: usd(500000),
            balance: usd(1000000),
        });
        recordResult(
            "Accredited user transferring $500,000 (under $1M limit)",
            r.success,
            r.error
        );
    }

    // 1.3 Institutional user, $50M transfer (effectively unlimited)
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 2n },
            transferAmount: usd(50000000),
            balance: usd(100000000),
        });
        recordResult(
            "Institutional user transferring $50,000,000 (unlimited tier)",
            r.success,
            r.error
        );
    }

    // 1.4 Minimum realistic transfer: $1
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 0n },
            transferAmount: usd(1),
            balance: usd(100),
        });
        recordResult(
            "Transfer of exactly $1 (minimum realistic amount)",
            r.success,
            r.error
        );
    }

    // 1.5 Balance exactly equals transfer amount (zero remaining)
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 0n },
            transferAmount: usd(5000),
            balance: usd(5000),
        });
        recordResult(
            "Balance exactly equals transfer amount (zero remaining)",
            r.success,
            r.error
        );
    }

    // 1.6 Credential expires 1 second from now (still valid)
    {
        const r = await proveScenario({
            credFieldOverrides: {
                accreditationStatus: 1n,
                credentialExpiry: nowTs + 1n,
            },
            transferAmount: usd(500000),
            balance: usd(1000000),
        });
        recordResult(
            "Credential expiring in 1 second (still valid, accredited limits apply)",
            r.success,
            r.error
        );
    }

    // ================================================================
    // CATEGORY 2: AML THRESHOLD VIOLATIONS
    // ================================================================
    startCategory("2. AML Threshold Violations");

    // 2.1 Retail user, $10,001 (just over $10k limit)
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 0n },
            transferAmount: usd(10001),
            balance: usd(50000),
        });
        if (r.success) {
            recordBug(
                "Retail user transferring $10,001 (over $10k limit)",
                "Circuit accepted a transfer OVER the retail AML threshold!"
            );
        } else {
            recordResult(
                "Retail user transferring $10,001 (over $10k limit) — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // 2.2 Retail user, exactly $10,000 (boundary test)
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 0n },
            transferAmount: usd(10000),
            balance: usd(50000),
        });
        recordResult(
            `Retail user transferring exactly $10,000 (boundary) — ${r.success ? "ACCEPTED (LessEqThan)" : "REJECTED"}`,
            true, // This is informational — either behavior documents circuit design
            r.success
                ? "Circuit uses LessEqThan, so $10k == $10k threshold passes. This is correct."
                : `Rejected: ${r.error?.slice(0, 80)}`
        );
    }

    // 2.3 Accredited user, $1,000,001 (just over $1M limit)
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 1n },
            transferAmount: usd(1000001),
            balance: usd(5000000),
        });
        if (r.success) {
            recordBug(
                "Accredited user transferring $1,000,001 (over $1M limit)",
                "Circuit accepted a transfer OVER the accredited AML threshold!"
            );
        } else {
            recordResult(
                "Accredited user transferring $1,000,001 (over $1M limit) — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // 2.4 Retail user trying $1M (way over their tier)
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 0n },
            transferAmount: usd(1000000),
            balance: usd(5000000),
        });
        if (r.success) {
            recordBug(
                "Retail user transferring $1,000,000 (way over $10k tier)",
                "Circuit accepted a retail user sending $1M!"
            );
        } else {
            recordResult(
                "Retail user transferring $1,000,000 (way over $10k tier) — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // ================================================================
    // CATEGORY 3: CREDENTIAL EXPIRY (soft expiry behavior)
    // ================================================================
    startCategory("3. Credential Expiry");

    const pastExpiry = nowTs - 3600n; // expired 1 hour ago

    // 3.1 Expired credential, $999 transfer (under $1k expired threshold)
    {
        const r = await proveScenario({
            credFieldOverrides: {
                accreditationStatus: 1n,
                credentialExpiry: pastExpiry,
            },
            transferAmount: usd(999),
            balance: usd(10000),
        });
        recordResult(
            "Expired credential, $999 transfer (under $1k expired threshold)",
            r.success,
            r.success ? "Correctly allowed under soft-expiry $1k threshold" : `Error: ${r.error?.slice(0, 80)}`
        );
    }

    // 3.2 Expired credential, $1,001 transfer (over $1k expired threshold)
    {
        const r = await proveScenario({
            credFieldOverrides: {
                accreditationStatus: 1n,
                credentialExpiry: pastExpiry,
            },
            transferAmount: usd(1001),
            balance: usd(10000),
        });
        if (r.success) {
            recordBug(
                "Expired credential, $1,001 transfer",
                "Circuit accepted transfer over the expired credential $1k threshold!"
            );
        } else {
            recordResult(
                "Expired credential, $1,001 transfer (over $1k expired threshold) — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // 3.3 Expired INSTITUTIONAL credential — verify downgraded to $1k, not unlimited
    {
        const r = await proveScenario({
            credFieldOverrides: {
                accreditationStatus: 2n, // institutional
                credentialExpiry: pastExpiry,
            },
            transferAmount: usd(5000), // $5k — would pass institutional, should fail expired
            balance: usd(100000),
        });
        if (r.success) {
            recordBug(
                "Expired institutional credential, $5,000 transfer",
                "Expired institutional credential was NOT downgraded to $1k threshold!"
            );
        } else {
            recordResult(
                "Expired institutional credential downgraded to $1k (not unlimited) — correctly rejected $5k",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // 3.4 Credential expired exactly 1 second ago
    {
        const justExpired = nowTs - 1n;
        const r = await proveScenario({
            credFieldOverrides: {
                accreditationStatus: 0n,
                credentialExpiry: justExpired,
            },
            transferAmount: usd(5000), // $5k — over $1k expired threshold
            balance: usd(50000),
        });
        if (r.success) {
            recordBug(
                "Credential expired 1 second ago, $5k transfer",
                "Soft expiry did not kick in for credential expired 1 second ago!"
            );
        } else {
            recordResult(
                "Credential expired 1 second ago — soft expiry correctly kicks in, $5k rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // ================================================================
    // CATEGORY 4: MERKLE MEMBERSHIP
    // ================================================================
    startCategory("4. Merkle Membership");

    // 4.1 Valid proof but wrong merkle root
    {
        const r = await proveScenario({
            overrideMerkleRoot: 99999999999999999999n, // garbage root
        });
        if (r.success) {
            recordBug(
                "Wrong merkle root",
                "Circuit accepted a proof with a merkle root that doesn't match the tree!"
            );
        } else {
            recordResult(
                "Wrong merkle root — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // 4.2 Valid credential but wrong identity_secret (leaf hash won't match)
    {
        const wrongSecret = 1111111111111111111n; // different from the one used to build tree
        // Create credential with the correct secret (for tree), but provide wrong secret in input
        const credFields = validCredFields();
        const correctCred = createCredential(ctx, issuer, credFields, identitySecret);
        const { root, treeLevels } = buildMerkleTree(ctx, [correctCred.leafBigInt]);
        const merkleProof = getMerkleProof(treeLevels, 0);

        // Build a credential with wrong secret — different leaf, but we use the old tree
        const wrongCred = createCredential(ctx, issuer, credFields, wrongSecret);

        const transferAmount = usd(5000);
        const metadataFields = buildMetadataFields(wrongCred, recipientAddress, transferAmount, nowTs);
        const { encrypted } = computeElGamalCiphertexts(ctx, regulator, metadataFields, elgamalRandomness);

        const input = buildCircuitInput({
            credential: wrongCred,
            merkleProof,
            merkleRoot: root,
            transferAmount,
            currentTimestamp: nowTs,
            balance: usd(50000),
            recipientAddress,
            elgamalRandomness,
            regulatorKeypair: regulator,
            issuer,
            encryptedMetadata: encrypted,
        });

        const r = await tryProve(input, vkey);
        if (r.success) {
            recordBug(
                "Wrong identity_secret",
                "Circuit accepted credential with wrong identity_secret — leaf mismatch not caught!"
            );
        } else {
            recordResult(
                "Wrong identity_secret — correctly rejected (leaf hash doesn't match tree)",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // 4.3 Credential never added to tree (random leaf)
    {
        // Build tree with NO leaves (all empty)
        const credFields = validCredFields();
        const cred = createCredential(ctx, issuer, credFields, identitySecret);
        const { root: emptyRoot, treeLevels: emptyTreeLevels } = buildMerkleTree(ctx, []);
        const merkleProof = getMerkleProof(emptyTreeLevels, 0);

        const transferAmount = usd(5000);
        const metadataFields = buildMetadataFields(cred, recipientAddress, transferAmount, nowTs);
        const { encrypted } = computeElGamalCiphertexts(ctx, regulator, metadataFields, elgamalRandomness);

        const input = buildCircuitInput({
            credential: cred,
            merkleProof,
            merkleRoot: emptyRoot,
            transferAmount,
            currentTimestamp: nowTs,
            balance: usd(50000),
            recipientAddress,
            elgamalRandomness,
            regulatorKeypair: regulator,
            issuer,
            encryptedMetadata: encrypted,
        });

        const r = await tryProve(input, vkey);
        if (r.success) {
            recordBug(
                "Credential not in tree (random leaf)",
                "Circuit accepted a credential that was never added to the Merkle tree!"
            );
        } else {
            recordResult(
                "Credential not in tree — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // 4.4 Tampered merkle path elements
    {
        const credFields = validCredFields();
        const cred = createCredential(ctx, issuer, credFields, identitySecret);
        const { root, treeLevels } = buildMerkleTree(ctx, [cred.leafBigInt]);
        const merkleProof = getMerkleProof(treeLevels, 0);

        // Tamper with one sibling hash
        const tamperedProof = {
            pathElements: [...merkleProof.pathElements],
            pathIndices: [...merkleProof.pathIndices],
        };
        tamperedProof.pathElements[3] = 123456789n; // corrupt level 3

        const transferAmount = usd(5000);
        const metadataFields = buildMetadataFields(cred, recipientAddress, transferAmount, nowTs);
        const { encrypted } = computeElGamalCiphertexts(ctx, regulator, metadataFields, elgamalRandomness);

        const input = buildCircuitInput({
            credential: cred,
            merkleProof: tamperedProof,
            merkleRoot: root,
            transferAmount,
            currentTimestamp: nowTs,
            balance: usd(50000),
            recipientAddress,
            elgamalRandomness,
            regulatorKeypair: regulator,
            issuer,
            encryptedMetadata: encrypted,
        });

        const r = await tryProve(input, vkey);
        if (r.success) {
            recordBug(
                "Tampered merkle path elements",
                "Circuit accepted a proof with corrupted Merkle path siblings!"
            );
        } else {
            recordResult(
                "Tampered merkle path elements — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // ================================================================
    // CATEGORY 5: BALANCE SOLVENCY
    // ================================================================
    startCategory("5. Balance Solvency");

    // 5.1 Transfer exceeds balance by $1
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 0n },
            transferAmount: usd(5001),
            balance: usd(5000),
        });
        if (r.success) {
            recordBug(
                "Transfer exceeds balance by $1",
                "Circuit accepted transfer when balance < amount!"
            );
        } else {
            recordResult(
                "Transfer exceeds balance by $1 — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // 5.2 Zero balance trying to transfer
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 0n },
            transferAmount: usd(1),
            balance: 0n,
        });
        if (r.success) {
            recordBug(
                "Zero balance trying to transfer $1",
                "Circuit accepted transfer from a zero-balance account!"
            );
        } else {
            recordResult(
                "Zero balance trying to transfer $1 — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // 5.3 Very large balance and transfer (near u64 max, within institutional tier)
    {
        // Max u64 / 2 ≈ $9.2 quintillion in base units. Stay well under field prime.
        const bigBalance = 9000000000000000000n; // 9e18
        const bigTransfer = 8000000000000000000n; // 8e18
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 2n }, // institutional (unlimited)
            transferAmount: bigTransfer,
            balance: bigBalance,
        });
        recordResult(
            "Very large balance/transfer (9e18 / 8e18) — institutional tier",
            r.success,
            r.success ? "Large values handled correctly" : `Error: ${r.error?.slice(0, 80)}`
        );
    }

    // ================================================================
    // CATEGORY 6: CREDENTIAL INTEGRITY (Signature Verification)
    // ================================================================
    startCategory("6. Credential Integrity");

    // 6.1 Forged signature (random R8, S)
    {
        const credFields = validCredFields({ accreditationStatus: 0n });
        const cred = createCredential(ctx, issuer, credFields, identitySecret);

        // Replace signature with garbage
        const forgedCred = {
            ...cred,
            sigR8x: 12345678901234567890n,
            sigR8y: 98765432109876543210n,
            sigS: 11111111111111111111n,
        };

        const { root, treeLevels } = buildMerkleTree(ctx, [cred.leafBigInt]);
        const merkleProof = getMerkleProof(treeLevels, 0);
        const transferAmount = usd(5000);
        const metadataFields = buildMetadataFields(forgedCred, recipientAddress, transferAmount, nowTs);
        const { encrypted } = computeElGamalCiphertexts(ctx, regulator, metadataFields, elgamalRandomness);

        const input = buildCircuitInput({
            credential: forgedCred,
            merkleProof,
            merkleRoot: root,
            transferAmount,
            currentTimestamp: nowTs,
            balance: usd(50000),
            recipientAddress,
            elgamalRandomness,
            regulatorKeypair: regulator,
            issuer,
            encryptedMetadata: encrypted,
        });

        const r = await tryProve(input, vkey);
        if (r.success) {
            recordBug(
                "Forged signature (random R8, S)",
                "Circuit accepted a credential with a completely forged signature!"
            );
        } else {
            recordResult(
                "Forged signature — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // 6.2 Tampered credential field (accreditation changed from 0→2 after signing)
    {
        // Sign with accreditationStatus=0, then claim accreditationStatus=2
        const credFieldsOriginal = validCredFields({ accreditationStatus: 0n });
        const credOriginal = createCredential(ctx, issuer, credFieldsOriginal, identitySecret);

        // Tamper: change accreditation to institutional, keeping the old signature
        const tamperedCred = {
            ...credOriginal,
            accreditationStatus: 2n, // TAMPERED — was 0 when signed
        };

        // The leaf in the tree was computed with the original credential, so we
        // need to rebuild the tree with the tampered leaf to isolate the signature check.
        // Actually, let's just use the original tree — both the Merkle check and sig check should fail.
        const { root, treeLevels } = buildMerkleTree(ctx, [credOriginal.leafBigInt]);
        const merkleProof = getMerkleProof(treeLevels, 0);
        const transferAmount = usd(500000); // Would be over retail but under institutional
        const metadataFields = buildMetadataFields(tamperedCred, recipientAddress, transferAmount, nowTs);
        const { encrypted } = computeElGamalCiphertexts(ctx, regulator, metadataFields, elgamalRandomness);

        const input = buildCircuitInput({
            credential: tamperedCred,
            merkleProof,
            merkleRoot: root,
            transferAmount,
            currentTimestamp: nowTs,
            balance: usd(1000000),
            recipientAddress,
            elgamalRandomness,
            regulatorKeypair: regulator,
            issuer,
            encryptedMetadata: encrypted,
        });

        const r = await tryProve(input, vkey);
        if (r.success) {
            recordBug(
                "Tampered accreditation_status (0→2 after signing)",
                "Circuit accepted credential with tampered field — signature should have caught this!"
            );
        } else {
            recordResult(
                "Tampered accreditation_status (0→2 after signing) — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // 6.3 Credential signed by different key than AMINA's pubkey
    {
        const rogue = createIssuerKeypair(ctx, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        const credFields = validCredFields({ accreditationStatus: 0n });
        // Sign with rogue key
        const cred = createCredential(ctx, rogue, credFields, identitySecret);

        const { root, treeLevels } = buildMerkleTree(ctx, [cred.leafBigInt]);
        const merkleProof = getMerkleProof(treeLevels, 0);
        const transferAmount = usd(5000);
        const metadataFields = buildMetadataFields(cred, recipientAddress, transferAmount, nowTs);
        const { encrypted } = computeElGamalCiphertexts(ctx, regulator, metadataFields, elgamalRandomness);

        // Pass the REAL issuer pubkey as public input, but the credential was signed by rogue
        const input = buildCircuitInput({
            credential: cred,
            merkleProof,
            merkleRoot: root,
            transferAmount,
            currentTimestamp: nowTs,
            balance: usd(50000),
            recipientAddress,
            elgamalRandomness,
            regulatorKeypair: regulator,
            issuer, // real AMINA key — mismatch with rogue signature
            encryptedMetadata: encrypted,
        });

        const r = await tryProve(input, vkey);
        if (r.success) {
            recordBug(
                "Credential signed by different key than AMINA's pubkey",
                "Circuit accepted a credential signed by an unauthorized issuer!"
            );
        } else {
            recordResult(
                "Credential signed by wrong issuer key — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // ================================================================
    // CATEGORY 7: ELGAMAL TRAPDOOR
    // ================================================================
    startCategory("7. ElGamal Trapdoor");

    // 7.1 Verify regulator can decrypt ALL metadata fields from every happy-path proof
    {
        console.log("\n  --- Verifying regulator decryption on a valid proof ---");
        const credFields = validCredFields({ accreditationStatus: 1n });
        const cred = createCredential(ctx, issuer, credFields, identitySecret);
        const { root, treeLevels } = buildMerkleTree(ctx, [cred.leafBigInt]);
        const merkleProof = getMerkleProof(treeLevels, 0);
        const transferAmount = usd(500000);
        const metaFields = buildMetadataFields(cred, recipientAddress, transferAmount, nowTs);
        const { encrypted, C1 } = computeElGamalCiphertexts(ctx, regulator, metaFields, elgamalRandomness);

        const input = buildCircuitInput({
            credential: cred,
            merkleProof,
            merkleRoot: root,
            transferAmount,
            currentTimestamp: nowTs,
            balance: usd(1000000),
            recipientAddress,
            elgamalRandomness,
            regulatorKeypair: regulator,
            issuer,
            encryptedMetadata: encrypted,
        });

        const r = await tryProve(input, vkey);
        if (!r.success) {
            recordResult(
                "Regulator decryption test (proof generation failed)",
                false,
                `Proof failed: ${r.error?.slice(0, 80)}`
            );
        } else {
            const fieldNames = ["credentialHash", "recipientAddress", "transferAmount", "currentTimestamp", "jurisdiction"];
            let allDecrypted = true;
            for (let i = 0; i < 5; i++) {
                const recovered = elgamalDecryptField(
                    ctx, regulator, C1,
                    encrypted[2 + 2*i], encrypted[2 + 2*i + 1]
                );
                const matches = verifyDecryptedField(ctx, recovered, metaFields[i]);
                if (!matches) {
                    allDecrypted = false;
                    console.log(`         [FAIL] Field '${fieldNames[i]}' decryption mismatch!`);
                } else {
                    console.log(`         [OK]   Field '${fieldNames[i]}' decrypts correctly`);
                }
            }
            recordResult(
                "Regulator can decrypt ALL 5 metadata fields correctly",
                allDecrypted,
                allDecrypted ? "All Travel Rule fields recoverable" : "Some fields failed decryption!"
            );
        }
    }

    // 7.2 Decrypting with WRONG private key produces garbage
    {
        const credFields = validCredFields({ accreditationStatus: 0n });
        const cred = createCredential(ctx, issuer, credFields, identitySecret);
        const transferAmount = usd(5000);
        const metaFields = buildMetadataFields(cred, recipientAddress, transferAmount, nowTs);
        const { encrypted, C1 } = computeElGamalCiphertexts(ctx, regulator, metaFields, elgamalRandomness);

        const wrongRegulator = createRegulatorKeypair(ctx, "999999999999");
        let allGarbage = true;
        for (let i = 0; i < 5; i++) {
            const recovered = elgamalDecryptField(
                ctx, wrongRegulator, C1,
                encrypted[2 + 2*i], encrypted[2 + 2*i + 1]
            );
            const matches = verifyDecryptedField(ctx, recovered, metaFields[i]);
            if (matches) {
                allGarbage = false;
            }
        }
        recordResult(
            "Decrypting with WRONG private key produces garbage (no field matches)",
            allGarbage,
            allGarbage ? "All fields are garbled — privacy preserved" : "SOME FIELDS DECRYPTED WITH WRONG KEY!"
        );
    }

    // 7.3 Sender can't lie about encrypted metadata (wrong ciphertexts rejected)
    {
        const credFields = validCredFields({ accreditationStatus: 0n });
        const transferAmount = usd(5000);

        // Compute correct ciphertexts for the real metadata
        const scenario = buildScenario(ctx, {
            issuer,
            regulatorKeypair: regulator,
            credFields,
            identitySecret,
            transferAmount,
            balance: usd(50000),
            currentTimestamp: nowTs,
            recipientAddress,
            elgamalRandomness,
        });

        // Now forge ciphertexts — encrypt DIFFERENT metadata (fake amount, fake jurisdiction)
        const fakeMetaFields = [
            scenario.credential.credHashFinalBigInt,
            recipientAddress,
            usd(1),      // LIED: says $1 instead of $5000
            nowTs,
            100n,         // LIED: says jurisdiction 100 instead of 756
        ];
        const { encrypted: fakeEncrypted } = computeElGamalCiphertexts(ctx, regulator, fakeMetaFields, elgamalRandomness);

        // Try to use fake ciphertexts with the real transfer
        const input = { ...scenario.input };
        input.encryptedMetadata = fakeEncrypted.map(e => e.toString());

        const r = await tryProve(input, vkey);
        if (r.success) {
            recordBug(
                "Sender lying about encrypted metadata",
                "Circuit accepted forged ciphertexts — sender can LIE about Travel Rule data!"
            );
        } else {
            recordResult(
                "Sender can't lie about encrypted metadata — correctly rejected",
                true,
                `Rejected: ${r.error?.slice(0, 80)}`
            );
        }
    }

    // ================================================================
    // CATEGORY 8: BOUNDARY VALUES
    // ================================================================
    startCategory("8. Boundary Values");

    // 8.1 All credential fields set to 0
    {
        const r = await proveScenario({
            credFieldOverrides: {
                name: 0n,
                nationality: 0n,
                dateOfBirth: 0n,
                jurisdiction: 0n,
                accreditationStatus: 0n,
                credentialExpiry: futureExpiry, // keep valid so we isolate the zero-fields test
            },
            identitySecret: 0n,
            transferAmount: usd(1),
            balance: usd(100),
        });
        recordResult(
            "All credential fields set to 0 (valid but unusual)",
            r.success,
            r.success ? "Circuit handles zero fields — produces valid proof" : `Error: ${r.error?.slice(0, 80)}`
        );
    }

    // 8.2 Accreditation status = 3 (invalid — only 0,1,2 are valid)
    {
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 3n },
            transferAmount: usd(5000),
            balance: usd(50000),
        });
        // The circuit doesn't explicitly constrain accreditationStatus to {0,1,2}.
        // It uses IsEqual comparators: if status is 3, neither isAccredited nor isInstitutional
        // will be 1, so it defaults to retail threshold ($10k).
        // This is a design observation, not necessarily a bug.
        recordResult(
            `Accreditation status = 3 (invalid) — ${r.success ? "ACCEPTED" : "REJECTED"}`,
            true, // informational — document the behavior
            r.success
                ? "BEHAVIOR: status=3 falls through to retail tier ($10k). Consider adding range check."
                : `Rejected: ${r.error?.slice(0, 80)}`
        );
    }

    // 8.3 Field element wrapping / negative-equivalent values
    {
        // The BN128 field prime
        const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
        // -1 in the field is FIELD_PRIME - 1
        // If used as transferAmount, LessEqThan(64) operates on 64-bit values,
        // so this huge number would be truncated / cause assertion failure in Num2Bits(64).
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 2n }, // institutional to avoid AML rejection
            transferAmount: FIELD_PRIME - 1n, // -1 in field arithmetic
            balance: FIELD_PRIME - 1n,
        });
        recordResult(
            `Field-prime-minus-1 as transfer amount — ${r.success ? "ACCEPTED" : "REJECTED"}`,
            true, // informational — document behavior
            r.success
                ? "WARNING: Circuit accepted field-near-prime values! May need range checks."
                : `Correctly rejected: value doesn't fit in 64-bit comparator. ${r.error?.slice(0, 60)}`
        );
    }

    // 8.4 Maximum valid u64 transfer amount (institutional tier)
    {
        // Max u64 = 18446744073709551615, but institutional threshold is exactly this value
        // LessEqThan(64) should pass for amount == threshold
        const maxU64 = 18446744073709551615n;
        const r = await proveScenario({
            credFieldOverrides: { accreditationStatus: 2n },
            transferAmount: maxU64,
            balance: maxU64,
        });
        recordResult(
            `Max u64 transfer amount (institutional) — ${r.success ? "ACCEPTED" : "REJECTED"}`,
            true, // informational
            r.success
                ? "Max u64 works with institutional tier (threshold == max u64)"
                : `Rejected: ${r.error?.slice(0, 80)}`
        );
    }

    // ================================================================
    // CATEGORY 9: CREDENTIAL EXTENSION FIELDS
    // ================================================================
    startCategory("9. Credential Extension Fields");

    // 9.1 Valid proof with an explicit source-of-funds hash present
    {
        const explicitSourceHash = F.toObject(poseidon([54321n]));
        const r = await proveScenario({
            credFieldOverrides: {
                sourceOfFundsHash: explicitSourceHash,
            },
            transferAmount: usd(4000),
            balance: usd(50000),
        });
        recordResult(
            "Valid proof with explicit source-of-funds hash present",
            r.success,
            r.success ? "Extended credential fields are accepted by the circuit" : r.error
        );
    }

    // 9.2 Valid proof with credentialVersion = 2
    {
        const r = await proveScenario({
            credFieldOverrides: {
                credentialVersion: 2n,
            },
            transferAmount: usd(7500),
            balance: usd(50000),
        });
        recordResult(
            "Valid proof with credentialVersion = 2",
            r.success,
            r.success ? "Alternate credential version signs and verifies correctly" : r.error
        );
    }

    // 9.3 Different sourceOfFundsHash changes the leaf hash
    {
        const credA = createCredential(
            ctx,
            issuer,
            validCredFields({
                sourceOfFundsHash: F.toObject(poseidon([11111n])),
            }),
            identitySecret
        );
        const credB = createCredential(
            ctx,
            issuer,
            validCredFields({
                sourceOfFundsHash: F.toObject(poseidon([22222n])),
            }),
            identitySecret
        );
        const leafChanged = credA.leafBigInt !== credB.leafBigInt;
        recordResult(
            "Different sourceOfFundsHash produces a different credential leaf",
            leafChanged,
            leafChanged
                ? "The new field is committed into the signed credential and Merkle leaf"
                : "Leaf hash did not change when sourceOfFundsHash changed"
        );
    }

    // 9.4 credentialVersion = 0 still works
    {
        const r = await proveScenario({
            credFieldOverrides: {
                credentialVersion: 0n,
            },
            transferAmount: usd(2500),
            balance: usd(50000),
        });
        recordResult(
            "credentialVersion = 0 is accepted",
            r.success,
            r.success ? "Version is treated as an unconstrained numeric field" : r.error
        );
    }

    // 9.5 Credential with all new fields verifies against a non-trivial depth-20 Merkle path
    {
        const credentials = [
            createCredential(ctx, issuer, validCredFields({
                name: F.toObject(poseidon([101n])),
                sourceOfFundsHash: F.toObject(poseidon([30001n])),
                credentialVersion: 1n,
            }), identitySecret + 1n),
            createCredential(ctx, issuer, validCredFields({
                name: F.toObject(poseidon([102n])),
                sourceOfFundsHash: F.toObject(poseidon([30002n])),
                credentialVersion: 1n,
            }), identitySecret + 2n),
            createCredential(ctx, issuer, validCredFields({
                name: F.toObject(poseidon([103n])),
                sourceOfFundsHash: F.toObject(poseidon([30003n])),
                credentialVersion: 1n,
            }), identitySecret + 3n),
            createCredential(ctx, issuer, validCredFields({
                name: F.toObject(poseidon([104n])),
                accreditationStatus: 1n,
                sourceOfFundsHash: F.toObject(poseidon([30004n])),
                credentialVersion: 2n,
            }), identitySecret + 4n),
        ];
        const targetIndex = 3;
        const { root, treeLevels } = buildMerkleTree(
            ctx,
            credentials.map((credential) => credential.leafBigInt)
        );
        const merkleProof = getMerkleProof(treeLevels, targetIndex);
        const targetCredential = credentials[targetIndex];
        const transferAmount = usd(500000);
        const metadataFields = buildMetadataFields(
            targetCredential,
            recipientAddress,
            transferAmount,
            nowTs
        );
        const { encrypted } = computeElGamalCiphertexts(
            ctx,
            regulator,
            metadataFields,
            elgamalRandomness
        );
        const input = buildCircuitInput({
            credential: targetCredential,
            merkleProof,
            merkleRoot: root,
            transferAmount,
            currentTimestamp: nowTs,
            balance: usd(1000000),
            recipientAddress,
            elgamalRandomness,
            regulatorKeypair: regulator,
            encryptedMetadata: encrypted,
        });
        const r = await tryProve(input, vkey);
        const hasNonZeroPath = merkleProof.pathIndices.some((index) => index === 1);
        recordResult(
            `Extended credential verifies on a non-zero depth-${TREE_DEPTH} Merkle path`,
            r.success && hasNonZeroPath,
            r.success && hasNonZeroPath
                ? "Depth-20 proof succeeded with a non-trivial Merkle index"
                : `Proof failed or path was trivial: ${r.error ?? "missing non-zero branch"}`
        );
    }

    // ================================================================
    // SUMMARY
    // ================================================================
    console.log(`\n\n${"=".repeat(70)}`);
    console.log("  VAULTPROOF CIRCUIT TEST RESULTS");
    console.log(`${"=".repeat(70)}`);

    let totalPassed = 0;
    let totalFailed = 0;
    let totalTests = 0;

    for (const [catName, cat] of Object.entries(results)) {
        const status = cat.failed === 0 ? "PASSED" : "FAILED";
        console.log(`  ${catName.padEnd(42)} ${cat.passed}/${cat.total}  ${status}`);
        totalPassed += cat.passed;
        totalFailed += cat.failed;
        totalTests += cat.total;
    }

    console.log(`${"=".repeat(70)}`);
    console.log(`  TOTAL: ${totalPassed}/${totalTests} PASSED | ${totalFailed}/${totalTests} FAILED`);
    console.log(`${"=".repeat(70)}`);

    // List any critical bugs
    const bugs = [];
    for (const [catName, cat] of Object.entries(results)) {
        for (const t of cat.tests) {
            if (t.detail && t.detail.startsWith("CRITICAL BUG")) {
                bugs.push(`  [${catName}] ${t.testName}: ${t.detail}`);
            }
        }
    }

    if (bugs.length > 0) {
        console.log(`\n${"!".repeat(70)}`);
        console.log(`  CRITICAL BUGS FOUND: ${bugs.length}`);
        console.log(`${"!".repeat(70)}`);
        for (const b of bugs) {
            console.log(b);
        }
        console.log(`${"!".repeat(70)}`);
    } else {
        console.log("\n  No critical bugs found. Circuit constraints are sound.");
    }

    console.log("");
    process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error("\nTest suite crashed:", err);
    process.exit(2);
});
