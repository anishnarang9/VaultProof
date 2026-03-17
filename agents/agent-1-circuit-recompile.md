# AGENT 1: CIRCUIT RECOMPILE — Codex Prompt

## Your Role
You are Agent 1, responsible for recompiling the VaultProof ZK circuit with two new credential fields: `sourceOfFundsHash` and `credentialVersion`. You own all files in `circuits/`. Do NOT modify files outside that directory except for copying build artifacts to their destinations.

## Project Context
VaultProof is a ZK compliance engine for institutional DeFi vaults on Solana. It uses a Groth16 circuit (Circom) that proves KYC, AML, source of funds, and Travel Rule compliance in a single proof. The circuit is at `circuits/compliance.circom`.

Read `vaultproof-product-revamp.md` and `vaultproof-technical-bible.md` at the project root for full context.

## Coordination
Log every change you make in `REVAMP-COORDINATION.md` under the Agent 1 section. Mark artifacts as delivered when done.

---

## WHAT YOU MUST DO

### Task 1: Add two new private inputs to `circuits/compliance.circom`

After the existing private inputs (line ~36, after `credentialExpiry`), add:
```circom
signal input sourceOfFundsHash;     // Poseidon hash of source-of-funds attestation
signal input credentialVersion;     // Credential format version number (currently 1)
```

### Task 2: Change credential hashing from Poseidon(3) to Poseidon(4)

Current code (around line 95-99):
```circom
component credHashFinal = Poseidon(3);
credHashFinal.inputs[0] <== credHash1.out;
credHashFinal.inputs[1] <== credHash2.out;
credHashFinal.inputs[2] <== credHash3.out;
```

Replace with:
```circom
// New sub-hash for source-of-funds and version
component credHash4 = Poseidon(2);
credHash4.inputs[0] <== sourceOfFundsHash;
credHash4.inputs[1] <== credentialVersion;

// credHashFinal now takes 4 inputs
component credHashFinal = Poseidon(4);
credHashFinal.inputs[0] <== credHash1.out;
credHashFinal.inputs[1] <== credHash2.out;
credHashFinal.inputs[2] <== credHash3.out;
credHashFinal.inputs[3] <== credHash4.out;
```

### Task 3: DO NOT change anything else in compliance.circom

- Public inputs stay EXACTLY the same (22 public inputs). No additions.
- Tree depth stays at 20. No change.
- Wallet binding stays in leaf hash. No change.
- Thresholds are already public inputs. No change.
- The `component main` declaration stays exactly the same.

### Task 4: Update test utilities — `circuits/test_utils.mjs`

Update the `buildCredentialHash()` function (or equivalent) to use the new 4-input Poseidon chain:
```javascript
const credHash1 = poseidon([name, nationality]);
const credHash2 = poseidon([dob, jurisdiction]);
const credHash3 = poseidon([accreditation, expiry]);
const credHash4 = poseidon([sourceOfFundsHash, credentialVersion]);  // NEW
const credHashFinal = poseidon([credHash1, credHash2, credHash3, credHash4]);  // was 3 inputs
```

Add default test values:
- `sourceOfFundsHash = poseidon([BigInt("12345")])` (hash of a dummy source-of-funds attestation)
- `credentialVersion = 1n`

Update every helper that builds credential inputs to include these two new fields.

### Task 5: Update `circuits/test_comprehensive.mjs`

- Add `sourceOfFundsHash` and `credentialVersion` to ALL existing test credential inputs
- All 31 existing tests must pass with the updated inputs
- Add 5 NEW tests:
  1. Valid proof with source-of-funds hash present
  2. Valid proof with different credential version (e.g., version 2)
  3. Different `sourceOfFundsHash` produces different leaf hash (non-trivial — proves the field matters)
  4. `credentialVersion = 0` works (version is just a number, no enforcement in circuit)
  5. Credential with all new fields + full Merkle path verification at depth 20

### Task 6: Update `circuits/test_recompile.mjs`

Same as above — add the new fields to all test inputs. Ensure tests pass.

### Task 7: Recompile the circuit

Run:
```bash
cd circuits
npm install  # ensure circomlib is present

# Compile
circom compliance.circom --r1cs --wasm --sym -o build/

# Check constraint count (expect ~41,000, must fit pot16 = 65,536 max)
npx snarkjs r1cs info build/compliance.r1cs

# Trusted setup (reuse pot16_final.ptau)
npx snarkjs groth16 setup build/compliance.r1cs pot16_final.ptau circuit_0000.zkey
npx snarkjs zkey contribute circuit_0000.zkey circuit_final.zkey --name="VaultProof Phase2" -v
npx snarkjs zkey export verificationkey circuit_final.zkey verification_key.json

# Export verifying key for Solana
node export_vk_solana.mjs verification_key.json > ../programs/vusd-vault/src/keys/verifying_key.rs
```

### Task 8: Copy artifacts to consumer locations

```bash
# For Agent 3 (vault program)
cp verification_key output to: programs/vusd-vault/src/keys/verifying_key.rs

# For Agent 5 (frontend)
mkdir -p ../app/public/circuits/
cp build/compliance_js/compliance.wasm ../app/public/circuits/
cp circuit_final.zkey ../app/public/circuits/compliance_final.zkey
```

### Task 9: Run all tests

```bash
cd circuits
node test_comprehensive.mjs
node test_recompile.mjs
```

All tests must pass. If any fail, debug and fix before marking done.

---

## FILE OWNERSHIP (DO NOT MODIFY FILES OUTSIDE THIS LIST)

```
circuits/compliance.circom              ← MODIFY (add 2 inputs, change Poseidon(3)→Poseidon(4))
circuits/test_comprehensive.mjs         ← UPDATE (new fields in all tests + 5 new tests)
circuits/test_recompile.mjs             ← UPDATE (new fields in all tests)
circuits/test_utils.mjs                 ← UPDATE (new credential hash logic)
circuits/test_circuit.mjs               ← UPDATE if it builds credentials (add new fields)
circuits/setup.sh                       ← MINOR UPDATE if needed

OUTPUT artifacts (write to these paths):
programs/vusd-vault/src/keys/verifying_key.rs
app/public/circuits/compliance.wasm
app/public/circuits/compliance_final.zkey
```

## WHAT NOT TO DO
- Do NOT change public inputs. The list stays at 22.
- Do NOT change tree depth. It's already 20.
- Do NOT change the ElGamal encryption stage.
- Do NOT change the Merkle verifier or tiered threshold subcircuits.
- Do NOT modify any Rust program code (that's Agent 3's job).
- Do NOT modify any frontend code (that's Agent 5's job).

## EXPECTED OUTCOMES
- Constraint count: ~41,000 (up from ~37,260)
- Proof time: ~6-9 seconds (unchanged meaningfully)
- Still fits pot16 (65,536 max constraints)
- All 36 tests pass (31 existing + 5 new)
- Three artifacts delivered to consumer paths

## DONE CRITERIA
- [ ] `compliance.circom` has `sourceOfFundsHash` and `credentialVersion` private inputs
- [ ] Credential hashing uses Poseidon(4) with `credHash4`
- [ ] Circuit compiles with `circom` (no errors)
- [ ] Constraint count confirmed (~41,000, fits pot16)
- [ ] Trusted setup completed (new .zkey)
- [ ] Verifying key exported to Rust format
- [ ] All test files updated with new fields
- [ ] 5 new tests added and passing
- [ ] All 31 existing tests still pass
- [ ] Artifacts copied to `programs/vusd-vault/src/keys/` and `app/public/circuits/`
- [ ] `REVAMP-COORDINATION.md` updated with changes and artifacts marked delivered
