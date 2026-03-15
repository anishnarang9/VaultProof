/**
 * VaultProof Circuit Test Utilities
 *
 * Shared cryptographic primitives and helpers for circuit testing.
 * Used by test_circuit.mjs and test_comprehensive.mjs.
 */

import { buildPoseidon } from "circomlibjs";
import { buildEddsa } from "circomlibjs";
import { buildBabyjub } from "circomlibjs";
import * as snarkjs from "snarkjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TREE_DEPTH = 10;
export const MAX_LEAVES = 1 << TREE_DEPTH; // 1024

export const WASM_PATH = path.join(__dirname, "build", "compliance_js", "compliance.wasm");
export const ZKEY_PATH = path.join(__dirname, "build", "compliance_final.zkey");
export const VKEY_PATH = path.join(__dirname, "build", "verification_key.json");

// USDC has 6 decimals. $1 = 1_000_000 base units.
export const USDC_DECIMALS = 6;
export function usd(dollars) {
    return BigInt(dollars) * 1000000n;
}

// Baby Jubjub base point (BASE8)
export const BASE8_RAW = [
    "5299619240641551281634865583518297030282874472190772894086521144482721001553",
    "16950150798460657717958625567821834550301663161624707787222815936182638968203",
];

/**
 * Initialize all cryptographic primitives.
 * Call once at the start of a test suite.
 */
export async function initCrypto() {
    const poseidon = await buildPoseidon();
    const eddsa = await buildEddsa();
    const babyJub = await buildBabyjub();
    const F = babyJub.F;
    const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));
    const BASE8 = [F.e(BASE8_RAW[0]), F.e(BASE8_RAW[1])];

    return { poseidon, eddsa, babyJub, F, vkey, BASE8 };
}

/**
 * Create an EdDSA issuer keypair.
 */
export function createIssuerKeypair(crypto_ctx, privKeyHex) {
    const { eddsa, F } = crypto_ctx;
    const privKey = Buffer.from(
        privKeyHex || "0001020304050607080900010203040506070809000102030405060708090001",
        "hex"
    );
    const pubKey = eddsa.prv2pub(privKey);
    return {
        privKey,
        pubKey,
        pubKeyX: F.toObject(pubKey[0]),
        pubKeyY: F.toObject(pubKey[1]),
    };
}

/**
 * Create a regulator ElGamal keypair (Baby Jubjub scalar multiplication).
 */
export function createRegulatorKeypair(crypto_ctx, privScalar) {
    const { babyJub, F, BASE8 } = crypto_ctx;
    const sk = BigInt(privScalar || "123456789");
    const pk = babyJub.mulPointEscalar(BASE8, sk);
    return {
        privKey: sk,
        pubKey: pk,
        pubKeyX: F.toObject(pk[0]),
        pubKeyY: F.toObject(pk[1]),
    };
}

/**
 * Create a credential with the given fields and sign it with the issuer key.
 *
 * @param {object} crypto_ctx - { poseidon, eddsa, F }
 * @param {object} issuer - issuer keypair from createIssuerKeypair
 * @param {object} fields - { name, nationality, dateOfBirth, jurisdiction, accreditationStatus, credentialExpiry }
 * @param {bigint} identitySecret
 * @returns {object} credential with all fields, hashes, signature, and leaf
 */
export function createCredential(crypto_ctx, issuer, fields, identitySecret) {
    const { poseidon, eddsa, F } = crypto_ctx;

    const credHash1 = poseidon([fields.name, fields.nationality]);
    const credHash2 = poseidon([fields.dateOfBirth, fields.jurisdiction]);
    const credHash3 = poseidon([fields.accreditationStatus, fields.credentialExpiry]);
    const credHashFinal = poseidon([
        F.toObject(credHash1),
        F.toObject(credHash2),
        F.toObject(credHash3),
    ]);
    const credHashFinalBigInt = F.toObject(credHashFinal);

    // Sign with issuer's key
    const signature = eddsa.signPoseidon(issuer.privKey, credHashFinal);

    // Compute leaf = Poseidon(credHashFinal, identitySecret)
    const leaf = poseidon([credHashFinalBigInt, identitySecret]);
    const leafBigInt = F.toObject(leaf);

    return {
        ...fields,
        identitySecret,
        credHashFinalBigInt,
        signature,
        sigR8x: F.toObject(signature.R8[0]),
        sigR8y: F.toObject(signature.R8[1]),
        sigS: signature.S,
        leafBigInt,
    };
}

