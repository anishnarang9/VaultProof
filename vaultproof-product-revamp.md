# VAULTPROOF — PRODUCT REVAMP
## StableHacks 2026 · Track 1: Institutional Permissioned DeFi Vaults
## Product Decisions Document — All 13 Decisions Locked

---

# EXECUTIVE SUMMARY

VaultProof is being revamped from a ZK compliance engine attached to a skeleton vault into a **complete institutional vault product** that maps to every requirement in the Track 1 description. The core ZK compliance layer (circuit, on-chain verification, Travel Rule encryption) remains the differentiator. The revamp adds: compliant yield governance with `accrue_yield` admin instruction (Kamino CPI dropped — Anchor version conflict), custody provider abstraction for Fireblocks, source-of-funds attestation inside the ZK proof, full circuit breaker with concentration and velocity limits, a compliance monitoring dashboard with alerts, Squads Protocol multisig governance (client-side `@sqds/multisig` TS SDK — on-chain CPI dropped due to Anchor version conflict), operator-issued credentials, and an Anchorage-inspired institutional frontend with login-gated role separation.

This document covers **what** we're building and **why**. See `vaultproof-technical-bible.md` for **how** and `agent-coordination-update-v2.md` for live status.

> **⚠️ INTEGRATION STATUS UPDATE (2026-03-16):** All three external Rust crate integrations (Light Protocol, Squads CPI, Kamino CPI) are confirmed incompatible with our Anchor 0.32.1 workspace. Each has a working fallback. The judge-facing product is identical — only WHERE integration code runs changed (TypeScript vs Rust), not WHAT the user sees. See Decision 13 (Light), Decision 6 (Squads), Decision 1 (Yield) for updated details.

---

# TRACK 1 REQUIREMENT MAPPING

Every explicit requirement from the hackathon description is mapped to a specific VaultProof feature.

| Track 1 Requirement | VaultProof Feature | Status |
|---|---|---|
| "Smart-contract-based system that automates how deposited digital assets are managed" | Anchor vault program with share-based accounting, proof-gated deposits/transfers/withdrawals | ✅ Already built |
| "invested" | Whitelisted yield venue governance + live Kamino adapter integration | 🔧 NEW |
| "protected" | Circuit breaker with rolling 24h outflow limit, concentration limits, velocity checks, emergency 72h timelock | 🔧 NEW enforcement |
| "returned to the user" | Withdrawal burns shares at current share price, returns proportional USDC | ✅ Already built |
| "regulated institution under governance of financial market regulator" | Squads Protocol multisig governance — all admin operations require M-of-N approval | 🔧 NEW |
| "vault participants must be known (KYC)" | ZK proof of KYC credential required for every vault operation; credential issued by institution operator | ✅ Core differentiator |
| "transactions must identify participants (KYT, Travel Rule)" | ElGamal-encrypted Travel Rule metadata in every TransferRecord, proven correct inside ZK circuit | ✅ Core differentiator |
| "prove source of coins on regulator demand" | source_of_funds_hash baked into credential + credential_version field; ZK proof proves source verification without revealing it on-chain | 🔧 NEW circuit change |
| "yield source shall be compliant with local regulations" | WhitelistedYieldVenue PDAs with jurisdiction restrictions, authority-gated venue approval | 🔧 NEW |
| "integration with institutional-grade custody solutions (e.g., Fireblocks)" | CustodyProvider enum abstraction (SelfCustody / Fireblocks / BitGo / Anchorage) with separated custody_authority | 🔧 NEW |
| "funds monitoring and risk controls" | Compliance monitoring dashboard with real-time vault health, transfer investigation, alerts for suspicious patterns, circuit breaker status | 🔧 NEW |
| "strict non-commingling of client funds" (Example 1) | Share-based accounting segregation — each investor's shares = segregated proportional claim on vault assets; per-investor position view in frontend | 🔧 Better framing |

---

# ALL 13 PRODUCT DECISIONS

## Decision 1: Yield Strategy
**Choice:** Simulated yield with full governance architecture — `accrue_yield` admin instruction

> **UPDATED:** Kamino CPI confirmed incompatible with Anchor 0.32.1. Do NOT attempt `kamino-lending` import. Using `accrue_yield` admin instruction as the sole yield mechanism.

