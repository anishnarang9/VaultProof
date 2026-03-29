#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export VAULTPROOF_CREDENTIALS_ONLY=1
export VAULTPROOF_SOURCE_OF_FUNDS="${VAULTPROOF_SOURCE_OF_FUNDS:-Wire transfer from regulated bank account}"
export VAULTPROOF_CREDENTIAL_VERSION="${VAULTPROOF_CREDENTIAL_VERSION:-1}"

echo "=== Creating Devnet Test Credentials ==="
echo "Source of funds: ${VAULTPROOF_SOURCE_OF_FUNDS}"
echo "Credential version: ${VAULTPROOF_CREDENTIAL_VERSION}"
echo "Vault bootstrap: skipped (VAULTPROOF_CREDENTIALS_ONLY=1)"
echo "Production note: direct wallet authority is used only for devnet bootstrap; Squads multisig remains the intended future/production authority model."
cd "$ROOT_DIR"
npx ts-node --transpile-only scripts/init-devnet-state.ts
