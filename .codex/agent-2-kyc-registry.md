# AGENT 2 — Round 2: Frontend Transaction Wiring + E2E

## Identity

You are Agent 2 working in `/Users/anishnarang/VaultProof`. Your Round 1 work (KYC registry rewrite with Light Protocol model) is DONE. Your Round 2 mission is to **wire the frontend to actually submit Solana transactions** and add browser-level e2e tests.

## CRITICAL: Read These Files First

1. `/Users/anishnarang/VaultProof/COORDINATION.md` — coordination center with interface contracts and interface changes from Round 1.
2. `/Users/anishnarang/VaultProof/vaultproof-fix-addendum.md` — the authoritative spec.
3. `/Users/anishnarang/VaultProof/app/src/` — the frontend Agent 3 built in Round 1. Study the existing hooks and libs.
4. `/Users/anishnarang/VaultProof/programs/vusd-vault/src/lib.rs` — the vault program (Agent 1 wrote this). You need to understand the instruction interfaces to build transactions.
5. `/Users/anishnarang/VaultProof/programs/kyc-registry/src/lib.rs` — the KYC program (you wrote this in Round 1). You know the interfaces.
6. `/Users/anishnarang/VaultProof/programs/compliance-admin/src/lib.rs` — the compliance program.

## Current Frontend State (What Agent 3 Delivered)

Agent 3 built a complete read-layer frontend:
- ✅ Router + WalletProvider + 7 pages (including Compliance)
- ✅ `useVaultState`, `useTransferRecords`, `useCredential`, `useRegistryState`, `useProofGeneration` hooks
- ✅ `app/src/lib/types.ts` — TypeScript account types matching Rust layouts
- ✅ `app/src/lib/elgamal.ts` — ElGamal encryption
- ✅ `app/src/lib/proof.ts` — Real snarkjs proof generation (22 public inputs)
- ✅ `app/src/lib/readClient.ts` — Read-only Anchor client
- ✅ `app/src/lib/credential.ts` — Credential helpers
- ✅ `app/src/lib/crypto.ts` — Crypto utilities
- ✅ 15 unit tests passing, build passes

What's MISSING (your job):
- ❌ `app/src/lib/program.ts` — Full read+write Anchor program client (readClient.ts is read-only)
- ❌ `app/src/lib/merkle.ts` — Merkle proof retrieval from on-chain state tree
- ❌ `app/src/lib/stealth.ts` — Stealth account derivation + management
- ❌ Transaction submission in pages — buttons click but don't send transactions
- ❌ Playwright e2e test baseline

## Your File Scope (HARD BOUNDARY)

You MAY touch:
- `app/src/lib/program.ts` (CREATE — full read+write Anchor program client)
- `app/src/lib/merkle.ts` (CREATE — Merkle proof retrieval)
- `app/src/lib/stealth.ts` (CREATE — stealth account derivation)
- `app/src/pages/Credential.tsx` (wire transaction submission)
- `app/src/pages/Deposit.tsx` (wire transaction submission)
- `app/src/pages/Transfer.tsx` (wire transaction submission)
- `app/src/pages/Withdraw.tsx` (wire transaction submission)
- `app/src/pages/Compliance.tsx` (wire decryption authorization)
- `app/src/hooks/useProofGeneration.ts` (extend if needed for tx submission)
- `app/src/test/` (add new test files)
- `app/playwright.config.ts` (CREATE)
- `app/e2e/` (CREATE — Playwright tests)
- `app/package.json` (add Playwright dep if missing)

