#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DEPLOY_DIR="$ROOT_DIR/target/deploy"
ANCHOR_TOML="$ROOT_DIR/Anchor.toml"
COMPLIANCE_SRC="$ROOT_DIR/programs/compliance-admin/src/lib.rs"
KYC_SRC="$ROOT_DIR/programs/kyc-registry/src/lib.rs"
VAULT_SRC="$ROOT_DIR/programs/vusd-vault/src/lib.rs"
PROGRAM_IDS_FILE="$TARGET_DEPLOY_DIR/program-ids.env"

mkdir -p "$TARGET_DEPLOY_DIR"

generate_keypair() {
  local path="$1"
  solana-keygen new \
    --force \
    --no-bip39-passphrase \
    --silent \
    -o "$path" >/dev/null
}

program_id_for() {
  local keypair="$1"
  solana address -k "$keypair"
}

update_anchor_program_id() {
  local name="$1"
  local program_id="$2"
  perl -0pi -e "s/^(${name}\\s*=\\s*\")[^\"]+(\"\\s*)/\$1${program_id}\$2/gm" "$ANCHOR_TOML"
}

update_declare_id() {
  local file="$1"
  local program_id="$2"
  perl -0pi -e "s/declare_id!\\(\"[^\"]+\"\\);/declare_id!(\"${program_id}\");/" "$file"
}

extract_declare_id() {
  sed -n 's/.*declare_id!(\"\([^\"]*\)\").*/\1/p' "$1"
}

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

cd "$ROOT_DIR"
echo "=== VaultProof Devnet Deployment ==="

solana config set --url https://api.devnet.solana.com >/dev/null

BALANCE="$(solana balance --url devnet | awk '{print $1}')"
echo "Wallet balance: ${BALANCE} SOL"

if awk "BEGIN { exit !($BALANCE < 2) }"; then
  echo "Balance below 2 SOL. Requesting airdrop..."
  solana airdrop 2 --url devnet
  sleep 5
fi

echo "Generating fresh program keypairs..."
generate_keypair "$TARGET_DEPLOY_DIR/kyc_registry-keypair.json"
generate_keypair "$TARGET_DEPLOY_DIR/vusd_vault-keypair.json"
generate_keypair "$TARGET_DEPLOY_DIR/compliance_admin-keypair.json"

KYC_ID="$(program_id_for "$TARGET_DEPLOY_DIR/kyc_registry-keypair.json")"
VAULT_ID="$(program_id_for "$TARGET_DEPLOY_DIR/vusd_vault-keypair.json")"
COMPLIANCE_ID="$(program_id_for "$TARGET_DEPLOY_DIR/compliance_admin-keypair.json")"

cat > "$PROGRAM_IDS_FILE" <<EOF
KYC_REGISTRY_ID=$KYC_ID
VUSD_VAULT_ID=$VAULT_ID
COMPLIANCE_ADMIN_ID=$COMPLIANCE_ID
EOF

echo "Updating Anchor.toml program IDs..."
update_anchor_program_id "kyc_registry" "$KYC_ID"
update_anchor_program_id "vusd_vault" "$VAULT_ID"
update_anchor_program_id "compliance_admin" "$COMPLIANCE_ID"

echo "Updating compliance-admin declare_id!..."
update_declare_id "$COMPLIANCE_SRC" "$COMPLIANCE_ID"

KYC_DECLARE_ID="$(extract_declare_id "$KYC_SRC")"
VAULT_DECLARE_ID="$(extract_declare_id "$VAULT_SRC")"

if [[ "$KYC_DECLARE_ID" != "$KYC_ID" || "$VAULT_DECLARE_ID" != "$VAULT_ID" ]]; then
  echo ""
  echo "Fresh program IDs have been generated and written to $PROGRAM_IDS_FILE."
  echo "Anchor.toml and compliance-admin were updated, but deploy is blocked until:"
  echo "  - programs/kyc-registry/src/lib.rs declare_id! matches $KYC_ID"
  echo "  - programs/vusd-vault/src/lib.rs declare_id! matches $VAULT_ID"
  echo ""
  echo "This stop is intentional so we do not deploy mismatched binaries."
  exit 1
fi

echo "Building programs..."
anchor build

KYC_DEPLOYED_ID="$(deploy_program "KYC Registry" "target/deploy/kyc_registry-keypair.json" "target/deploy/kyc_registry.so")"
VAULT_DEPLOYED_ID="$(deploy_program "vUSD Vault" "target/deploy/vusd_vault-keypair.json" "target/deploy/vusd_vault.so")"
COMPLIANCE_DEPLOYED_ID="$(deploy_program "Compliance Admin" "target/deploy/compliance_admin-keypair.json" "target/deploy/compliance_admin.so")"

echo ""
echo "=== Deployment Complete ==="
echo "KYC Registry:     $KYC_DEPLOYED_ID"
echo "vUSD Vault:       $VAULT_DEPLOYED_ID"
echo "Compliance Admin: $COMPLIANCE_DEPLOYED_ID"
