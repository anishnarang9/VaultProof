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
PTAU_NEW="pot16_0000.ptau"
PTAU_CONTRIBUTED="pot16_0001.ptau"
PTAU_FILE="pot16_final.ptau"
PTAU_POWER=16  # 2^16 = 65536 constraints max (current circuit is ~49k)

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

# Step 2: Generate Powers of Tau
echo ""
echo "[2/6] Generating Powers of Tau..."
$SNARKJS powersoftau new bn128 ${PTAU_POWER} ${BUILD_DIR}/${PTAU_NEW} -v

# Step 3: Contribute to and prepare phase 2
echo ""
echo "[3/6] Contributing to and preparing phase 2..."
$SNARKJS powersoftau contribute \
    ${BUILD_DIR}/${PTAU_NEW} \
    ${BUILD_DIR}/${PTAU_CONTRIBUTED} \
    --name="agent1" \
    -e="vaultproof-stablehacks-2026-random-entropy-$(date +%s)"
$SNARKJS powersoftau prepare phase2 \
    ${BUILD_DIR}/${PTAU_CONTRIBUTED} \
    ${BUILD_DIR}/${PTAU_FILE}

# Step 4: Circuit-specific Phase 2 setup (Groth16)
echo ""
echo "[4/6] Starting circuit-specific Groth16 setup..."
$SNARKJS groth16 setup \
    ${BUILD_DIR}/${CIRCUIT_NAME}.r1cs \
    ${BUILD_DIR}/${PTAU_FILE} \
    ${BUILD_DIR}/${CIRCUIT_NAME}_0000.zkey

# Step 5: Contribute to circuit-specific setup (add entropy)
echo ""
echo "[5/6] Contributing to circuit-specific ceremony..."
$SNARKJS zkey contribute \
    ${BUILD_DIR}/${CIRCUIT_NAME}_0000.zkey \
    ${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey \
    --name="agent1" \
    -v \
    -e="vaultproof-stablehacks-2026-random-entropy-$(date +%s)"

# Step 6: Export verification key (JSON, for off-chain verification)
echo ""
echo "[6/6] Exporting verification key..."
$SNARKJS zkey export verificationkey \
    ${BUILD_DIR}/${CIRCUIT_NAME}_final.zkey \
    ${BUILD_DIR}/verification_key.json

echo "Verification key exported."

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
echo "Next: Run 'node export_vk_solana.mjs build/verification_key.json > ../programs/vusd-vault/src/keys/verifying_key.rs'"