You MUST NOT touch:
- `programs/**` (all programs are frozen)
- `circuits/**` (frozen)
- `tests/**` at root level (Agent 1 owns this in Round 2)
- `docs/**` (Agent 3 owns this in Round 2)
- `README.md` (Agent 3 owns this in Round 2)
- `app/src/lib/types.ts` (Agent 3 built this correctly — don't break it)
- `app/src/lib/elgamal.ts` (working — don't change)
- `app/src/lib/proof.ts` (working — don't change)
- `app/src/App.tsx` (working — don't change routing)
- `app/src/pages/Home.tsx` (no transactions needed)
- `app/src/pages/Dashboard.tsx` (read-only page — no transactions needed)

## Development Method: TEST-FIRST

1. Write a failing test for the behavior.
2. Run the test and confirm it fails.
3. Implement the minimum code.
4. Run the test and confirm it passes.
5. Run `cd app && npm run build` to confirm.
6. Update COORDINATION.md.

## Phase 1: Create Missing Library Modules

### `app/src/lib/program.ts` — Full Program Client

This is the write-capable Anchor client. `readClient.ts` already handles reads. This module adds transaction building and submission.

```typescript
// What this module must export:

// Program client initialization (with wallet signer)
export function getPrograms(connection: Connection, wallet: AnchorWallet): {
  kycRegistry: Program<KycRegistry>;
  vusdVault: Program<VusdVault>;
  complianceAdmin: Program<ComplianceAdmin>;
}

// Transaction builders for each instruction:
export async function buildDepositTx(params: {
  program: Program<VusdVault>;
  proofA: number[];
  proofB: number[];
  proofC: number[];
  publicInputs: number[][];
  amount: BN;
  encryptedMetadata: Buffer;
  signer: PublicKey;
}): Promise<Transaction>

export async function buildTransferTx(params: {
  program: Program<VusdVault>;
  proofA: number[];
  proofB: number[];
  proofC: number[];
  publicInputs: number[][];
  amount: BN;
  encryptedMetadata: Buffer;
  recipient: PublicKey;  // stealth address
  signer: PublicKey;
}): Promise<Transaction>

export async function buildWithdrawTx(params: {
  program: Program<VusdVault>;
  proofA: number[];
  proofB: number[];
  proofC: number[];
  publicInputs: number[][];
  shares: BN;
  signer: PublicKey;
}): Promise<Transaction>

export async function buildEmergencyWithdrawRequestTx(params: {
  program: Program<VusdVault>;
  stealthAccount: PublicKey;
  signer: PublicKey;
}): Promise<Transaction>

export async function buildEmergencyWithdrawExecuteTx(params: {
  program: Program<VusdVault>;
  stealthAccount: PublicKey;
  signer: PublicKey;
}): Promise<Transaction>

export async function buildAddCredentialTx(params: {
  program: Program<KycRegistry>;
  leafHash: number[];
  signer: PublicKey;
}): Promise<Transaction>

export async function buildAuthorizeDecryptionTx(params: {
  program: Program<ComplianceAdmin>;
  transferRecord: PublicKey;
  signer: PublicKey;
}): Promise<Transaction>
```

The IDL types may not exist in `target/types/` yet. Agent 3 already created a Borsh account coder shim in `readClient.ts`. Extend that approach or generate IDL from the built programs using `anchor idl build`.

### `app/src/lib/merkle.ts` — Merkle Proof Retrieval

```typescript
// Retrieves a Merkle proof for a credential leaf from on-chain state

export interface MerkleProof {
  pathElements: bigint[];   // 20 sibling hashes (depth-20 tree)
  pathIndices: number[];    // 20 left/right indicators
  root: bigint;             // current root
  leafIndex: number;        // leaf position
}

// For hackathon: build proof from on-chain CredentialLeaf PDAs
// For production: query Light Protocol's Photon indexer
export async function getCredentialMerkleProof(
  connection: Connection,
  registryPubkey: PublicKey,
  leafHash: bigint
): Promise<MerkleProof>

// Helper: fetch current root from StateTree PDA
export async function getCurrentMerkleRoot(
  connection: Connection,
  registryPubkey: PublicKey
): Promise<bigint>

// Helper: fetch all credential leaves from on-chain
export async function getAllCredentialLeaves(
  connection: Connection,
  registryPubkey: PublicKey
): Promise<{ hash: bigint; index: number }[]>
```

Note: The KYC registry uses a `StateTree` PDA at seeds `[b"state_tree", registry.key().as_ref()]` and per-leaf `CredentialLeaf` PDAs. Read the Interface Changes in COORDINATION.md for details.

### `app/src/lib/stealth.ts` — Stealth Account Derivation

```typescript
// Stealth account scheme for unlinkable deposits

export interface StealthKeyPair {
  scanKey: Uint8Array;      // private scan key
  spendKey: Uint8Array;     // private spend key
  scanPubKey: Uint8Array;   // public scan key (shared with senders)
  spendPubKey: Uint8Array;  // public spend key
}

export interface StealthAddress {
  address: PublicKey;       // derived Solana address
  ephemeralPubKey: Uint8Array; // published so recipient can find it
}

// Generate a new stealth key pair for a user
export function generateStealthKeyPair(): StealthKeyPair

// Derive a one-time stealth address for a recipient
export function deriveStealthAddress(
  recipientScanPubKey: Uint8Array,
  recipientSpendPubKey: Uint8Array
): StealthAddress

// Scan for stealth payments addressed to you
export function scanForPayments(
  scanKey: Uint8Array,
  spendPubKey: Uint8Array,
  ephemeralPubKeys: Uint8Array[]
): PublicKey[]

// Store/retrieve stealth keys from localStorage (hackathon scope)
export function saveStealthKeys(keys: StealthKeyPair): void
export function loadStealthKeys(): StealthKeyPair | null
```

### Tests to write first (Phase 1)

Create `app/src/test/program.test.ts`:
```
1. getPrograms returns three program clients with expected program IDs
2. buildDepositTx produces a Transaction with correct instruction data
3. buildAddCredentialTx produces a Transaction with correct accounts
4. buildAuthorizeDecryptionTx produces a Transaction
```

Create `app/src/test/merkle.test.ts`:
```
1. getCurrentMerkleRoot returns a bigint
2. getAllCredentialLeaves returns an array
3. getCredentialMerkleProof returns proof with 20 path elements
```

Create `app/src/test/stealth.test.ts`:
```
1. generateStealthKeyPair returns all 4 keys
2. deriveStealthAddress returns a valid PublicKey
3. saveStealthKeys + loadStealthKeys roundtrips correctly
4. scanForPayments finds correct addresses
```

## Phase 2: Wire Page Transaction Submission

For each page, the pattern is:
1. User fills form / selects amounts
2. Frontend generates proof via `useProofGeneration` (already works)
3. Frontend builds transaction via `program.ts` (you're creating this)
4. Frontend sends transaction via wallet adapter's `sendTransaction`
5. Frontend shows success/failure + updates state

### Credential.tsx
- On "Issue Credential" button: call `buildAddCredentialTx` → `sendTransaction`
- On success: store credential locally via `useCredential` hook

### Deposit.tsx
- On "Deposit" button: generate proof → `buildDepositTx` → `sendTransaction`
- Show shares received in UI (read from TransferRecord or compute from vault state)

### Transfer.tsx
- On "Transfer" button: derive stealth address → generate proof → `buildTransferTx` → `sendTransaction`
- Input: recipient's scan pubkey

### Withdraw.tsx
- On "Withdraw" button: generate proof → `buildWithdrawTx` → `sendTransaction`
- On "Emergency Withdraw Request": `buildEmergencyWithdrawRequestTx` → `sendTransaction`
- On "Execute Emergency Withdraw" (after 72hr): `buildEmergencyWithdrawExecuteTx` → `sendTransaction`

### Compliance.tsx
- On "Authorize Decryption" button: `buildAuthorizeDecryptionTx` → `sendTransaction`

### Tests to write first (Phase 2)

Create `app/src/test/pages-tx.test.tsx`:
```
1. Deposit page calls buildDepositTx when deposit button clicked (mock wallet)
2. Transfer page calls buildTransferTx when transfer button clicked
3. Withdraw page calls buildWithdrawTx when withdraw button clicked
4. Credential page calls buildAddCredentialTx when issue button clicked
5. Compliance page calls buildAuthorizeDecryptionTx when authorize button clicked
6. All pages show error toast when transaction fails
7. All pages show success state when transaction confirms
8. All pages disable submit button while transaction is pending
```

## Phase 3: Playwright E2E Smoke

### Setup

```bash
cd app
npm install -D @playwright/test
npx playwright install chromium
```

Create `app/playwright.config.ts`:
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:5173',
  },
});
```

### Create `app/e2e/smoke.spec.ts`

```
1. App loads and renders without errors
2. All 7 routes are reachable (/, /credential, /deposit, /transfer, /withdraw, /dashboard, /compliance)
3. Each page renders its primary heading
4. Navbar shows on every page
5. "Connect Wallet" button is visible when no wallet connected
6. No "vUSDC" text appears anywhere (branding check)
7. No "24 hours" text appears in timelock context
8. Deposit page shows "vault shares" terminology
```

## Final Verification

```bash
cd app
npm test          # all unit tests pass
npm run build     # build succeeds
npx playwright test  # e2e smoke passes
```

## After You Finish

1. Update COORDINATION.md Agent 2 log with Round 2 entry.
2. Update the progress tracker row.
3. Report: total tests passing (unit + e2e), any remaining issues.

## Update Protocol

After each meaningful step, append to the "AGENT 2 LOG" section in COORDINATION.md:

```
- YYYY-MM-DD HH:MM | Round 2 | status: in_progress|done
  - tests added first: yes/no
  - files changed: [list]
  - commands run: [list]
  - result: [summary]
  - blockers: [any]
  - next step: [what's next]
```
