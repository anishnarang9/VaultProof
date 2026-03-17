# AGENT 5: FRONTEND REDESIGN — Codex Prompt

## Your Role
You are Agent 5, responsible for completely redesigning the VaultProof frontend into an Anchorage-inspired institutional product with role-based routing, a marketing landing page, operator dashboards, compliance monitoring, investor views, and updated proof generation. You own ALL files in `app/`. Do NOT modify files outside `app/`.

## Project Context
VaultProof is a ZK compliance engine for institutional DeFi vaults on Solana. The current frontend is a basic hackathon UI with 7 pages. The revamp transforms it into a polished institutional SaaS product that looks like anchorage.com — near-black backgrounds, massive whitespace, confident typography, color through restraint.

Read `vaultproof-product-revamp.md` and `vaultproof-technical-bible.md` at the project root for full context.

## Coordination
Log every change you make in `REVAMP-COORDINATION.md` under the Agent 5 section. You are BLOCKED BY Agent 3 (vault IDL for types) and Agent 1 (circuit artifacts). Build the entire UI with mock data hooks first. When upstream artifacts arrive, swap in real data.

---

## WHAT YOU MUST DO

### Task 1: Set up Tailwind v4 + shadcn/ui

Install and configure:
```bash
cd app
npm install tailwindcss @tailwindcss/vite recharts @sqds/multisig
# Note: @lightprotocol/stateless.js only if Agent 2 confirms Light Protocol works
```

Update `vite.config.ts`:
```typescript
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ... keep existing config
})
```

Set up shadcn/ui components (copy-paste pattern, not npm install):
- Button, Card, Table, Dialog, Tabs, Badge, Alert, Input, Label, Select, Separator, Toast
- Configure for the dark Anchorage color palette

Create the design system CSS variables in the main CSS file:
```css
@import "tailwindcss";

:root {
    --bg-primary: #0A0B0E;
    --bg-surface: #12131A;
    --bg-elevated: #1A1B24;
    --border: #1E2028;
    --border-subtle: #16171F;
    --text-primary: #FFFFFF;
    --text-secondary: #8B8D97;
    --text-tertiary: #52535A;
    --accent: #3B82F6;
    --accent-hover: #2563EB;
    --success: #22C55E;
    --warning: #F59E0B;
    --danger: #EF4444;
    --font-sans: 'Inter', -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', 'IBM Plex Mono', monospace;
    --radius: 8px;
}
```

### Task 2: Implement wallet-based routing

Replace the current `App.tsx` routing with role-based routing:

```typescript
function AppRouter() {
    const { publicKey } = useWallet();
    const { data: vault } = useVaultState();

    // Not connected → landing page
    if (!publicKey) return <LandingPage />;

    // Check if connected wallet is the vault authority (or Squads member)
    const isAuthority = vault?.authority && publicKey.equals(vault.authority);

    if (isAuthority) return <OperatorLayout />;
    return <InvestorLayout />;
}
```

**Route structure:**
```
/ (Landing)              → Unauthenticated. Marketing page. No wallet needed.
/operator                → Operator dashboard (authority wallet)
/operator/onboard        → KYC credential issuance
/operator/yield          → Yield venue management
/operator/risk           → Circuit breaker config, limits, pause/unpause
/operator/governance     → Squads multisig panel
/compliance              → Compliance monitoring dashboard
/compliance/:id          → Single transfer investigation + decryption
/portfolio               → Investor portfolio view
/deposit                 → Deposit USDC with proof
/transfer                → Transfer shares with proof
/withdraw                → Withdraw with proof or emergency hatch
```

### Task 3: Build the landing page

This is the MOST IMPORTANT page — it's what judges see first.

