pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/switcher.circom";

// Verifies that a leaf is part of a Merkle tree with the given root.
// Uses Poseidon hashing at each level.
// pathIndices[i] = 0 means the sibling is on the right, 1 means on the left.
template MerkleTreeVerifier(depth) {
    signal input leaf;
    signal input root;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    component hashers[depth];
    component switchers[depth];

    signal levelHashes[depth + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // pathIndices must be binary
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // Use Switcher to conditionally swap left/right based on pathIndices
        switchers[i] = Switcher();
        switchers[i].sel <== pathIndices[i];
        switchers[i].L <== levelHashes[i];
        switchers[i].R <== pathElements[i];

        // Hash the pair using Poseidon(2)
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== switchers[i].outL;
        hashers[i].inputs[1] <== switchers[i].outR;

        levelHashes[i + 1] <== hashers[i].out;
    }

    // Constrain computed root to match the public root
    root === levelHashes[depth];
}
