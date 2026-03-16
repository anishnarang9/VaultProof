# AGENT 3 (v2) — Frontend Live Wiring + Circuit Artifact Copy + IDL Sync + Final Branding Audit

## Identity

You are Agent 3 working in `/Users/anishnarang/VaultProof`. Your previous run delivered the routed app shell, hooks, libs, all pages (including Compliance), full branding cleanup, 6 ADRs, README with Privacy Model, and 9 passing tests. Now Agent 1 has landed major interface changes to VaultState, TransferRecord, and the circuit. Your job is to:

1. Copy the regenerated circuit artifacts to `app/public/circuits/`
2. Sync your TypeScript types and hooks to Agent 1's new account layouts
3. Wire real proof generation into pages (replace mocked proof flows)
4. Sync IDL types from the rebuilt Anchor programs
5. Final branding/copy audit pass
6. Ensure build + all tests still pass

## CRITICAL: Read These Files First

1. `/Users/anishnarang/VaultProof/COORDINATION.md` — especially the Interface Changes Log. Agent 1 made 3 breaking changes:
   - VaultState changed from `vusd_mint/total_deposited/total_vusd_supply` → TVS fields: `share_mint`, `total_assets`, `total_shares`, `share_price_numerator`, `share_price_denominator`, yield fields
   - TransferRecord expanded from `{proof_hash, encrypted_metadata_hash, timestamp, merkle_root_at_time}` → `{proof_hash, transfer_type, amount, timestamp, merkle_root_snapshot, encrypted_metadata, decryption_authorized, signer}` with `TransferType` enum
   - Verifying key regenerated for 22 public inputs (10 scalar + 12 ciphertext)
2. `/Users/anishnarang/VaultProof/programs/vusd-vault/src/lib.rs` — read the actual VaultState and TransferRecord structs to get exact field names/types
3. `/Users/anishnarang/VaultProof/programs/kyc-registry/src/lib.rs` — read the KycRegistry and StateTree structs

## YOUR FILE SCOPE

You MAY touch:
- `app/**` (all frontend code)
- `README.md`
- `docs/**`

You MUST NOT touch:
- `programs/**`
- `circuits/**` (except copying build artifacts TO `app/public/circuits/`)
- `tests/*.ts` at root level
- `Cargo.toml`

## PHASE 0: COPY CIRCUIT ARTIFACTS

Agent 1 regenerated the circuit. Copy the artifacts so the frontend can load them for in-browser proof generation:

```bash
mkdir -p app/public/circuits
cp circuits/build/compliance_js/compliance.wasm app/public/circuits/compliance.wasm
cp circuits/build/compliance_final.zkey app/public/circuits/compliance_final.zkey
```

Verify they exist:
```bash
ls -la app/public/circuits/
# compliance.wasm should be ~3.2 MB
# compliance_final.zkey should be ~25 MB
```

Add to `.gitignore` if they're too large for git (they probably are):
```
# In app/.gitignore
public/circuits/*.wasm
public/circuits/*.zkey
```

After copying, mark the Cross-Agent Request in COORDINATION.md as resolved.

## PHASE 1: SYNC TYPESCRIPT TYPES TO NEW ACCOUNT LAYOUTS

### Update `app/src/lib/types.ts`

Read the actual Rust structs from the programs and update your TypeScript types to match exactly:

#### VaultState (from `programs/vusd-vault/src/lib.rs`)

```typescript
export interface VaultState {
  // TVS share accounting
  totalAssets: BN;          // USDC in reserve
  totalShares: BN;          // shares outstanding
  sharePriceNumerator: BN;
  sharePriceDenominator: BN;

  // Mint references
  shareMint: PublicKey;     // was vusdMint
  usdcMint: PublicKey;
  reserve: PublicKey;

  // AML thresholds
  amlThresholds: BN[];     // [retail, accredited, institutional]
  expiredThreshold: BN;

  // Regulator
  regulatorPubkeyX: number[];  // [u8; 32]
  regulatorPubkeyY: number[];  // [u8; 32]

  // Emergency
  emergencyTimelock: BN;   // 259200 seconds = 72 hours

  // Yield tracking
  yieldSource: string;
  liquidBufferBps: number;
  totalYieldEarned: BN;

  // Authority
  authority: PublicKey;
  bump: number;
}
```

#### TransferRecord (from `programs/vusd-vault/src/lib.rs`)

