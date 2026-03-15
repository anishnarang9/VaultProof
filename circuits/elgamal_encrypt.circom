pragma circom 2.0.0;

include "node_modules/circomlib/circuits/babyjub.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/escalarmulfix.circom";
include "node_modules/circomlib/circuits/escalarmulany.circom";

// ElGamal encryption on Baby Jubjub curve.
//
// Encrypts `numFields` metadata field elements to a regulator's public key.
// Uses a single randomness `r` for all fields (shared C1).
//
// For each metadata field m_i:
//   C1    = r * G          (shared ephemeral public key)
//   C2_i  = m_i * G + r * PK   (encrypted message point)
//
// The circuit constrains that the public output ciphertexts match
// the correct ElGamal encryption of the private metadata fields.
//
// Uses 254-bit decomposition for field elements (BN128 field is ~254 bits).
// Randomness r must be chosen < 2^253 (caller's responsibility).
template ElGamalEncrypt(numFields) {
    // Private inputs
    signal input randomness;                // random scalar r (must be < 2^253)
    signal input metadataFields[numFields]; // plaintext metadata field elements

    // Public inputs
    signal input regulatorPubKeyX;          // regulator's Baby Jubjub public key (x)
    signal input regulatorPubKeyY;          // regulator's Baby Jubjub public key (y)

    // Public outputs: the ciphertexts that must appear on-chain
    signal input encryptedMetadata[2 + 2 * numFields];

    // Baby Jubjub base point (BASE8)
    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];

    // --- Step 1: Compute C1 = r * G ---
    // Decompose r into 253 bits (r must be < 2^253)
    component rBits = Num2Bits(253);
    rBits.in <== randomness;

    component c1Mul = EscalarMulFix(253, BASE8);
    for (var i = 0; i < 253; i++) {
        c1Mul.e[i] <== rBits.out[i];
    }
    // Constrain C1 matches public output
    encryptedMetadata[0] === c1Mul.out[0];
    encryptedMetadata[1] === c1Mul.out[1];

    // --- Step 2: Compute shared secret r * PK ---
    // Reuse the same bit decomposition from Step 1
    component rPK = EscalarMulAny(253);
    for (var i = 0; i < 253; i++) {
        rPK.e[i] <== rBits.out[i];
    }
    rPK.p[0] <== regulatorPubKeyX;
    rPK.p[1] <== regulatorPubKeyY;

    // --- Step 3: For each metadata field, compute C2_i = m_i * G + r * PK ---
    component mBits[numFields];
    component mG[numFields];
    component c2Add[numFields];

    for (var i = 0; i < numFields; i++) {
        // Convert m_i to bits (254 bits for full field elements)
        mBits[i] = Num2Bits(254);
        mBits[i].in <== metadataFields[i];

        // Compute m_i * G using 254-bit scalar
        mG[i] = EscalarMulFix(254, BASE8);
        for (var j = 0; j < 254; j++) {
            mG[i].e[j] <== mBits[i].out[j];
        }

        // Compute C2_i = m_i * G + r * PK (point addition)
        c2Add[i] = BabyAdd();
        c2Add[i].x1 <== mG[i].out[0];
        c2Add[i].y1 <== mG[i].out[1];
        c2Add[i].x2 <== rPK.out[0];
        c2Add[i].y2 <== rPK.out[1];

        // Constrain C2_i matches public output
        encryptedMetadata[2 + 2*i] === c2Add[i].xout;
        encryptedMetadata[2 + 2*i + 1] === c2Add[i].yout;
    }
}
