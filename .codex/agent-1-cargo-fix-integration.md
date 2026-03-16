# AGENT 1 (v2) — Cargo Dependency Fix + Anchor Build + Rust Test Green + Integration Scaffolding

## Identity

You are Agent 1 working in `/Users/anishnarang/VaultProof`. Your previous run delivered the circuit recompile, on-chain verifier overhaul, TVS share model, replay protection, and decryption auth anchoring. All code is written. But it's all blocked by a Cargo workspace dependency conflict. Your job now is to **fix the build, get all Rust tests green, and then write integration test scaffolding**.

## CRITICAL: Read These Files First

1. `/Users/anishnarang/VaultProof/COORDINATION.md` — current state, cross-agent requests, interface changes
2. `/Users/anishnarang/VaultProof/vaultproof-fix-addendum.md` — the authoritative spec

## THE BLOCKER — EXACT DIAGNOSIS

The workspace has three programs under `programs/*`. The Cargo resolver (v2) can't unify:

- `anchor-lang 0.32.1` → needs `solana-instruction ^2` → resolves to 2.3.3
- `anchor-spl 0.32.1` → pulls `spl-token-2022 ^8` → pulls `solana-zk-sdk ^2.2.0` → needs `solana-instruction =2.2.1` (EXACT pin)
- `light-hasher 1.1` (in kyc-registry) → pulls Solana 1.18 ecosystem deps → incompatible with Solana 2.x

**Two conflicts:**
1. `solana-instruction` version: `=2.2.1` (from solana-zk-sdk) vs `2.3.3` (from anchor-lang)
2. Solana major version: 1.18 (from light-hasher) vs 2.x (from anchor-lang/anchor-spl)

## YOUR FILE SCOPE

You MAY touch:
- `Cargo.toml` (workspace root) — add dependency overrides, pins, workspace deps
- `programs/kyc-registry/Cargo.toml` — change/remove/replace `light-hasher` dependency
- `programs/kyc-registry/src/lib.rs` — adapt code if light-hasher is replaced
- `programs/vusd-vault/Cargo.toml` — pin deps if needed
- `programs/compliance-admin/Cargo.toml` — pin deps if needed
- `Cargo.lock` — will regenerate naturally
- `tests/integration_e2e.ts` (new file)

You MUST NOT touch:
- `app/**`
- `circuits/**`
- `programs/vusd-vault/src/lib.rs` (code is done, only Cargo.toml if needed)
- `programs/compliance-admin/src/lib.rs` (code is done, only Cargo.toml if needed)

## PHASE 1: FIX THE CARGO BUILD

Try these approaches in order. Stop at the first one that makes `anchor build` succeed:

### Approach A: Replace light-hasher with inline Poseidon (RECOMMENDED)

The kyc-registry only uses `light-hasher` for Poseidon hashing. The actual Light Protocol CPI isn't wired yet (it uses a mock StateTree PDA pattern). Replace `light-hasher` with a minimal inline Poseidon implementation or use `ark-crypto-primitives` which is compatible with Solana 2.x.

Steps:
1. Remove `light-hasher = "1.1"` from `programs/kyc-registry/Cargo.toml`
2. Check what `light-hasher` is actually used for in `programs/kyc-registry/src/lib.rs` — it's likely just `Poseidon::hash()` or similar
3. Replace with an inline Poseidon hasher that:
   - Uses the same constants/parameters as the circuit's Poseidon (circomlib's parameters)
   - Has no Solana version dependency
   - Or use `light-poseidon` crate if it doesn't pull Solana deps

Check if `light-poseidon` (standalone, no Solana deps) exists:
```bash
cargo search light-poseidon
```

If `light-poseidon` exists and is Solana-version-agnostic, use it. Otherwise, implement a minimal hasher.

4. Run `anchor build` — must succeed for all three programs
5. Run `cargo test -p kyc-registry` — must compile

### Approach B: Pin solana-instruction in workspace

If Approach A is too invasive, try:

```toml
# In root Cargo.toml [workspace.dependencies]
solana-instruction = "=2.2.1"
```

Then `cargo update` to regenerate the lockfile. This forces the entire workspace to use 2.2.1.

### Approach C: Separate kyc-registry into its own workspace

Nuclear option — remove `"programs/kyc-registry"` from workspace members, give it its own `Cargo.toml` workspace. This breaks `anchor build` for kyc-registry but lets vusd-vault and compliance-admin build.

