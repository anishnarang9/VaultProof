import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBabyjub, buildEddsa, buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = __dirname;
const BUILD_DIR = path.join(CIRCUITS_DIR, "build");
const WASM_PATH = path.join(BUILD_DIR, "compliance_js", "compliance.wasm");
const ZKEY_PATH = path.join(BUILD_DIR, "compliance_final.zkey");
const VKEY_PATH = path.join(BUILD_DIR, "verification_key.json");

const TREE_DEPTH = 20;
const NUM_METADATA_FIELDS = 5;
const EXPECTED_PUBLIC_INPUTS = 10 + 2 + (2 * NUM_METADATA_FIELDS);
const BN254_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const BASE8_RAW = [
    "5299619240641551281634865583518297030282874472190772894086521144482721001553",
    "16950150798460657717958625567821834550301663161624707787222815936182638968203",
];
const DEFAULT_SOURCE_OF_FUNDS_SEED = 12345n;
const DEFAULT_CREDENTIAL_VERSION = 1n;

function usd(dollars) {
    return BigInt(dollars) * 1000000n;
}

function walletBytesToField(bytes) {
    const hex = Buffer.from(bytes).toString("hex");
    return BigInt(`0x${hex}`) % BN254_FIELD;
}

function compileCircuitSource() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultproof-circom-"));
    execFileSync(
        "circom",
        ["compliance.circom", "--r1cs", "--wasm", "--sym", "-o", tmpDir],
        { cwd: CIRCUITS_DIR, stdio: "pipe" }
    );

    assert.equal(fs.existsSync(path.join(tmpDir, "compliance.r1cs")), true);
    assert.equal(fs.existsSync(path.join(tmpDir, "compliance_js", "compliance.wasm")), true);
}

function createIssuerKeypair(ctx) {
    const privKey = Buffer.from(
        "0001020304050607080900010203040506070809000102030405060708090001",
        "hex"
    );
    const pubKey = ctx.eddsa.prv2pub(privKey);
    return {
        privKey,
        pubKeyX: ctx.F.toObject(pubKey[0]),
        pubKeyY: ctx.F.toObject(pubKey[1]),
    };
}

function createRegulatorKeypair(ctx) {
    const sk = 123456789n;
    const pk = ctx.babyJub.mulPointEscalar(ctx.BASE8, sk);
    return {
        privKey: sk,
        pubKeyX: ctx.F.toObject(pk[0]),
        pubKeyY: ctx.F.toObject(pk[1]),
        pubKey: pk,
    };
}

function defaultSourceOfFundsHash(ctx) {
    return ctx.F.toObject(ctx.poseidon([DEFAULT_SOURCE_OF_FUNDS_SEED]));
}

function normalizeCredentialFields(ctx, fields) {
    return {
        ...fields,
        sourceOfFundsHash: fields.sourceOfFundsHash ?? defaultSourceOfFundsHash(ctx),
        credentialVersion: fields.credentialVersion ?? DEFAULT_CREDENTIAL_VERSION,
    };
}

function createCredential(ctx, issuer, fields, identitySecret, walletPubkey) {
    const normalizedFields = normalizeCredentialFields(ctx, fields);
    const credHash1 = ctx.poseidon([normalizedFields.name, normalizedFields.nationality]);
    const credHash2 = ctx.poseidon([normalizedFields.dateOfBirth, normalizedFields.jurisdiction]);
    const credHash3 = ctx.poseidon([
        normalizedFields.accreditationStatus,
        normalizedFields.credentialExpiry,
    ]);
    const credHash4 = ctx.poseidon([
        normalizedFields.sourceOfFundsHash,
        normalizedFields.credentialVersion,
    ]);
    const credHashFinal = ctx.poseidon([
        ctx.F.toObject(credHash1),
        ctx.F.toObject(credHash2),
        ctx.F.toObject(credHash3),
        ctx.F.toObject(credHash4),
    ]);
    const credHashFinalBigInt = ctx.F.toObject(credHashFinal);

    const signature = ctx.eddsa.signPoseidon(issuer.privKey, credHashFinal);
    const leaf = ctx.poseidon([credHashFinalBigInt, identitySecret, walletPubkey]);

    return {
        ...normalizedFields,
        identitySecret,
        walletPubkey,
        credHashFinalBigInt,
        sigR8x: ctx.F.toObject(signature.R8[0]),
        sigR8y: ctx.F.toObject(signature.R8[1]),
        sigS: signature.S,
        leafBigInt: ctx.F.toObject(leaf),
    };
}