The vault implements a complete yield governance framework:
- WhitelistedYieldVenue PDA for each approved venue (stores: venue address, jurisdiction whitelist, allocation cap, risk rating, active flag)
- Authority (via Squads multisig) can add/remove/pause yield venues
- `accrue_yield` admin instruction credits yield to the vault, updating total_assets and share price
- `liquid_buffer_bps` field controls what % of USDC stays liquid for withdrawals (e.g., 2000 = 20%)
- Kamino CPI is documented as a production migration path but NOT implemented (Anchor version conflict)
- Frontend labels yield as "Kamino Adapter (Demo Mode)" to show the integration architecture

**Why:** Judges want to see yield governance architecture (who approves venues? what jurisdiction restrictions apply?), not a yield aggregator. The `accrue_yield` instruction demonstrates the accounting model. The WhitelistedYieldVenue PDAs demonstrate the governance framework.

## Decision 2: Custody Integration
**Choice:** Custody provider abstraction layer

VaultState gains:
- `custody_provider: CustodyProvider` enum — `SelfCustody`, `Fireblocks`, `BitGo`, `Anchorage`
- `custody_authority: Pubkey` — separate from the admin authority
- For SelfCustody: custody_authority = PDA (current behavior, unchanged)
- For Fireblocks: custody_authority would be the Fireblocks-controlled Solana address
- All fund movements (USDC transfers in/out of reserve) require custody_authority signature
- ADR documenting the Fireblocks integration path (MPC-controlled keypair replaces PDA authority)

**Why:** The hackathon explicitly names Fireblocks. The abstraction layer is visible in the account struct — a judge reading VaultState immediately sees the custody integration point. The enum signals "we designed for multiple custody providers, not just Fireblocks."

## Decision 3: Source of Funds
**Choice:** Extended credential with source_of_funds_hash + credential_version field in ZK circuit

Circuit changes:
- New private input: `sourceOfFundsHash` — a Poseidon hash of the source-of-funds attestation from the issuer
- New private input: `credentialVersion` — version number for credential format evolution
- Both fields added to the credential hashing chain (nested Poseidon)
- The issuer (AMINA) verifies source of funds during KYC, computes the attestation hash, and includes it when signing the credential
- The ZK proof proves: "this person's source of funds was verified by AMINA" without revealing WHAT the source was
- Impact: ~500 additional constraints (two more Poseidon hashes), negligible proof time increase

**Why:** This is the most differentiated feature in the entire submission. No other hackathon entry will have source-of-funds verification inside a ZK proof. The credential_version field future-proofs the credential format — different versions can have different field sets without breaking old proofs.

## Decision 4: Risk Controls
**Choice:** Full circuit breaker + concentration limits + velocity checks

New VaultState fields and enforcement:
- `daily_outflow_total: u64` — rolling 24h outflow accumulator
- `outflow_window_start: i64` — timestamp when current 24h window started
- `circuit_breaker_threshold: u64` — max 24h outflow before auto-pause
- `paused: bool` — when true, ALL vault operations blocked
- `max_single_transaction: u64` — max amount per single deposit/transfer/withdrawal
- `max_single_deposit: u64` — prevents whale concentration
- `max_daily_transactions: u32` — velocity limit (catches automated drain attacks)
- `daily_transaction_count: u32` — rolling 24h transaction counter

Enforcement in every instruction:
1. Check `paused` flag — reject if true
2. Check single-transaction limit
3. For deposits: check concentration limit
4. For withdrawals: add to daily outflow, check circuit breaker threshold
5. Increment daily transaction count, check velocity limit
6. If circuit breaker triggers: set `paused = true`, emit `CircuitBreakerTriggered` event
7. Authority must call `unpause_vault` to resume after investigation

New admin instructions:
- `update_risk_limits` — set thresholds (via Squads multisig)
- `unpause_vault` — resume operations after circuit breaker (via Squads multisig)

**Why:** This is table-stakes for institutional. Without it, a judge can say "anyone with a valid proof can drain the vault in one block." The velocity checks catch automated attacks. The concentration limits prevent whale manipulation. The auto-pause removes human reaction time from the equation.

## Decision 5: Fund Monitoring
**Choice:** Enhanced compliance dashboard + client-side alerting

The existing Dashboard and Compliance pages are upgraded into a proper institutional monitoring view:

**Dashboard (Operator View):**
- Vault health: TVL, share price, share price history (from TransferRecord timestamps), inflow/outflow by period
- Registry health: active credentials vs revoked, tree capacity utilization
- Circuit breaker status: current daily outflow vs threshold, visual bar showing proximity to trigger
- Yield performance: total yield earned, current venue allocation, yield rate

