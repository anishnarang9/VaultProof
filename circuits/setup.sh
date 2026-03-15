#!/bin/bash
# VaultProof Circuit Trusted Setup
#
# This script performs the full trusted setup for the compliance circuit:
# 1. Compiles the Circom circuit
# 2. Downloads the Powers of Tau file (if not present)
# 3. Runs the circuit-specific Phase 2 ceremony
# 4. Exports the verification key
#
# Usage: ./setup.sh
#
# Prerequisites: circom, snarkjs (npm install -g snarkjs OR use npx)

set -e

CIRCUIT_NAME="compliance"
BUILD_DIR="build"
PTAU_FILE="pot16.ptau"
PTAU_POWER=16  # 2^16 = 65536 constraints max (circuit is ~26k)

SNARKJS="npx snarkjs"

echo "============================================"
echo "VaultProof Circuit Setup"
echo "============================================"

# Step 0: Create build directory
mkdir -p $BUILD_DIR

# Step 1: Compile the circuit
echo ""
echo "[1/6] Compiling circuit..."
circom ${CIRCUIT_NAME}.circom \
    --r1cs \
    --wasm \
    --sym \
    -o ${BUILD_DIR}/ \
    2>&1

echo "Circuit compiled. R1CS, WASM, and SYM files generated."

# Print circuit info
echo ""
echo "[INFO] Circuit statistics:"
$SNARKJS r1cs info ${BUILD_DIR}/${CIRCUIT_NAME}.r1cs

# Step 2: Download Powers of Tau (if not present)
echo ""
echo "[2/6] Checking Powers of Tau file..."
if [ ! -f "${BUILD_DIR}/${PTAU_FILE}" ]; then
    echo "Downloading powersOfTau28_hez_final_${PTAU_POWER}.ptau..."
    echo "(This is a ~70MB download from Hermez trusted setup ceremony)"
    curl -L -o ${BUILD_DIR}/${PTAU_FILE} \
        "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${PTAU_POWER}.ptau"
    echo "Download complete."
else
    echo "Powers of Tau file already exists. Skipping download."
fi

# Step 3: Circuit-specific Phase 2 setup (Groth16)
echo ""
echo "[3/6] Starting circuit-specific Phase 2 setup..."
$SNARKJS groth16 setup \
    ${BUILD_DIR}/${CIRCUIT_NAME}.r1cs \
    ${BUILD_DIR}/${PTAU_FILE} \
    ${BUILD_DIR}/${CIRCUIT_NAME}_0000.zkey

# Step 4: Contribute to Phase 2 (add entropy)
echo ""
echo "[4/6] Contributing to Phase 2 ceremony..."
$SNARKJS zkey contribute \
    ${BUILD_DIR}/${CIRCUIT_NAME}_0000.zkey \
    ${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey \
    --name="VaultProof hackathon contribution" \
    -v \
    -e="vaultproof-stablehacks-2026-random-entropy-$(date +%s)"

# Step 5: Export verification key (JSON, for off-chain verification)
echo ""
echo "[5/6] Exporting verification key..."
$SNARKJS zkey export verificationkey \
    ${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey \
    ${BUILD_DIR}/verification_key.json

echo "Verification key exported."

# Step 6: Export Solana verifier (optional — for on-chain integration later)
echo ""
echo "[6/6] Exporting Solidity verifier (reference)..."
$SNARKJS zkey export solidityverifier \
    ${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey \
    ${BUILD_DIR}/verifier.sol \
    2>/dev/null || echo "  (Solidity export skipped — not needed for Solana)"

echo ""
echo "============================================"
echo "Setup complete!"
echo "============================================"
echo ""
echo "Generated files:"
echo "  ${BUILD_DIR}/${CIRCUIT_NAME}.r1cs          - Circuit constraints"
echo "  ${BUILD_DIR}/${CIRCUIT_NAME}_js/            - WASM prover"
echo "  ${BUILD_DIR}/${CIRCUIT_NAME}.sym            - Debug symbols"
echo "  ${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey     - Proving key"
echo "  ${BUILD_DIR}/verification_key.json          - Verification key"
echo ""
echo "Next: Run 'node test_circuit.js' to generate and verify a proof."