/**
 * Build a Merkle tree from an array of leaf BigInts.
 * Returns the root and all tree levels (for proof generation).
 */
export function buildMerkleTree(crypto_ctx, leafValues) {
    const { poseidon, F } = crypto_ctx;
    const emptyLeaf = F.toObject(poseidon([0n]));

    const leaves = new Array(MAX_LEAVES).fill(emptyLeaf);
    for (let i = 0; i < leafValues.length; i++) {
        leaves[i] = leafValues[i];
    }

    let currentLevel = leaves.slice();
    const treeLevels = [currentLevel.slice()];

    for (let level = 0; level < TREE_DEPTH; level++) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const parent = F.toObject(poseidon([currentLevel[i], currentLevel[i + 1]]));
            nextLevel.push(parent);
        }
        currentLevel = nextLevel;
        treeLevels.push(currentLevel.slice());
    }

    return { root: currentLevel[0], treeLevels, emptyLeaf };
}

/**
 * Generate a Merkle proof for a leaf at a given index.
 */
export function getMerkleProof(treeLevels, leafIndex) {
    const pathElements = [];
    const pathIndices = [];
    let nodeIndex = leafIndex;

    for (let level = 0; level < TREE_DEPTH; level++) {
        const isLeft = nodeIndex % 2 === 0;
        const siblingIndex = isLeft ? nodeIndex + 1 : nodeIndex - 1;

        pathElements.push(treeLevels[level][siblingIndex]);
        pathIndices.push(isLeft ? 0 : 1);

        nodeIndex = Math.floor(nodeIndex / 2);
    }

    return { pathElements, pathIndices };
}

/**
 * Compute ElGamal ciphertexts for the given metadata fields.
 */
export function computeElGamalCiphertexts(crypto_ctx, regulatorKeypair, metadataFields, randomness) {
    const { babyJub, F, BASE8 } = crypto_ctx;

    const C1 = babyJub.mulPointEscalar(BASE8, randomness);
    const rPK = babyJub.mulPointEscalar(regulatorKeypair.pubKey, randomness);

    const encrypted = [];
    encrypted.push(F.toObject(C1[0])); // C1.x
    encrypted.push(F.toObject(C1[1])); // C1.y

    for (const m of metadataFields) {
        const mG = babyJub.mulPointEscalar(BASE8, m);
        const C2 = babyJub.addPoint(mG, rPK);
        encrypted.push(F.toObject(C2[0]));
        encrypted.push(F.toObject(C2[1]));
    }

    return { encrypted, C1, rPK };
}

/**
 * Decrypt a single ElGamal ciphertext field.
 * Returns the recovered point m*G.
 */
export function elgamalDecryptField(crypto_ctx, regulatorKeypair, C1, encX, encY) {
    const { babyJub, F } = crypto_ctx;
    const sharedSecret = babyJub.mulPointEscalar(C1, regulatorKeypair.privKey);
    const negShared = [F.neg(sharedSecret[0]), sharedSecret[1]];
    const C2 = [F.e(encX), F.e(encY)];
    return babyJub.addPoint(C2, negShared);
}

/**
 * Check if a decrypted point matches the expected plaintext scalar.
 */
export function verifyDecryptedField(crypto_ctx, recoveredPoint, expectedScalar) {
    const { babyJub, F, BASE8 } = crypto_ctx;
    const expectedPoint = babyJub.mulPointEscalar(BASE8, expectedScalar);
    return F.eq(recoveredPoint[0], expectedPoint[0]) && F.eq(recoveredPoint[1], expectedPoint[1]);
}