**Compliance View (Compliance Officer):**
- Transfer record explorer: sortable/filterable table of all TransferRecords
- Per-transfer detail: click to inspect any transfer — amount, timestamp, type, signer, merkle root snapshot, decryption status
- Decryption request: button to initiate decryption authorization (triggers Squads multisig flow)
- Source-of-funds indicator: shows whether the credential used for this transfer included source verification

**Alert System:**
- Client-side alerts computed from TransferRecord data
- Alert triggers: transaction exceeds X% of vault TVL, outflow spike (>2x average daily outflow), circuit breaker approaching threshold (>80%), unusual velocity (transaction count spike)
- Alert banner appears at top of dashboard when triggered
- Alert history log

**Why:** The data already exists on-chain in TransferRecords and VaultState. The gap is purely presentation. The alerting system is the demo moment — "watch, when I submit this large withdrawal, the monitoring dashboard flags it automatically."

## Decision 6: Governance
**Choice:** Squads Protocol — CLIENT-SIDE `@sqds/multisig` TS SDK (not on-chain CPI)

> **UPDATED:** Squads on-chain CPI (`squads-multisig` Rust crate) confirmed incompatible with Anchor 0.32.1 (pinned to 0.29.0). Using client-side `@sqds/multisig` TypeScript SDK instead. Zero program changes needed — the vault's existing `has_one = authority` constraint works with Squads automatically when authority = Squads vault PDA.

All admin operations go through Squads multisig:
- Vault initialization sets `authority` to the Squads multisig vault PDA
- The `@sqds/multisig` TS SDK handles propose → approve → execute in the frontend and scripts
- When Squads executes a transaction, it signs as the vault PDA, which satisfies `has_one = authority`
- Threshold updates, regulator key changes, timelock changes, yield venue management, circuit breaker unpause, decryption authorization — all flow through multisig approval in the UI
- Demo flow: propose threshold change → second signer approves → change executes

**Why:** The judge experience is identical. They still see multisig approval in the UI. The implementation difference (TypeScript SDK vs Rust CPI) is invisible to the judge.

## Decision 7: Role-Based UI
**Choice:** Login-gated two-mode UI

Three states:
1. **Unauthenticated (landing page):** Beautiful marketing surface. Product story, architecture overview, live vault stats (read-only from on-chain). No wallet connection required. This is what judges see first.
2. **Institution mode (operator + compliance):** After connecting an authority wallet (Squads member), the app routes to the institutional dashboard. Sections: vault overview, KYC onboarding panel, yield management, risk controls, compliance monitoring, decryption authorization.
3. **Investor mode:** After connecting a non-authority wallet, the app routes to the investor dashboard. Sections: portfolio view (your shares, proportional USDC claim, deposit/yield history), deposit, transfer, withdraw.

Routing logic: connect wallet → check if wallet is the vault authority or a Squads multisig member → route accordingly. If the vault isn't initialized yet, show an initialization flow.

**Why:** Institutional SaaS products have distinct experiences for different users. Bloomberg has separate views for traders vs compliance vs ops. The landing page is the most important visual surface — it's what judges see first, before connecting a wallet.

## Decision 8: Demo Narrative
**Choice:** Regulator investigation story

**Scene 1 — The Setup (30s):**
"AMINA Bank, a FINMA-regulated Swiss crypto bank, operates a compliant institutional vault on Solana using VaultProof."
Show: Landing page. Live vault stats. Connect as operator.

**Scene 2 — Investor Onboarding (45s):**
"A qualified investor applies for vault access. AMINA's compliance team verifies their identity AND source of funds."
Show: Operator KYC onboarding panel. Enter investor details + source-of-funds reference. Issue credential. Credential added to on-chain registry.

**Scene 3 — The Deposit (45s):**
"The investor deposits $50,000 USDC. Watch the ZK proof verify their identity, accreditation, source of funds, and AML compliance — in 6 seconds, without revealing any personal data on-chain."
Show: Switch to investor wallet. Deposit page. Proof generation with real snarkjs. Shares minted. TransferRecord created with encrypted metadata.

**Scene 4 — Risk Controls in Action (30s):**
"Meanwhile, a suspicious large withdrawal triggers the circuit breaker."
Show: Submit withdrawal that exceeds daily outflow threshold. Circuit breaker triggers. Dashboard shows alert. Vault auto-pauses.