Design inspired by anchorage.com:
- **Hero:** Large headline (48-56px Inter 600): "Compliant institutional vaults with confidential identity."
- **Subheadline:** (18px Inter 400, text-secondary): "Zero-knowledge proofs verify KYC, accreditation, source of funds, and Travel Rule compliance — without revealing identity on-chain."
- **CTAs:** [Connect Wallet] primary button + [View Architecture →] ghost button
- **Live vault stats:** Read-only from on-chain (no wallet needed). Cards showing: TVL, Share Price, Transfers, Credentials, Tree Depth
- **Feature cards:** Three cards: ZK Compliance, Risk Controls, Institutional Governance — each with icon, title, 2-line description
- **Architecture section:** How it works — simplified flow diagram or feature breakdown
- **Track 1 mapping:** Show which hackathon requirements are covered

**Design principles:**
- Near-black background (#0A0B0E)
- Massive whitespace — nothing cramped
- Minimal nav: just "VaultProof" logo + [Connect Wallet]
- No electric teal. No flashy gradients. Confidence through typography.
- Card-based sections with subtle borders (#1E2028), no drop shadows

### Task 4: Build operator dashboard

**`/operator` — Vault Overview:**
- TVL, share price, share price history (computed from TransferRecord timestamps)
- Inflow/outflow by period (from TransferRecords)
- Circuit breaker status: visual bar showing daily outflow vs threshold (with color coding: green < 50%, yellow 50-80%, red > 80%)
- Registry health: active credentials vs revoked, tree capacity
- Yield performance: total yield earned, current venue, yield rate

**`/operator/onboard` — KYC Credential Issuance:**
- Form fields: Full Name, Nationality (dropdown), Date of Birth, Jurisdiction, Accreditation Tier (retail/accredited/institutional), Credential Expiry
- NEW fields: Source of Funds Reference (text input, e.g., "Wire transfer from UBS, verified 2026-03-01"), Credential Version (default 1, readonly)
- Investor Wallet Address input
- "Issue Credential" button → computes hashes, signs with issuer key, submits to registry, generates downloadable credential JSON

Credential issuance logic:
```typescript
async function issueCredential() {
    // 1. Hash source-of-funds reference
    const sofHash = poseidon([textToField(form.sourceOfFundsReference)]);

    // 2. Build credential hash chain (NEW 4-input Poseidon)
    const credHash1 = poseidon([name, nationality]);
    const credHash2 = poseidon([dob, jurisdiction]);
    const credHash3 = poseidon([accreditation, expiry]);
    const credHash4 = poseidon([sofHash, credentialVersion]);  // NEW
    const credHashFinal = poseidon([credHash1, credHash2, credHash3, credHash4]);

    // 3. Sign with issuer key
    const signature = eddsa.signPoseidon(ISSUER_PRIVATE_KEY, credHashFinal);

    // 4. Compute leaf
    const leaf = poseidon([credHashFinal, identitySecret, walletPubkey]);

    // 5. Submit to registry
    await registryProgram.methods.addCredential(leafHash, proof, ...).rpc();

    // 6. Download credential file for investor
    downloadAsJSON(credentialFile, 'vaultproof-credential.json');
}
```

**`/operator/yield` — Yield Management:**
- List of WhitelistedYieldVenue accounts (from on-chain)
- Add/remove venue forms
- Current allocation vs liquid buffer
- Kamino status indicator (connected/demo mode)
- Accrue yield button (manual trigger for demo)

**`/operator/risk` — Risk Controls:**
- Current limits display (circuit breaker threshold, max single tx, max deposit, max daily txs)
- Edit limits form (calls `update_risk_limits`)
- Pause/unpause toggle (calls `unpause_vault`)
- Current circuit breaker status: daily outflow total, window start, proximity to trigger

### Task 5: Build compliance monitoring

**`/compliance` — Monitoring Dashboard:**
- Transfer record explorer: sortable/filterable table of ALL TransferRecords
- Columns: Type (Deposit/Transfer/Withdrawal), Amount, Timestamp, Signer (truncated), Proof Hash (truncated), Decryption Status (badge: Authorized/Pending)
- Click any row → navigate to `/compliance/:id`
- Alert banner at top when alerts are active

**Alert system** (client-side, computed from on-chain data):
```typescript
function useMonitoring() {
    const { data: vault } = useVaultState();
    const { records } = useTransferRecords();

    const alerts = useMemo(() => {
        const alerts = [];
        // Circuit breaker approaching (>80%)
        const cbUsage = vault.dailyOutflowTotal / vault.circuitBreakerThreshold;
        if (cbUsage > 0.8) alerts.push({ severity: 'warning', message: `Circuit breaker at ${(cbUsage*100).toFixed(0)}% capacity` });

        // Large transaction (>10% of TVL)
        const recentRecords = records.filter(r => Date.now()/1000 - r.timestamp < 86400);
        const maxTx = Math.max(...recentRecords.map(r => r.amount), 0);
        if (maxTx > vault.totalAssets * 0.1) alerts.push({ severity: 'warning', message: `Large transaction: ${formatUSDC(maxTx)}` });

        // Velocity spike
        if (recentRecords.length > vault.maxDailyTransactions * 0.8) alerts.push({ severity: 'info', message: 'High transaction velocity' });

        return alerts;
    }, [vault, records]);

    return { vault, records, alerts };
}
```

**`/compliance/:id` — Transfer Investigation:**
- Full transfer detail: amount, type, timestamp, signer, merkle root snapshot, proof hash
- Encrypted metadata display (hex)
- Decryption status with visual indicator
- "Request Decryption" button → initiates Squads multisig flow (or direct authority call if Squads is client-side)
- Source-of-funds indicator (shows whether credential included SoF verification)

### Task 6: Build investor views

**`/portfolio` — Investor Dashboard:**
- Your shares (balance of share token)
- Your proportional USDC claim (shares × share price)
- Deposit history (your TransferRecords filtered by signer + type=Deposit)
- Yield earned (calculated from share price appreciation since first deposit)

**`/deposit` — Deposit Page:**
- Amount input (USDC)
- Credential file upload (or load from localStorage)
- Proof generation with progress indicator (subtle, not flashy — e.g., "Generating proof... 6s")
- Transaction confirmation
- Share mint confirmation

**`/transfer` — Transfer Page:**
- Same pattern as deposit but for share transfers
- Recipient address input

**`/withdraw` — Withdraw Page:**
- Shares to burn input
- Expected USDC output display
- Proof generation
- Emergency withdrawal option (timelock path)

### Task 7: Update proof generation for new credential fields

Update `app/src/lib/credential.ts`:
- Add `sourceOfFundsHash` and `credentialVersion` to `StoredCredential` type
- Update `prepareStoredCredential` to use 4-input Poseidon hash chain:
  ```
  credHash4 = poseidon([sourceOfFundsHash, credentialVersion])
  credHashFinal = poseidon([credHash1, credHash2, credHash3, credHash4])
  ```

Update `app/src/hooks/useProofGeneration.ts`:
- Add `sourceOfFundsHash` and `credentialVersion` to circuit input building
- These are private inputs — they go into the witness, not public inputs

Update `app/src/lib/proof.ts`:
- Ensure `buildCircuitInput()` includes both new fields

### Task 8: Update circuit artifact paths

Ensure the frontend loads the correct WASM and zkey files:
- `app/public/circuits/compliance.wasm` (from Agent 1)
- `app/public/circuits/compliance_final.zkey` (from Agent 1)

Until Agent 1 delivers, the current artifacts work structurally (just won't include new fields).

### Task 9: Write frontend tests

8+ tests:
1. Landing page renders without wallet connection — shows hero, stats, CTAs
2. Wallet detection routes authority to operator layout
3. Wallet detection routes non-authority to investor layout
4. `useVaultState` hook returns correct data structure (mock RPC)
5. `useMonitoring` computes alerts correctly (circuit breaker threshold test)
6. Credential issuance form validates required fields (including source of funds)
7. Proof generation includes `sourceOfFundsHash` and `credentialVersion` in circuit input
8. Circuit breaker status bar displays correct percentage and color

### Task 10: Build and verify

```bash
cd app
npm run build  # must succeed with no TypeScript errors
npm test       # all tests pass
npm run dev    # visual smoke test
```

---

## CURRENT STATE OF THE CODE

`app/src/` has:
- **Pages (7):** Home, Credential, Deposit, Transfer, Withdraw, Dashboard, Compliance
- **Components:** Navbar, PageContainer, ProofGenerationModal
- **Hooks:** useCredential, useProofGeneration, useRegistryState, useTransferRecords, useVaultState
- **Lib:** config, credential, crypto, elgamal, format, merkle, program, proof, readClient, stealth, types
- **Tests (8):** smoke, lib, hooks, merkle, program, stealth, transaction-pages
- **Routing:** BrowserRouter with flat routes (/, /credential, /deposit, /transfer, /withdraw, /dashboard, /compliance)
- **Wallet:** solana/wallet-adapter-react with devnet endpoint
- **Stack:** React 19.2.4, Vite 8.0.0, TypeScript

The current design uses basic CSS — NOT Tailwind. The revamp replaces everything with Tailwind v4 + shadcn/ui + Anchorage-inspired dark theme.

## FILE OWNERSHIP

```
app/                    ← EVERYTHING IN THIS DIRECTORY
```

## WHAT NOT TO DO
- Do NOT modify any files in `programs/` (Agents 2, 3, 4)
- Do NOT modify any files in `circuits/` (Agent 1)
- Do NOT modify any files in `tests/` or `scripts/` (Agent 4)
- Do NOT use electric teal or flashy colors — the design language is restrained monochrome
- Do NOT use drop shadows — use subtle borders (#1E2028) instead
- Do NOT add unnecessary animations — smooth 200-300ms transitions only

## DESIGN REFERENCE

**Color palette:**
- Background: #0A0B0E (near-black)
- Surface: #12131A (cards, panels)
- Border: #1E2028 (subtle dividers)
- Text: #FFFFFF primary, #8B8D97 secondary, #52535A tertiary
- Accent: #3B82F6 (blue, used SPARINGLY — CTAs, active states only)
- Success: #22C55E, Warning: #F59E0B, Danger: #EF4444

**Typography:**
- Headlines: Inter 600, 48-64px hero, 32-40px sections
- Body: Inter 400, 16px
- Labels: Inter 500, 12-13px, uppercase, letter-spacing 0.05em
- Mono: JetBrains Mono 14px for addresses, hashes, amounts

**Layout principles:**
- Massive whitespace
- Card-based with subtle borders
- Data-dense but clean dashboards (Bloomberg stripped of clutter)
- Large confident headlines — the type does the work, not icons

## DONE CRITERIA
- [ ] Tailwind v4 + design system configured
- [ ] shadcn/ui components set up (dark theme)
- [ ] Landing page complete — hero, live stats, feature cards, architecture
- [ ] Wallet-based routing working (authority → operator, else → investor)
- [ ] Operator dashboard: vault overview with circuit breaker status
- [ ] Operator onboarding: credential issuance with source-of-funds field
- [ ] Operator yield management page
- [ ] Operator risk controls page
- [ ] Compliance monitoring: transfer explorer with alerts
- [ ] Compliance investigation: single transfer detail + decryption request
- [ ] Investor portfolio view
- [ ] Investor deposit/transfer/withdraw pages with proof generation
- [ ] Proof generation updated with `sourceOfFundsHash` + `credentialVersion`
- [ ] `useMonitoring` hook with client-side alerting
- [ ] 8+ frontend tests passing
- [ ] `npm run build` succeeds
- [ ] `REVAMP-COORDINATION.md` updated with all changes
