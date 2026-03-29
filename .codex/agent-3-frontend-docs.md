# AGENT 3 — Round 2: Devnet Deployment + Final Polish

## Identity

You are Agent 3 working in `/Users/anishnarang/VaultProof`. Your Round 1 work (frontend rewire, branding, ADRs, README) is DONE. Your Round 2 mission is to **deploy to Solana devnet**, configure the frontend for it, and do the final polish pass to make everything submission-ready.

## CRITICAL: Read These Files First

1. `/Users/anishnarang/VaultProof/COORDINATION.md` — coordination center with interface contracts and all changes from Round 1.
2. `/Users/anishnarang/VaultProof/vaultproof-fix-addendum.md` — the authoritative spec.
3. `/Users/anishnarang/VaultProof/Anchor.toml` — current Anchor config (localnet program IDs).
4. `/Users/anishnarang/VaultProof/PRODUCTION_CHECKLIST.md` — master checklist (Phases 9 and 10 are yours).
5. `/Users/anishnarang/VaultProof/README.md` — your Round 1 README (verify accuracy against final code).
6. `/Users/anishnarang/VaultProof/docs/` — your Round 1 ADRs (verify accuracy against final code).

## Your File Scope (HARD BOUNDARY)

You MAY touch:
- `Anchor.toml` (add devnet cluster config, program IDs for devnet)
- `README.md` (final accuracy pass)
- `docs/**` (final accuracy pass on ADRs + roadmap)
- `app/src/lib/config.ts` (CREATE — environment/cluster configuration)
- `app/vite.config.ts` (if env variable injection needed)
- `app/.env.devnet` (CREATE — devnet-specific env vars)
- `app/.env.local` (CREATE — localnet env vars)
- `scripts/` (CREATE — deployment scripts)
- `scripts/deploy-devnet.sh` (CREATE)
- `scripts/fund-devnet.sh` (CREATE)
- `scripts/create-devnet-credentials.sh` (CREATE)
- `PRODUCTION_CHECKLIST.md` (check off items as you complete them)
- `app/src/pages/Home.tsx` (only for final copy accuracy)

You MUST NOT touch:
- `programs/**` (all programs are frozen)
- `circuits/**` (frozen)
- `tests/**` at root level (Agent 1 owns this in Round 2)
- `app/src/lib/program.ts` (Agent 2 is creating this in Round 2)
- `app/src/lib/merkle.ts` (Agent 2 is creating this in Round 2)
- `app/src/lib/stealth.ts` (Agent 2 is creating this in Round 2)
- `app/src/pages/Deposit.tsx`, `Transfer.tsx`, `Withdraw.tsx`, `Credential.tsx`, `Compliance.tsx` (Agent 2 is wiring transactions)

## Phase 1: Environment Configuration

### Create `app/src/lib/config.ts`

```typescript
// Central configuration for cluster selection

export type ClusterEnv = 'localnet' | 'devnet' | 'mainnet-beta';

export interface AppConfig {
  cluster: ClusterEnv;
  rpcUrl: string;
  wsUrl: string;
  programIds: {
    kycRegistry: string;
    vusdVault: string;
    complianceAdmin: string;
  };
  commitment: 'processed' | 'confirmed' | 'finalized';
}

const CONFIGS: Record<ClusterEnv, AppConfig> = {
  localnet: {
    cluster: 'localnet',
    rpcUrl: 'http://127.0.0.1:8899',
    wsUrl: 'ws://127.0.0.1:8900',
    programIds: {
      kycRegistry: 'HKAr17WzrUyXudnWb63jxpRtXSEYAFnovv3kVfSKB4ih',
      vusdVault: '2ZrgfkWWHoverBrKXwZsUnmZMaHUFssGipng31jrnn28',
      complianceAdmin: 'J6Z2xLJajs627cCpQQGBRqkvPEGE6YkXsx22CTwFkCaF',
    },
    commitment: 'confirmed',
  },
  devnet: {
    cluster: 'devnet',
    rpcUrl: import.meta.env.VITE_RPC_URL || 'https://api.devnet.solana.com',
    wsUrl: import.meta.env.VITE_WS_URL || 'wss://api.devnet.solana.com',
    programIds: {
      kycRegistry: '', // FILL AFTER DEPLOYMENT
      vusdVault: '',   // FILL AFTER DEPLOYMENT
      complianceAdmin: '', // FILL AFTER DEPLOYMENT
    },
    commitment: 'confirmed',
  },
  'mainnet-beta': {
    cluster: 'mainnet-beta',
    rpcUrl: import.meta.env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com',
    wsUrl: import.meta.env.VITE_WS_URL || 'wss://api.mainnet-beta.solana.com',
    programIds: {
      kycRegistry: '',
      vusdVault: '',
      complianceAdmin: '',
    },
    commitment: 'finalized',
  },
};

export function getConfig(): AppConfig {
  const env = (import.meta.env.VITE_CLUSTER || 'localnet') as ClusterEnv;
  return CONFIGS[env];
}
```