**Scene 5 — The Investigation (45s):**
"Six months later, FINMA asks about the original deposit. The compliance officer uses the monitoring dashboard."
Show: Compliance view. Find the transfer record. Click to inspect. Initiate decryption via Squads multisig. Second signer approves. Travel Rule metadata + source-of-funds attestation revealed.

**Scene 6 — The Architecture (15s):**
"All of this runs on Solana with Groth16 ZK proofs, a depth-20 Poseidon Merkle tree, ElGamal trapdoor encryption, share-based fund accounting, and Squads multisig governance."
Show: Architecture diagram or technical summary screen.

**Total: ~3 minutes 30 seconds**

**Why:** This story hits every single Track 1 requirement in one narrative arc. KYC ✓, KYT/Travel Rule ✓, source of funds ✓, yield (mentioned) ✓, custody architecture (mentioned) ✓, monitoring ✓, risk controls ✓, governance ✓, non-commingling (share model shown) ✓.

## Decision 9: Non-Commingling
**Choice:** Share-based accounting segregation, better framed

No architectural change — the current share model IS accounting segregation. Changes:
- Per-investor position view in the frontend: your shares, your proportional USDC claim, your deposit history, your yield earned
- Documentation explaining how share-based accounting achieves non-commingling: "Each investor's vault shares represent a segregated proportional claim on vault assets. This is identical to how ETFs, mutual funds, and tokenized treasuries (e.g., BlackRock BUIDL) achieve accounting segregation while enabling efficient capital deployment."
- README section explicitly mapping non-commingling to the share model