function computeEmptyNodes(ctx) {
    const emptyNodes = [];
    emptyNodes[0] = ctx.F.toObject(ctx.poseidon([0n]));

    for (let level = 1; level < TREE_DEPTH; level += 1) {
        emptyNodes[level] = ctx.F.toObject(
            ctx.poseidon([emptyNodes[level - 1], emptyNodes[level - 1]])
        );
    }

    return emptyNodes;
}

function buildSingleLeafProof(ctx, leaf) {
    const emptyNodes = computeEmptyNodes(ctx);
    const pathElements = [];
    const pathIndices = [];
    let current = leaf;

    for (let level = 0; level < TREE_DEPTH; level += 1) {
        pathElements.push(emptyNodes[level]);
        pathIndices.push(0);
        current = ctx.F.toObject(ctx.poseidon([current, emptyNodes[level]]));
    }

    return {
        root: current,
        pathElements,
        pathIndices,
    };
}

function computeElGamalCiphertexts(ctx, regulatorKeypair, metadataFields, randomness) {
    const c1 = ctx.babyJub.mulPointEscalar(ctx.BASE8, randomness);
    const rPk = ctx.babyJub.mulPointEscalar(regulatorKeypair.pubKey, randomness);
    const encrypted = [ctx.F.toObject(c1[0]), ctx.F.toObject(c1[1])];

    for (const field of metadataFields) {
        const mG = ctx.babyJub.mulPointEscalar(ctx.BASE8, field);
        const c2 = ctx.babyJub.addPoint(mG, rPk);
        encrypted.push(ctx.F.toObject(c2[0]), ctx.F.toObject(c2[1]));
    }

    return encrypted;
}

function buildCircuitInput({
    credential,
    merkleProof,
    merkleRoot,
    transferAmount,
    currentTimestamp,
    balance,
    recipientAddress,
    elgamalRandomness,
    regulator,
    encryptedMetadata,
    thresholds,
}) {
    return {
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
        merklePathElements: merkleProof.pathElements.map((value) => value.toString()),
        merklePathIndices: merkleProof.pathIndices.map((value) => value.toString()),
        elgamalRandomness: elgamalRandomness.toString(),
        recipientAddress: recipientAddress.toString(),
        merkleRoot: merkleRoot.toString(),
        transferAmount: transferAmount.toString(),
        currentTimestamp: currentTimestamp.toString(),
        retailThreshold: thresholds.retail.toString(),
        accreditedThreshold: thresholds.accredited.toString(),
        institutionalThreshold: thresholds.institutional.toString(),
        expiredThreshold: thresholds.expired.toString(),
        regulatorPubKeyX: regulator.pubKeyX.toString(),
        regulatorPubKeyY: regulator.pubKeyY.toString(),
        walletPubkey: credential.walletPubkey.toString(),
        encryptedMetadata: encryptedMetadata.map((value) => value.toString()),
    };
}

async function generateProof(input) {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        WASM_PATH,
        ZKEY_PATH
    );
    return { proof, publicSignals };
}

async function tryProve(input) {
    try {
        await generateProof(input);
        return { success: true };
    } catch (error) {
        return { success: false, error };
    }
}

