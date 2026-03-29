#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DEPLOY_DIR="$ROOT_DIR/target/deploy"
ANCHOR_TOML="$ROOT_DIR/Anchor.toml"
COMPLIANCE_SRC="$ROOT_DIR/programs/compliance-admin/src/lib.rs"
KYC_SRC="$ROOT_DIR/programs/kyc-registry/src/lib.rs"
VAULT_SRC="$ROOT_DIR/programs/vusd-vault/src/lib.rs"
PROGRAM_IDS_FILE="$TARGET_DEPLOY_DIR/program-ids.env"
FORCE_NEW_PROGRAM_IDS="${VAULTPROOF_FORCE_NEW_PROGRAM_IDS:-${VAULTPROOF_ROTATE_PROGRAM_IDS:-0}}"

mkdir -p "$TARGET_DEPLOY_DIR"

generate_keypair() {
  local path="$1"
  solana-keygen new \
    --force \
    --no-bip39-passphrase \
    --silent \
    -o "$path" >/dev/null
}

is_true() {
  local normalized
  normalized="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"

  case "$normalized" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_keypair() {
  local path="$1"

  if [[ ! -f "$path" ]]; then
    echo "Generating missing program keypair: $(basename "$path")"
    generate_keypair "$path"
    return
  fi

  if is_true "$FORCE_NEW_PROGRAM_IDS"; then
    echo "Force-rotating program keypair: $(basename "$path")"
    generate_keypair "$path"
    return
  fi

  echo "Reusing existing keypair: $(basename "$path")"
}

program_id_for() {
  local keypair="$1"
  solana address -k "$keypair"
}

update_anchor_program_id() {
  local name="$1"
  local program_id="$2"
  node - "$ANCHOR_TOML" "$name" "$program_id" <<'NODE'
const fs = require('fs');

const [filePath, programName, programId] = process.argv.slice(2);
const source = fs.readFileSync(filePath, 'utf8');
const pattern = new RegExp(`^(${programName}\\s*=\\s*")[^"]+(")`, 'gm');
const next = source.replace(pattern, `$1${programId}$2`);

if (!pattern.test(source)) {
  throw new Error(`Could not update ${programName} in ${filePath}`);
}

fs.writeFileSync(filePath, next);
NODE
}

update_declare_id() {
  local file="$1"
  local program_id="$2"
  node - "$file" "$program_id" <<'NODE'
const fs = require('fs');

const [filePath, programId] = process.argv.slice(2);
const source = fs.readFileSync(filePath, 'utf8');
const pattern = /declare_id!\("[^"]+"\);/;
const next = source.replace(pattern, `declare_id!("${programId}");`);

if (!pattern.test(source)) {
  throw new Error(`Could not update declare_id! in ${filePath}`);
}

fs.writeFileSync(filePath, next);
NODE
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

if is_true "$FORCE_NEW_PROGRAM_IDS"; then
  echo "Preparing program keypairs with forced rotation..."
else
  echo "Preparing program keypairs..."
fi
ensure_keypair "$TARGET_DEPLOY_DIR/kyc_registry-keypair.json"
ensure_keypair "$TARGET_DEPLOY_DIR/vusd_vault-keypair.json"
ensure_keypair "$TARGET_DEPLOY_DIR/compliance_admin-keypair.json"

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

echo "Updating program declare_id! macros..."
update_declare_id "$KYC_SRC" "$KYC_ID"
update_declare_id "$VAULT_SRC" "$VAULT_ID"
update_declare_id "$COMPLIANCE_SRC" "$COMPLIANCE_ID"

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