**Why:** This is how real institutional funds work. BlackRock BUIDL pools assets and issues shares. Vanguard pools and issues shares. The share model is the standard. Building per-investor segregated accounts would be architecturally interesting but would break the yield story (can't efficiently allocate segregated accounts to lending protocols).

## Decision 10: KYC Credential Flow
**Choice:** Operator-issues-credential

Institution dashboard has a "KYC Onboarding" panel:
1. Operator enters investor details: name (hashed), nationality, DOB, jurisdiction, accreditation tier
2. Operator enters source-of-funds attestation reference (e.g., "Wire transfer from UBS account, verified 2026-03-01")
3. System computes sourceOfFundsHash = Poseidon(attestation reference)
4. System computes credential hash with all fields including source hash and credential version
5. System signs the credential hash with the issuer's EdDSA key (demo: hardcoded issuer key)
6. System submits `add_credential` to the KYC Registry — leaf hash added to Merkle tree
7. Investor downloads their credential file (contains all private fields + signature + Merkle proof data)

In the demo, the operator wallet is an AMINA Bank representative. The investor wallet is a separate keypair. This shows the REAL institutional flow — the bank issues credentials, not the user.

**Why:** This maps directly to the demo narrative (Scene 2). It shows judges the institutional KYC flow — compliance team verifies, then issues. The source-of-funds field enters naturally during this step.

## Decision 11: Frontend Design
**Choice:** Anchorage-inspired institutional design

Design language extracted from anchorage.com:
- **Color:** Near-black backgrounds (#0A0B0E), white text (#FFFFFF / #F5F5F7), color used extremely sparingly — one subtle accent for interactive elements
- **Typography:** Large confident headlines (48-64px hero), clean sans-serif (Inter or SF Pro Display), generous line-height, letter-spacing on labels
- **Layout:** Massive whitespace, nothing cramped, asymmetric hero grid, card-based feature sections with minimal icons
- **Visual language:** Monochrome with restraint. No electric teal everywhere. Confidence comes from typography and whitespace, not color. Subtle gradient accents on key CTAs only
- **Illustrations:** Abstract SVG line art for architecture diagrams and feature sections, not photos
- **Animations:** Smooth, restrained transitions. Proof generation gets a subtle progress indicator, not a flashy glowing ring
- **Dashboard (post-login):** Data-dense but clean. Dark background, muted borders, clear hierarchy. Think Bloomberg Terminal stripped of clutter

This replaces the earlier "Institutional Noir" direction. The key shift: less color, more restraint, bigger type, more whitespace.

**Why:** Anchorage.com is the gold standard for institutional crypto design. Their design communicates trust, scale, and regulatory seriousness through restraint. Judges will subconsciously compare your UI against institutional products they've seen. If your frontend looks like anchorage.com, it reads as "real product." If it looks like a crypto hackathon project, it reads as "student project."

## Decision 12: Circuit Changes (Source of Funds + Version)
**Choice:** Add both source_of_funds_hash and credential_version to circuit

Full circuit recompile now includes 5 changes (was 3 from the fix addendum):
1. AML thresholds as public inputs (from fix addendum)
2. Wallet pubkey in credential hash (from fix addendum)
3. Tree depth 10→20 (from fix addendum)
4. **NEW:** sourceOfFundsHash added to credential fields
5. **NEW:** credentialVersion added to credential fields

Updated credential hashing chain:
```
credHash1 = Poseidon(name, nationality)
credHash2 = Poseidon(dateOfBirth, jurisdiction)
credHash3 = Poseidon(accreditationStatus, credentialExpiry)
credHash4 = Poseidon(sourceOfFundsHash, credentialVersion)  ← NEW
credHashFinal = Poseidon(credHash1, credHash2, credHash3, credHash4)  ← was Poseidon(3), now Poseidon(4)
leaf = Poseidon(credHashFinal, identitySecret, walletPubkey)
```

New private inputs: `sourceOfFundsHash`, `credentialVersion`
No new public inputs (both stay in the witness — private by default).

Estimated total constraints: ~41,000 (up from ~40,300 with just the fix addendum changes)
Proof time: ~6-9 seconds (unchanged meaningfully)
Still fits pot16.

## Decision 13: Light Protocol for Merkle Tree
**Choice:** FALLBACK — Keeping existing PDA Merkle tree (Light Protocol incompatible)

> **UPDATED:** `light-sdk 0.11.0` is incompatible with Anchor 0.32.1 (hard-pins `anchor-lang = 0.29.0` / `solana-program = 1.18.22`). The existing PDA-based Merkle tree with on-chain Poseidon hashing is kept. Light Protocol is documented as a production migration path.

Current implementation (WORKING — 16 tests passing):
- PDA-based `KycRegistry` + `StateTree` + `CredentialLeaf` accounts
- On-chain Poseidon Merkle tree with `solana_poseidon` (`Bn254X5, BigEndian`)
- Depth 20 (1,048,576 credential capacity)
- `KycRegistryConfig` type alias exported for CPI consumers
- Roots are natively compatible with the Circom circuit (same Poseidon parameters)

---

# UPDATED PRODUCT NARRATIVE

## One-liner
**VaultProof: Compliant institutional vaults with confidential identity on Solana.**

## Elevator pitch (30 seconds)
VaultProof is confidential compliance infrastructure for institutional DeFi vaults. Every vault deposit, transfer, and withdrawal carries a zero-knowledge proof that verifies the participant's KYC status, accreditation tier, source of funds, and AML compliance — without revealing any personal data on-chain. Travel Rule metadata is encrypted inside the proof for authorized compliance review. The vault features share-based accounting, compliant yield governance, Fireblocks-compatible custody architecture, multisig governance via Squads Protocol, and automated risk controls with circuit breakers.

## What makes VaultProof different
1. **Source of funds in the ZK proof.** No other project proves source-of-funds verification inside a zero-knowledge proof. The credential hash includes a source attestation from the issuer. The proof proves it was verified without revealing what the source was.
2. **Travel Rule encryption inside the circuit.** ElGamal encryption is computed inside the Groth16 circuit, not as a separate off-chain step. The sender cannot lie about what they encrypted. The regulator gets guaranteed-correct metadata.
3. **Complete institutional product, not just a compliance layer.** Yield governance, custody abstraction, circuit breakers, Squads multisig, compliance monitoring with alerts, role-based UI — everything a regulated institution needs to operate a vault.

---

# UPDATED VAULTSTATE ACCOUNT (CONCEPTUAL)

This is the conceptual shape after all revamp decisions. Exact field types and ordering will be finalized in the technical document.

```
VaultState {
    // Authority & governance
    authority: Pubkey,              // Squads multisig address
    
    // Custody
    custody_provider: CustodyProvider,  // SelfCustody | Fireblocks | BitGo | Anchorage
    custody_authority: Pubkey,          // Separate from admin authority
    
    // Token accounting
    usdc_mint: Pubkey,
    share_mint: Pubkey,
    usdc_reserve: Pubkey,
    total_assets: u64,
    total_shares: u64,
    share_price_numerator: u64,
    share_price_denominator: u64,
    
    // Compliance config
    aml_thresholds: [u64; 3],       // [retail, accredited, institutional]
    expired_threshold: u64,
    regulator_pubkey_x: [u8; 32],
    regulator_pubkey_y: [u8; 32],
    
    // Registry reference
    kyc_registry: Pubkey,
    state_tree: Pubkey,             // Light Protocol state tree
    
    // Risk controls
    paused: bool,
    emergency_timelock: i64,                // 72 hours
    circuit_breaker_threshold: u64,         // Max 24h outflow
    daily_outflow_total: u64,
    outflow_window_start: i64,
    max_single_transaction: u64,
    max_single_deposit: u64,
    max_daily_transactions: u32,
    daily_transaction_count: u32,
    
    // Yield config
    yield_source: Pubkey,           // Current active yield venue
    liquid_buffer_bps: u16,
    total_yield_earned: u64,
    
    // Metadata
    bump: u8,
    reserve_bump: u8,
}

enum CustodyProvider {
    SelfCustody,
    Fireblocks,
    BitGo,
    Anchorage,
}
```

---

# UPDATED CREDENTIAL FORMAT

After circuit changes, the credential contains:

```
Credential {
    // Identity (all private — never on-chain)
    name: field,                    // Poseidon hash of full name
    nationality: field,             // ISO 3166-1 numeric code
    dateOfBirth: field,             // Unix timestamp
    jurisdiction: field,            // Jurisdiction code
    accreditationStatus: field,     // 0=retail, 1=accredited, 2=institutional
    credentialExpiry: field,        // Unix timestamp
    
    // NEW — Source of funds
    sourceOfFundsHash: field,       // Poseidon hash of source attestation
    credentialVersion: field,       // Version number (1 for current format)
    
    // Binding
    identitySecret: field,          // Random secret
    walletPubkey: field,            // Bound to specific wallet
    
    // Issuer signature
    issuerSigR8x: field,
    issuerSigR8y: field,
    issuerSigS: field,
}
```

---

# FRONTEND ARCHITECTURE

## Page Structure

### Unauthenticated (Landing Page)
```
/                   Landing page — product story, live vault stats, architecture overview
```

### Institution Mode (authority wallet detected)
```
/operator           Operator dashboard — vault overview, TVL, share price, yield stats
/operator/onboard   KYC onboarding panel — issue credentials
/operator/yield     Yield management — venue whitelist, allocation, Kamino status
/operator/risk      Risk controls — circuit breaker config, limits, pause/unpause
/compliance         Compliance monitoring — transfer explorer, alerts, decryption requests
/compliance/:id     Transfer detail — inspect single transfer, initiate decryption
```

### Investor Mode (non-authority wallet)
```
/portfolio          Portfolio view — your shares, USDC claim, deposit history, yield earned
/deposit            Deposit USDC — proof generation, share minting
/transfer           Transfer shares — proof generation, stealth-to-stealth
/withdraw           Withdraw USDC — proof generation, share burning, or emergency hatch
```

## Design System (Anchorage-Inspired)

### Color Palette
```
Background:     #0A0B0E (near-black)
Surface:        #12131A (cards, panels)
Border:         #1E2028 (subtle dividers)
Text Primary:   #FFFFFF
Text Secondary: #8B8D97 (labels, captions)
Text Tertiary:  #52535A (disabled, hints)
Accent:         One single accent color, used sparingly — for CTAs, active states, proof animations
Success:        #22C55E (green — verified states)
Warning:        #F59E0B (amber — alerts, approaching limits)
Danger:         #EF4444 (red — circuit breaker, errors)
```

### Typography
```
Headlines:      Inter / SF Pro Display, 600 weight, 48-64px hero, 32-40px section headers
Body:           Inter, 400 weight, 16px
Labels:         Inter, 500 weight, 12-13px, uppercase, letter-spacing 0.05em
Mono (data):    JetBrains Mono / IBM Plex Mono, 14px (addresses, hashes, amounts)
```

### Principles
- Massive whitespace — nothing cramped
- Color through restraint — monochrome by default, accent only for interactive elements
- Large confident typography — the headline does the work, not the icons
- Card-based layouts with subtle borders, no drop shadows
- Data tables: clean, minimal borders, alternating row shading only if needed
- Animations: smooth 200-300ms transitions, no flashy effects

---

# BUILD PRIORITY — WHAT TO POLISH vs WHAT TO LEAVE ROUGH

The demo narrative determines priority. Features that appear in the demo get polished. Everything else needs to work but doesn't need to look perfect.

### MUST BE POLISHED (appears in demo)
1. Landing page — first thing judges see
2. Operator KYC onboarding panel — Scene 2
3. Investor deposit flow with proof generation — Scene 3
4. Circuit breaker triggering — Scene 4
5. Compliance monitoring + transfer investigation — Scene 5
6. Squads multisig decryption approval — Scene 5

### MUST WORK (functional but can be rough)
7. Yield management panel (mentioned, not deeply shown)
8. Transfer flow
9. Withdrawal flow (regular, non-emergency)
10. Per-investor portfolio view

### CAN BE DOCUMENTED ONLY
11. Fireblocks integration path (ADR only — CustodyProvider enum exists in code)
12. Multi-issuer support (production roadmap)
13. Off-chain credential storage (production roadmap)

---

# TECHNICAL REVAMP ITEMS (FOR NEXT DOCUMENT)

These are the items that need technical specification in the follow-up document:

1. **Light Protocol integration** — exact SDK usage, compressed account structure, CPI pattern for add/revoke, Photon indexer queries for Merkle proofs, migration from current PDA approach
2. **Circuit recompile** — all 5 changes (thresholds, wallet binding, depth 20, source-of-funds hash, credential version), updated public input ordering, trusted setup redo
3. **Squads Protocol integration** — SDK setup, multisig creation, proposal/approval flow for admin operations, account constraints
4. **Kamino adapter** — CPI to Kamino lending vault, deposit/withdraw idle USDC, yield accounting, devnet availability
5. **Circuit breaker enforcement** — exact rolling window logic, reset conditions, per-instruction enforcement code
6. **VaultState account changes** — final struct with all new fields, space calculation, migration from current layout
7. **Credential issuance flow** — operator-side EdDSA signing, credential file format, registry submission
8. **Frontend architecture** — component structure, routing logic, wallet detection, on-chain data hooks, design implementation
9. **Test updates** — circuit tests for new fields, program tests for risk controls, integration tests for Squads flow

---

# HACKATHON SCOPE vs PRODUCTION SCOPE (UPDATED)

| Component | Hackathon | Production |
|---|---|---|
| Tree storage | PDA Merkle tree (Light Protocol = production path) | Light Protocol ZK Compression |
| Tree capacity | 1,048,576 (depth 20) | Same or deeper |
| Credential storage | Browser localStorage | Encrypted vault / HSM / Fireblocks |
| Credential format | v1 with source-of-funds + version | Same, extensible via version field |
| Issuer model | Single issuer (AMINA) | Multi-issuer whitelist |
| Custody | SelfCustody (PDA) with CustodyProvider enum | Fireblocks MPC wallet |
| Governance | Squads via `@sqds/multisig` TS SDK (2-of-3 demo) | Squads on-chain CPI with formal policies |
| Yield source | `accrue_yield` admin instruction (Kamino CPI = production path) | Kamino / marginfi / Solstice (whitelisted) |
| Risk controls | Circuit breaker + concentration + velocity | Same + per-credential daily limits |
| Monitoring | Client-side dashboard + alerts | Server-side monitoring + real alerting pipeline |
| KYC validation | Operator-issued demo credentials | AMINA Bank real KYC pipeline |
| Proof generation | Browser WASM (~6-9s) | Browser WASM + optional managed proving |
| Network | Solana devnet | Solana mainnet |

---

# ADR INDEX (UPDATED)

| ADR | Topic | Status |
|---|---|---|
| ADR-001 | Trusted Authority for KYC Registry | Exists — no change |
| ADR-002 | Light Protocol for Merkle Tree Storage | Exists — will be updated in technical doc |
| ADR-003 | Tokenized Vault Shares Model | Exists — add non-commingling framing |
| ADR-004 | Browser-Based Proof Generation | Exists — no change |
| ADR-005 | ElGamal Trapdoor Inside Circuit | Exists — no change |
| ADR-006 | Wallet-Bound Credentials | Exists — no change |
| ADR-007 | Source-of-Funds Attestation in Credential | **NEW** |
| ADR-008 | Custody Provider Abstraction | **NEW** |
| ADR-009 | Squads Protocol Governance | **NEW** |
| ADR-010 | Compliant Yield Venue Framework | **NEW** |
| ADR-011 | Circuit Breaker and Risk Controls | **NEW** |

---

# END OF PRODUCT REVAMP DOCUMENT