async function main() {
    compileCircuitSource();

    assert.equal(fs.existsSync(WASM_PATH), true, "missing compliance.wasm in circuits/build");
    assert.equal(fs.existsSync(ZKEY_PATH), true, "missing compliance_final.zkey in circuits/build");
    assert.equal(fs.existsSync(VKEY_PATH), true, "missing verification_key.json in circuits/build");

    const poseidon = await buildPoseidon();
    const eddsa = await buildEddsa();
    const babyJub = await buildBabyjub();
    const F = babyJub.F;
    const BASE8 = [F.e(BASE8_RAW[0]), F.e(BASE8_RAW[1])];
    const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));

    const ctx = { poseidon, eddsa, babyJub, F, BASE8 };
    const issuer = createIssuerKeypair(ctx);
    const regulator = createRegulatorKeypair(ctx);
    const walletBytes = Uint8Array.from(
        Array.from({ length: 32 }, (_, index) => (index + 17) % 251)
    );
    const walletPubkey = walletBytesToField(walletBytes);

    const thresholds = {
        retail: usd(10000),
        accredited: usd(1000000),
        institutional: (2n ** 64n) - 1n,
        expired: usd(1000),
    };

    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const fields = {
        name: F.toObject(poseidon([12345678901234567890n])),
        nationality: 756n,
        dateOfBirth: 631152000n,
        jurisdiction: 756n,
        accreditationStatus: 1n,
        credentialExpiry: nowTs + (86400n * 365n),
        sourceOfFundsHash: defaultSourceOfFundsHash(ctx),
        credentialVersion: DEFAULT_CREDENTIAL_VERSION,
    };
    const identitySecret = 9876543210987654321n;
    const transferAmount = usd(50000);
    const balance = usd(100000);
    const recipientAddress = 111111111111111111n;
    const randomness = 42424242424242n;

    const credential = createCredential(ctx, issuer, fields, identitySecret, walletPubkey);
    const merkleProof = buildSingleLeafProof(ctx, credential.leafBigInt);
    const metadataFields = [
        credential.credHashFinalBigInt,
        recipientAddress,
        transferAmount,
        nowTs,
        credential.jurisdiction,
    ];
    const encryptedMetadata = computeElGamalCiphertexts(
        ctx,
        regulator,
        metadataFields,
        randomness
    );
    const input = buildCircuitInput({
        credential,
        merkleProof,
        merkleRoot: merkleProof.root,
        transferAmount,
        currentTimestamp: nowTs,
        balance,
        recipientAddress,
        elgamalRandomness: randomness,
        regulator,
        encryptedMetadata,
        thresholds,
    });

    const { proof, publicSignals } = await generateProof(input);
    assert.equal(publicSignals.length, EXPECTED_PUBLIC_INPUTS);
    assert.equal(publicSignals[0], merkleProof.root.toString());
    assert.equal(publicSignals[1], transferAmount.toString());
    assert.equal(publicSignals[2], nowTs.toString());
    assert.equal(publicSignals[3], thresholds.retail.toString());
    assert.equal(publicSignals[4], thresholds.accredited.toString());
    assert.equal(publicSignals[5], thresholds.institutional.toString());
    assert.equal(publicSignals[6], thresholds.expired.toString());
    assert.equal(publicSignals[7], regulator.pubKeyX.toString());
    assert.equal(publicSignals[8], regulator.pubKeyY.toString());
    assert.equal(publicSignals[9], walletPubkey.toString());

    const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    assert.equal(verified, true, "proof should verify with correct public inputs");

    const wrongThresholdSignals = [...publicSignals];
    wrongThresholdSignals[3] = (BigInt(wrongThresholdSignals[3]) + 1n).toString();
    assert.equal(
        await snarkjs.groth16.verify(vkey, wrongThresholdSignals, proof),
        false,
        "proof must fail when AML threshold public input is tampered"
    );

    const wrongWalletSignals = [...publicSignals];
    wrongWalletSignals[9] = (BigInt(wrongWalletSignals[9]) + 1n).toString();
    assert.equal(
        await snarkjs.groth16.verify(vkey, wrongWalletSignals, proof),
        false,
        "proof must fail when wallet binding public input is tampered"
    );

    const shortMerkleInput = buildCircuitInput({
        credential,
        merkleProof: {
            pathElements: [...merkleProof.pathElements.slice(0, 10), ...Array(10).fill(0n)],
            pathIndices: [...merkleProof.pathIndices.slice(0, 10), ...Array(10).fill(0)],
        },
        merkleRoot: merkleProof.root,
        transferAmount,
        currentTimestamp: nowTs,
        balance,
        recipientAddress,
        elgamalRandomness: randomness,
        regulator,
        encryptedMetadata,
        thresholds,
    });
    const shortProofAttempt = await tryProve(shortMerkleInput);
    assert.equal(
        shortProofAttempt.success,
        false,
        "depth-10 path must not satisfy a depth-20 circuit"
    );

    const regressionCredential = createCredential(
        ctx,
        issuer,
        { ...fields, accreditationStatus: 0n },
        identitySecret + 9n,
        walletPubkey
    );
    const regressionMerkleProof = buildSingleLeafProof(ctx, regressionCredential.leafBigInt);
    const regressionTransferAmount = usd(5000);
    const regressionMetadata = computeElGamalCiphertexts(
        ctx,
        regulator,
        [
            regressionCredential.credHashFinalBigInt,
            recipientAddress,
            regressionTransferAmount,
            nowTs,
            regressionCredential.jurisdiction,
        ],
        randomness + 7n
    );
    const regressionInput = buildCircuitInput({
        credential: regressionCredential,
        merkleProof: regressionMerkleProof,
        merkleRoot: regressionMerkleProof.root,
        transferAmount: regressionTransferAmount,
        currentTimestamp: nowTs,
        balance,
        recipientAddress,
        elgamalRandomness: randomness + 7n,
        regulator,
        encryptedMetadata: regressionMetadata,
        thresholds,
    });
    const regressionResult = await generateProof(regressionInput);
    assert.equal(
        await snarkjs.groth16.verify(vkey, regressionResult.publicSignals, regressionResult.proof),
        true,
        "retail regression vector should still verify"
    );

    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