/**
 * Build a full circuit input from components.
 *
 * @param {object} opts - All parameters for the circuit
 * @returns {object} Input object ready for snarkjs.groth16.fullProve
 */
export function buildCircuitInput(opts) {
    const {
        credential,
        merkleProof,
        merkleRoot,
        transferAmount,
        currentTimestamp,
        balance,
        recipientAddress,
        elgamalRandomness,
        regulatorKeypair,
        issuer,
        encryptedMetadata,
    } = opts;

    return {
        // Private inputs
        name: credential.name.toString(),
        nationality: credential.nationality.toString(),
        dateOfBirth: credential.dateOfBirth.toString(),
        jurisdiction: credential.jurisdiction.toString(),
        accreditationStatus: credential.accreditationStatus.toString(),
        credentialExpiry: credential.credentialExpiry.toString(),
        identitySecret: credential.identitySecret.toString(),

        issuerSigR8x: credential.sigR8x.toString(),
        issuerSigR8y: credential.sigR8y.toString(),
        issuerSigS: credential.sigS.toString(),

        balance: balance.toString(),

        merklePathElements: merkleProof.pathElements.map((e) => e.toString()),
        merklePathIndices: merkleProof.pathIndices.map((e) => e.toString()),

        elgamalRandomness: elgamalRandomness.toString(),
        recipientAddress: recipientAddress.toString(),

        // Public inputs
        merkleRoot: merkleRoot.toString(),
        transferAmount: transferAmount.toString(),
        currentTimestamp: currentTimestamp.toString(),
        regulatorPubKeyX: regulatorKeypair.pubKeyX.toString(),
        regulatorPubKeyY: regulatorKeypair.pubKeyY.toString(),
        encryptedMetadata: encryptedMetadata.map((e) => e.toString()),

        issuerPubKeyX: issuer.pubKeyX.toString(),
        issuerPubKeyY: issuer.pubKeyY.toString(),
    };
}

/**
 * Attempt to generate and verify a proof.
 *
 * @returns {{ success: boolean, proof?, publicSignals?, error? }}
 */
export async function tryProve(input, vkey) {
    try {
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            input,
            WASM_PATH,
            ZKEY_PATH
        );
        const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
        return { success: valid, proof, publicSignals };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Build the default metadata fields array for a credential.
 */
export function buildMetadataFields(credential, recipientAddress, transferAmount, currentTimestamp) {
    return [
        credential.credHashFinalBigInt,
        recipientAddress,
        transferAmount,
        currentTimestamp,
        credential.jurisdiction,
    ];
}

/**
 * Convenience: build a full valid test scenario.
 * Returns everything needed to call tryProve.
 */
export function buildScenario(crypto_ctx, opts) {
    const {
        issuer,
        regulatorKeypair,
        credFields,
        identitySecret,
        transferAmount,
        balance,
        currentTimestamp,
        recipientAddress,
        elgamalRandomness,
        // Overrides for testing invalid scenarios
        overrideMerkleRoot,
        overrideMerkleProof,
        overrideCredential,
        overrideEncrypted,
    } = opts;

    const credential = overrideCredential || createCredential(crypto_ctx, issuer, credFields, identitySecret);

    const { root, treeLevels } = buildMerkleTree(crypto_ctx, [credential.leafBigInt]);
    const merkleProof = overrideMerkleProof || getMerkleProof(treeLevels, 0);
    const merkleRoot = overrideMerkleRoot !== undefined ? overrideMerkleRoot : root;

    const metadataFields = buildMetadataFields(credential, recipientAddress, transferAmount, currentTimestamp);
    const { encrypted } = computeElGamalCiphertexts(crypto_ctx, regulatorKeypair, metadataFields, elgamalRandomness);

    const input = buildCircuitInput({
        credential,
        merkleProof,
        merkleRoot,
        transferAmount,
        currentTimestamp,
        balance,
        recipientAddress,
        elgamalRandomness,
        regulatorKeypair,
        issuer,
        encryptedMetadata: overrideEncrypted || encrypted,
    });

    return { input, credential, merkleRoot: root, encrypted, treeLevels };
}
