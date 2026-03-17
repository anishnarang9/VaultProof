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

export const TREE_DEPTH = 20;
export const MAX_LEAVES = 1 << TREE_DEPTH;
export const BN254_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617n;

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
export const DEFAULT_SOURCE_OF_FUNDS_SEED = 12345n;
export const DEFAULT_CREDENTIAL_VERSION = 1n;

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

export function defaultSourceOfFundsHash(crypto_ctx) {
    const { poseidon, F } = crypto_ctx;
    return F.toObject(poseidon([DEFAULT_SOURCE_OF_FUNDS_SEED]));
}

export function normalizeCredentialFields(crypto_ctx, fields) {
    return {
        ...fields,
        sourceOfFundsHash: fields.sourceOfFundsHash ?? defaultSourceOfFundsHash(crypto_ctx),
        credentialVersion: fields.credentialVersion ?? DEFAULT_CREDENTIAL_VERSION,
    };
}

export function buildCredentialHash(crypto_ctx, fields) {
    const { poseidon, F } = crypto_ctx;
    const normalizedFields = normalizeCredentialFields(crypto_ctx, fields);

    const credHash1 = poseidon([normalizedFields.name, normalizedFields.nationality]);
    const credHash2 = poseidon([normalizedFields.dateOfBirth, normalizedFields.jurisdiction]);
    const credHash3 = poseidon([
        normalizedFields.accreditationStatus,
        normalizedFields.credentialExpiry,
    ]);
    const credHash4 = poseidon([
        normalizedFields.sourceOfFundsHash,
        normalizedFields.credentialVersion,
    ]);
    const credHashFinal = poseidon([
        F.toObject(credHash1),
        F.toObject(credHash2),
        F.toObject(credHash3),
        F.toObject(credHash4),
    ]);

    return {
        normalizedFields,
        credHashFinal,
        credHashFinalBigInt: F.toObject(credHashFinal),
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
    const { normalizedFields, credHashFinal, credHashFinalBigInt } = buildCredentialHash(
        crypto_ctx,
        fields
    );

    // Sign with issuer's key
    const signature = eddsa.signPoseidon(issuer.privKey, credHashFinal);

    const walletPubkey = normalizedFields.walletPubkey ?? 0n;

    // Compute leaf = Poseidon(credHashFinal, identitySecret, walletPubkey)
    const leaf = poseidon([credHashFinalBigInt, identitySecret, walletPubkey]);
    const leafBigInt = F.toObject(leaf);

    return {
        ...normalizedFields,
        identitySecret,
        walletPubkey,
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
    const emptyNodes = [F.toObject(poseidon([0n]))];
    for (let level = 1; level <= TREE_DEPTH; level++) {
        emptyNodes.push(F.toObject(poseidon([emptyNodes[level - 1], emptyNodes[level - 1]])));
    }

    if (leafValues.length === 0) {
        return {
            root: emptyNodes[TREE_DEPTH],
            treeLevels: [{
                root: emptyNodes[TREE_DEPTH],
                pathElements: emptyNodes.slice(0, TREE_DEPTH),
                pathIndices: Array(TREE_DEPTH).fill(0),
            }],
            emptyLeaf: emptyNodes[0],
        };
    }

    const treeLevels = leafValues.map(() => ({
        pathElements: [],
        pathIndices: [],
    }));
    const proofNodeIndices = leafValues.map((_, index) => index);
    let levelNodes = new Map(leafValues.map((leaf, index) => [index, leaf]));

    for (let level = 0; level < TREE_DEPTH; level++) {
        for (let leafIndex = 0; leafIndex < leafValues.length; leafIndex++) {
            const nodeIndex = proofNodeIndices[leafIndex];
            const siblingIndex = nodeIndex ^ 1;

            treeLevels[leafIndex].pathElements.push(
                levelNodes.get(siblingIndex) ?? emptyNodes[level]
            );
            treeLevels[leafIndex].pathIndices.push(nodeIndex & 1);
            proofNodeIndices[leafIndex] = nodeIndex >> 1;
        }

        const parentIndices = new Set();
        for (const nodeIndex of levelNodes.keys()) {
            parentIndices.add(nodeIndex >> 1);
        }

        const nextLevelNodes = new Map();
        for (const parentIndex of parentIndices) {
            const leftIndex = parentIndex * 2;
            const rightIndex = leftIndex + 1;
            const left = levelNodes.get(leftIndex) ?? emptyNodes[level];
            const right = levelNodes.get(rightIndex) ?? emptyNodes[level];
            nextLevelNodes.set(parentIndex, F.toObject(poseidon([left, right])));
        }
        levelNodes = nextLevelNodes;
    }

    const root = levelNodes.get(0) ?? emptyNodes[TREE_DEPTH];
    for (const proof of treeLevels) {
        proof.root = root;
    }

    return { root, treeLevels, emptyLeaf: emptyNodes[0] };
}

/**
 * Generate a Merkle proof for a leaf at a given index.
 */
export function getMerkleProof(treeLevels, leafIndex) {
    return treeLevels[leafIndex];
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
        retailThreshold = usd(10000),
        accreditedThreshold = usd(1000000),
        institutionalThreshold = (2n ** 64n) - 1n,
        expiredThreshold = usd(1000),
        balance,
        recipientAddress,
        elgamalRandomness,
        regulatorKeypair,
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
        sourceOfFundsHash: credential.sourceOfFundsHash.toString(),
        credentialVersion: credential.credentialVersion.toString(),
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
        retailThreshold: retailThreshold.toString(),
        accreditedThreshold: accreditedThreshold.toString(),
        institutionalThreshold: institutionalThreshold.toString(),
        expiredThreshold: expiredThreshold.toString(),
        regulatorPubKeyX: regulatorKeypair.pubKeyX.toString(),
        regulatorPubKeyY: regulatorKeypair.pubKeyY.toString(),
        walletPubkey: credential.walletPubkey.toString(),
        encryptedMetadata: encryptedMetadata.map((e) => e.toString()),
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
        thresholds = {
            retail: usd(10000),
            accredited: usd(1000000),
            institutional: (2n ** 64n) - 1n,
            expired: usd(1000),
        },
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
        retailThreshold: thresholds.retail,
        accreditedThreshold: thresholds.accredited,
        institutionalThreshold: thresholds.institutional,
        expiredThreshold: thresholds.expired,
        balance,
        recipientAddress,
        elgamalRandomness,
        regulatorKeypair,
        encryptedMetadata: overrideEncrypted || encrypted,
    });

    return { input, credential, merkleRoot: root, encrypted, treeLevels };
}