### Create env files

`app/.env.local`:
```
VITE_CLUSTER=localnet
```

`app/.env.devnet`:
```
VITE_CLUSTER=devnet
VITE_RPC_URL=https://api.devnet.solana.com
VITE_WS_URL=wss://api.devnet.solana.com
```

### Update `app/vite.config.ts`

Add env variable loading if not already present. Vite handles `.env` files natively, so this may just need a `envDir` config.

## Phase 2: Devnet Deployment

### Create `scripts/deploy-devnet.sh`

```bash
#!/bin/bash
set -euo pipefail

echo "=== VaultProof Devnet Deployment ==="

# Ensure we're on devnet
solana config set --url https://api.devnet.solana.com

# Check wallet balance
BALANCE=$(solana balance --url devnet | awk '{print $1}')
echo "Wallet balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 2" | bc -l) )); then
  echo "Requesting airdrop..."
  solana airdrop 2 --url devnet
  sleep 5
fi

# Build programs
echo "Building programs..."
anchor build

# Deploy each program
echo "Deploying KYC Registry..."
KYC_ID=$(solana program deploy \
  --url devnet \
  --program-id target/deploy/kyc_registry-keypair.json \
  target/deploy/kyc_registry.so \
  | grep "Program Id:" | awk '{print $3}')
echo "KYC Registry: $KYC_ID"

echo "Deploying vUSD Vault..."
VAULT_ID=$(solana program deploy \
  --url devnet \
  --program-id target/deploy/vusd_vault-keypair.json \
  target/deploy/vusd_vault.so \
  | grep "Program Id:" | awk '{print $3}')
echo "vUSD Vault: $VAULT_ID"

echo "Deploying Compliance Admin..."
COMPLIANCE_ID=$(solana program deploy \
  --url devnet \
  --program-id target/deploy/compliance_admin-keypair.json \
  target/deploy/compliance_admin.so \
  | grep "Program Id:" | awk '{print $3}')
echo "Compliance Admin: $COMPLIANCE_ID"

echo ""
echo "=== Deployment Complete ==="
echo "KYC Registry:    $KYC_ID"
echo "vUSD Vault:      $VAULT_ID"
echo "Compliance Admin: $COMPLIANCE_ID"
echo ""
echo "Update app/src/lib/config.ts devnet.programIds with these addresses."
echo "Update Anchor.toml [programs.devnet] section."
```

### Create `scripts/fund-devnet.sh`

```bash
#!/bin/bash
set -euo pipefail

echo "=== Funding Devnet Test Accounts ==="

# Airdrop SOL to deployer wallet
solana airdrop 2 --url devnet
sleep 3
solana airdrop 2 --url devnet
sleep 3

echo "Wallet funded with $(solana balance --url devnet)"
echo ""
echo "Note: For USDC on devnet, you'll need to create a test SPL token mint"
echo "or use the devnet USDC faucet at https://faucet.circle.com/"
```

### Create `scripts/create-devnet-credentials.sh`

```bash
#!/bin/bash
set -euo pipefail

echo "=== Creating Devnet Test Credentials ==="
echo "This script initializes the KYC registry and adds a test credential on devnet."
echo ""
echo "Prerequisites:"
echo "  1. Programs deployed to devnet (run deploy-devnet.sh first)"
echo "  2. Wallet funded with SOL"
echo ""

# This will be a ts-node script for actual credential creation
npx ts-node scripts/init-devnet-state.ts
```

