#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== VaultProof Devnet Deployment ==="
cd "$ROOT_DIR"

solana config set --url https://api.devnet.solana.com >/dev/null

BALANCE="$(solana balance --url devnet | awk '{print $1}')"
echo "Wallet balance: ${BALANCE} SOL"

if awk "BEGIN { exit !($BALANCE < 2) }"; then
  echo "Balance below 2 SOL. Requesting airdrop..."
  solana airdrop 2 --url devnet
  sleep 5
fi

echo "Building programs..."
anchor build

deploy_program() {
  local label="$1"
  local keypair="$2"
  local binary="$3"

  echo "Deploying ${label}..."
  local output
  output="$(solana program deploy --url devnet --program-id "$keypair" "$binary")"
  echo "$output"
  echo "$output" | awk '/Program Id:/ {print $3}'
}

KYC_ID="$(deploy_program "KYC Registry" "target/deploy/kyc_registry-keypair.json" "target/deploy/kyc_registry.so")"
VAULT_ID="$(deploy_program "vUSD Vault" "target/deploy/vusd_vault-keypair.json" "target/deploy/vusd_vault.so")"
COMPLIANCE_ID="$(deploy_program "Compliance Admin" "target/deploy/compliance_admin-keypair.json" "target/deploy/compliance_admin.so")"

echo ""
echo "=== Deployment Complete ==="
echo "KYC Registry:     $KYC_ID"
echo "vUSD Vault:       $VAULT_ID"
echo "Compliance Admin: $COMPLIANCE_ID"