```typescript
export enum TransferType {
  Deposit = 'Deposit',
  Transfer = 'Transfer',
  Withdrawal = 'Withdrawal',
}

export interface TransferRecord {
  proofHash: number[];          // [u8; 32]
  transferType: TransferType;   // NEW — was not present before
  amount: BN;                   // NEW
  timestamp: BN;
  merkleRootSnapshot: number[]; // [u8; 32] — renamed from merkleRootAtTime
  encryptedMetadata: number[];  // Vec<u8> — was encryptedMetadataHash [u8; 32]
  decryptionAuthorized: boolean;// NEW
  signer: PublicKey;            // NEW
  bump: number;
}
```

#### KycRegistry (from `programs/kyc-registry/src/lib.rs`)

```typescript
export interface KycRegistry {
  authority: PublicKey;
  stateTreePubkey: PublicKey;   // NEW — Light Protocol state tree
  credentialCount: BN;
  revokedCount: BN;            // NEW
  issuerPubkey: number[];      // [u8; 32]
  bump: number;
}

export interface StateTree {
  registry: PublicKey;
  root: number[];              // [u8; 32] — the Merkle root
  depth: number;
  nextIndex: BN;
}
```

**Read the actual Rust source to get exact field names. Anchor converts snake_case to camelCase in the IDL.**

### Tests to write first

Update `app/src/test/lib.test.ts`:
```
1. VaultState type has totalAssets, totalShares, sharePriceNumerator, sharePriceDenominator
2. VaultState type does NOT have totalDeposited or totalVusdSupply (old fields)
3. TransferRecord type has transferType, amount, encryptedMetadata (Vec), decryptionAuthorized, signer
4. TransferRecord type does NOT have encryptedMetadataHash (old field)
5. KycRegistry type has stateTreePubkey, revokedCount
6. StateTree type has root, depth, nextIndex
```

## PHASE 2: SYNC HOOKS TO NEW TYPES

### Update `app/src/hooks/useVaultState.ts`

- Return the new TVS fields: `sharePrice` computed as `totalAssets / totalShares`
- Return `amlThresholds` array
- Return `regulatorKey` (X,Y coordinates)
- Remove any references to old field names

### Update `app/src/hooks/useTransferRecords.ts`

- Records now have `transferType` — can filter by Deposit/Transfer/Withdrawal
- Records have `amount` — can compute totals directly instead of estimating
- Records have `decryptionAuthorized` — show compliance status

### Update `app/src/hooks/useRegistryState.ts`

- Now reads from two accounts: `KycRegistry` (metadata) + `StateTree` (root)
- Return `activeCredentials = credentialCount - revokedCount`
- Return `merkleRoot` from StateTree

### Tests to update

Update `app/src/test/hooks.test.tsx`:
```
1. useVaultState returns sharePrice computed from totalAssets/totalShares
2. useVaultState does NOT return totalDeposited (old field)
3. useTransferRecords returns records with transferType field
4. useTransferRecords can filter by TransferType
5. useRegistryState returns activeCredentials (count - revoked)
6. useRegistryState returns merkleRoot from StateTree
```

## PHASE 3: WIRE REAL PROOF GENERATION

### Update `app/src/lib/proof.ts`

The circuit now has 22 public inputs (10 scalar + 12 ciphertext). Update `buildCircuitInput()`:

```typescript
export interface CircuitInput {
  // Private inputs
  identitySecret: string;
  credentialFields: string[];    // name, country, accreditation, expiry
  issuerPubKey: [string, string]; // EdDSA key
  issuerSignature: { R8: [string, string], S: string };
  merklePathElements: string[];   // depth-20 path (20 elements, was 10)
  merklePathIndices: number[];    // depth-20 indices (20 elements, was 10)
  walletPubkey: string;          // NEW — signer's wallet
  balance: string;

  // Public inputs (verified on-chain)
  merkleRoot: string;
  transferAmount: string;
  currentTimestamp: string;
  retailThreshold: string;       // NEW — from vault state
  accreditedThreshold: string;   // NEW — from vault state
  institutionalThreshold: string;// NEW — from vault state
  expiredThreshold: string;      // NEW — from vault state
  regulatorPubKeyX: string;
  regulatorPubKeyY: string;
  // walletPubkey is also public
  // encryptedMetadata produced by ElGamal inside circuit
}
```

### Update `app/src/hooks/useProofGeneration.ts`

Real proof steps:
1. **Loading circuit** — fetch WASM + zkey from `/circuits/compliance.wasm` and `/circuits/compliance_final.zkey`
2. **Fetching Merkle proof** — get 20-element path from registry state
3. **Building witness** — construct CircuitInput with all 22 public inputs
4. **Generating proof** — `snarkjs.groth16.fullProve(input, wasmPath, zkeyPath)` (6-9 seconds)
5. **Encrypting metadata** — ElGamal ciphertext (produced inside circuit, extracted from public signals)
6. **Done** — return proof + publicSignals + timing

### Update page flows