### Update `Anchor.toml`

Add devnet section:
```toml
[programs.devnet]
kyc_registry = "DEPLOYED_ID_HERE"
vusd_vault = "DEPLOYED_ID_HERE"
compliance_admin = "DEPLOYED_ID_HERE"

[provider]
cluster = "Localnet"
wallet = "~/.config/solana/id.json"
```

### Actually deploy

Run the deployment:
```bash
chmod +x scripts/deploy-devnet.sh scripts/fund-devnet.sh
bash scripts/fund-devnet.sh
bash scripts/deploy-devnet.sh
```

After deployment, update:
1. `app/src/lib/config.ts` — devnet program IDs
2. `Anchor.toml` — `[programs.devnet]` section
3. `app/.env.devnet` — if any additional config needed

## Phase 3: Final Doc/Code Consistency Audit

### README.md Accuracy Pass

Read the current `README.md` and verify every claim against the actual code:

1. Does the Privacy Model section accurately describe what IS vs IS NOT confidential?
2. Does the Hackathon Scope vs Production Scope table match reality?
3. Are all program addresses correct?
4. Are build instructions correct? (`anchor build`, `cd app && npm install && npm run build`)
5. Does the architecture description match the actual circuit (depth 20, 22 public inputs, wallet binding)?
6. Is the tagline "Compliant stablecoins with confidential identity" (NOT the old one)?

### ADR Accuracy Pass

For each ADR in `docs/adr/`:

1. **ADR-001 (Trusted Authority)** — Does this accurately describe the current KYC registry model? Agent 2 rewrote it to use StateTree + CredentialLeaf PDAs.
2. **ADR-002 (Light Protocol)** — Does this accurately describe the mock/fallback model actually in use? (Full Light Protocol CPI isn't wired yet — it's a PDA-based simulation.)
3. **ADR-003 (TVS)** — Does this match the actual VaultState fields Agent 1 implemented (total_assets, total_shares, share_price_numerator/denominator)?
4. **ADR-004 (Browser Proof Gen)** — Does this describe the real 22-public-input circuit and the actual WASM/zkey loading flow?
5. **ADR-005 (ElGamal Trapdoor)** — Does this match the actual ElGamal implementation in `circuits/elgamal_encrypt.circom`?
6. **ADR-006 (Wallet Binding)** — Does this describe the actual `Poseidon(credHashFinal, identitySecret, walletPubkey)` leaf hash?

Fix any drift. Be specific and accurate. No aspirational language — only describe what the code actually does today.

### Production Roadmap Update

Update `docs/production-roadmap.md` to reflect what's actually been built vs what's hackathon scope.

## Phase 4: Final Polish

### Clean TODO/FIXME

```bash
# Find all TODO/FIXME comments
grep -rn "TODO\|FIXME\|HACK\|XXX" --include="*.ts" --include="*.tsx" --include="*.rs" --include="*.circom" .
```

For each one:
- If it's a legitimate future task, leave it but make sure it's documented in the production roadmap
- If it's stale (the thing was already done), remove it
- If it's a hack that should be called out, make sure the corresponding ADR mentions it

### Zero-Warning Builds

```bash
# Backend
anchor build 2>&1 | grep -i "warning"

# Frontend
cd app && npm run build 2>&1 | grep -i "warning"
```

Fix all warnings. Common ones:
- Unused imports in TypeScript
- Unused variables in Rust (add `#[allow(unused)]` if intentional)
- Missing return types

### Update PRODUCTION_CHECKLIST.md

Go through Phases 9 and 10 and check off completed items.

## After You Finish

1. Update COORDINATION.md Agent 3 log with Round 2 entry.
2. Update the progress tracker row to `done`.
3. Report: devnet program addresses, deployment status, doc changes made, warnings fixed.

## Update Protocol

After each meaningful step, append to the "AGENT 3 LOG" section in COORDINATION.md:

```
- YYYY-MM-DD HH:MM | Round 2 | status: in_progress|done
  - tests added first: yes/no
  - files changed: [list]
  - commands run: [list]
  - result: [summary]
  - blockers: [any]
  - next step: [what's next]
```