## PHASE 2: GET ALL RUST TESTS GREEN

Once `anchor build` succeeds, run these in order:

```bash
# 1. KYC registry tests
cargo test -p kyc-registry -- --nocapture

# 2. Verifier validation tests
cargo test -p vusd-vault strict_ -- --nocapture

# 3. TVS share accounting tests
cargo test -p vusd-vault share_ -- --nocapture

# 4. Decryption auth tests
cargo test -p compliance-admin decryption_ -- --nocapture

# 5. Full anchor build
anchor build

# 6. Full anchor test suite (starts local validator)
anchor test
```

Fix any test failures. The code is written — failures are likely due to:
- Account size mismatches from layout changes
- Missing error codes that changed
- Serialization changes from the new TransferRecord layout

## PHASE 3: INTEGRATION TEST SCAFFOLDING

Create `tests/integration_e2e.ts` — a comprehensive end-to-end test file that exercises the full flow across all three programs.

### Test cases to write:

```
HAPPY PATH
1. Initialize KYC registry + state tree
2. Add credential → verify root changed
3. Initialize vault with share mint + thresholds
4. Generate Groth16 proof with correct public inputs (use snarkjs)
5. Deposit with proof → verify shares minted at 1:1 ratio
6. Check TransferRecord created with correct fields (type=Deposit, full metadata, proof_hash)
7. Second deposit after yield → verify share price changed
8. Transfer with proof → verify TransferRecord type=Transfer
9. Withdraw with proof → verify USDC returned based on share price
10. Verify final vault state: total_assets, total_shares consistent

SECURITY
11. Replay: submit same proof twice → second fails (PDA already exists)
12. Wrong wallet: proof generated for wallet A, submitted by wallet B → rejected
13. Stale proof: timestamp >60 seconds old → rejected
14. Wrong threshold: proof uses different AML threshold than vault state → rejected
15. Wrong regulator key: proof uses different key than vault state → rejected

REVOCATION
16. Revoke credential → verify root changed
17. Deposit with revoked credential's old Merkle proof → rejected (root mismatch)
18. Other credential still works after revocation

COMPLIANCE
19. Authorize decryption for TransferRecord → creates DecryptionAuthorization PDA
20. TransferRecord.decryption_authorized set to true
21. Double authorization attempt fails (PDA exists)

EMERGENCY
22. Request emergency withdrawal → creates pending record
23. Emergency execution before timelock → rejected
24. Emergency execution after 72hr timelock → succeeds
```

### Implementation notes:

- Use the actual circuit artifacts: `circuits/build/compliance_js/compliance.wasm` and `circuits/build/compliance_final.zkey`
- Use `snarkjs` for proof generation in tests
- Use `circomlibjs` for Poseidon hashing (must match circuit parameters)
- Use the test utilities from `circuits/test_utils.mjs` for EdDSA key generation, Poseidon hashing, ElGamal encryption
- Tests should run against local validator: `anchor test --skip-build`

### Test infrastructure needed:

```typescript
import * as snarkjs from "snarkjs";
import { buildPoseidon, buildEddsa } from "circomlibjs";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";

// Helpers you'll need:
async function generateComplianceProof(inputs: CircuitInputs): Promise<{ proof: any, publicSignals: string[] }>
async function buildCircuitInputs(params: DepositParams): Promise<CircuitInputs>
function computeProofHash(proof: any): Buffer
function encodePublicInputsForSolana(publicSignals: string[]): Buffer[]
```

## SUCCESS CRITERIA

- [ ] `anchor build` succeeds with zero errors
- [ ] `cargo test -p kyc-registry` — all tests pass
- [ ] `cargo test -p vusd-vault` — all strict_ and share_ tests pass
- [ ] `cargo test -p compliance-admin` — all decryption_ tests pass
- [ ] `tests/integration_e2e.ts` exists with 24 test cases
- [ ] `anchor test` runs at least the smoke-level integration tests

## UPDATE PROTOCOL

After each meaningful step, append to "AGENT 1 LOG" in COORDINATION.md:
```
- YYYY-MM-DD HH:MM | status: in_progress|blocked|done
  - tests added first: yes/no
  - files changed: [list]
  - commands run: [list]
  - result: [summary]
  - blockers: [any]
  - next step: [what's next]
```