#### Deposit page
```typescript
// Read vault state for thresholds
const { amlThresholds, expiredThreshold, regulatorKey } = useVaultState();

// Build circuit input with real thresholds from vault
const input = buildCircuitInput({
  ...userCredential,
  transferAmount: depositAmount,
  retailThreshold: amlThresholds[0],
  accreditedThreshold: amlThresholds[1],
  institutionalThreshold: amlThresholds[2],
  expiredThreshold,
  regulatorPubKeyX: regulatorKey.x,
  regulatorPubKeyY: regulatorKey.y,
  walletPubkey: wallet.publicKey,
  merkleRoot: registryState.merkleRoot,
  merkleProof: registryState.getMerkleProof(credential.leafHash),
});

// Generate real proof
const { proof, publicSignals } = await generateProof(input);

// Submit to vault program
await vaultProgram.methods.depositWithProof(
  proofBuffer,
  publicInputsBuffer,
  depositAmount,
  encryptedMetadata,
).accounts({ ... }).rpc();
```

#### Dashboard page
- Show `sharePrice` as `totalAssets / totalShares` (formatted to 4 decimals)
- Show transfer breakdown by type: deposits, transfers, withdrawals
- Show compliance rate: `records.filter(r => r.decryptionAuthorized).length / records.length`

#### Compliance page
- Show each TransferRecord with its `transferType` badge
- Show `decryptionAuthorized` status per record
- Show `encryptedMetadata` length (not the hash — the actual ciphertext size)

### Tests to write first

Update `app/src/test/pages.test.tsx`:
```
1. Deposit page reads thresholds from vault state for proof input
2. Deposit page shows share price and shares-to-receive estimate
3. Dashboard shows transfer type breakdown (deposits/transfers/withdrawals)
4. Dashboard shows share price (not raw total_deposited)
5. Compliance page shows decryption status per record
6. Compliance page shows transfer type badges
7. Proof generation uses 20-element Merkle path (not 10)
```

## PHASE 4: FINAL BRANDING + COPY AUDIT

Do a comprehensive search for any remaining issues:

```bash
# Should all return 0 results:
grep -ri "vusdc\|vusd" app/src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules"
grep -ri "24 hours" app/src/ --include="*.tsx" --include="*.ts"
grep -ri "private stablecoins" app/src/ --include="*.tsx" --include="*.ts"
grep -ri "privacy protocol" app/src/ --include="*.tsx" --include="*.ts"
grep -ri "total_deposited\|totalDeposited" app/src/ --include="*.tsx" --include="*.ts"
grep -ri "encrypted_metadata_hash\|encryptedMetadataHash" app/src/ --include="*.tsx" --include="*.ts"
```

Also verify positive assertions:
```bash
# Should find matches:
grep -ri "vault shares" app/src/ --include="*.tsx" --include="*.ts"
grep -ri "confidential" app/src/ --include="*.tsx" --include="*.ts"
grep -ri "72 hours\|72-hour\|259200" app/src/ --include="*.tsx" --include="*.ts"
```

## PHASE 5: UPDATE DOCS

### Update README.md

- Ensure the architecture description mentions 22 public inputs, depth-20 tree
- Ensure Hackathon Scope table reflects TVS model, Light Protocol StateTree
- Add any new limitations discovered during wiring

### Update ADRs if needed

- ADR-003 (Tokenized Vault Shares) — verify it matches the actual implementation (share_price_numerator/denominator)
- ADR-002 (Light Protocol) — verify it matches the StateTree PDA pattern Agent 2 implemented

## SUCCESS CRITERIA

- [ ] `app/public/circuits/compliance.wasm` exists (~3.2 MB)
- [ ] `app/public/circuits/compliance_final.zkey` exists (~25 MB)
- [ ] TypeScript types match Agent 1's VaultState and TransferRecord exactly
- [ ] TypeScript types match Agent 2's KycRegistry and StateTree exactly
- [ ] No references to old field names (totalDeposited, vusdMint, encryptedMetadataHash)
- [ ] No "vUSDC", "24 hours", "private stablecoins", or "privacy protocol" in frontend
- [ ] Proof generation uses 20-element Merkle paths + all 22 public inputs
- [ ] `cd app && npm test` — all tests pass
- [ ] `cd app && npm run build` — succeeds with zero errors
- [ ] Cross-Agent Request for circuit artifacts marked as resolved in COORDINATION.md

## UPDATE PROTOCOL

After each meaningful step, append to "AGENT 3 LOG" in COORDINATION.md:
```
- YYYY-MM-DD HH:MM | status: in_progress|blocked|done
  - tests added first: yes/no
  - files changed: [list]
  - commands run: [list]
  - result: [summary]
  - blockers: [any]
  - next step: [what's next]
```
