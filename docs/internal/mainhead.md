# VaultProof Main Head

Last updated: 2026-03-15

## Mission

Make the technical architecture in [vaultproof-technical-architecture.md](/Users/anishnarang/VaultProof/vaultproof-technical-architecture.md) real in code.

This file is the master execution brief and shared tracker.

If you are an agent working on this project:
1. Read only this file first.
2. Find your agent section.
3. Stay inside your file scope.
4. Follow strict test-first development.
5. Update only your own agent section in this file.

## Current Parallelization Rule

Do not run all agents in parallel.

### Start now in parallel

- Mainline Integrator
- Agent A
- Agent B
- Agent C

### Do not start yet

- Agent D
- Agent E
- Agent F

### Start gates

- Start Agent D only after Agent C lands frontend test harness baseline.
- Start Agent E only after Mainline Integrator lands route shell and shared frontend data contracts.
- Start Agent F only after Mainline Integrator and Agent C land shell plus test baseline.

## Non-Negotiable Development Rules

### Test-first rule

Every agent must follow this sequence:
1. Add failing tests first.
2. Run the targeted tests and capture the failure.
3. Implement the minimum code to satisfy the tests.
4. Rerun the targeted tests.
5. Run the relevant build or lint command.
6. Update your section in this file.

### Never do these

- Do not weaken assertions to make tests pass.
- Do not broaden your file scope unless blocked.
- Do not change another agent's files unless explicitly reassigned here.
- Do not silently rewrite requirements.
- Do not mark a task done if the tests do not prove it.

## What Is Still Left In The Entire Project

### P0 backend correctness debt

1. KYC registry currently trusts a caller-supplied root instead of recomputing it on-chain.
2. KYC revocation currently appends to `revoked` but does not update the active Merkle root.
3. Transfer records currently store `encrypted_metadata_hash` instead of full encrypted metadata bytes required by the architecture.
4. AML threshold changes and regulator key rotation are mostly storage updates; their effect is not strictly enforced by targeted tests.
5. Some current integration cases are softened and must become strict:
   - zero-amount deposit must deterministically reject
   - insufficient-balance deposit must be a true insufficient-funds case
   - expired-under-threshold withdrawal must deterministically pass
   - emergency-after-timelock must execute successfully with funded balances

### P0 frontend foundation

1. Real app shell is missing. [app/src/App.tsx](/Users/anishnarang/VaultProof/app/src/App.tsx) is still the Vite starter.
2. Real router is missing.
3. Wallet provider and local validator connection are missing.
4. Shared frontend runtime modules are missing:
   - `app/src/lib/program.ts`
   - `app/src/lib/merkle.ts`
   - `app/src/lib/elgamal.ts`
   - `app/src/lib/stealth.ts`
   - `app/src/hooks/useProofGeneration.ts`
   - `app/src/hooks/useCredential.ts`
   - `app/src/hooks/useVaultProof.ts`
5. Current frontend build is broken.

### P0 frontend test foundation

1. No proper frontend unit test harness is configured.
2. No route smoke tests exist.
3. No component test utilities exist.
4. No Playwright smoke baseline exists.

### P1 product features still not real

1. Credential issuance page is mostly mock behavior.
2. Deposit page is mostly mock behavior.
3. Transfer page is mostly mock behavior.
4. Withdraw and emergency flows are mostly mock behavior.
5. Dashboard uses placeholder data.
6. Compliance page does not exist.
7. shadcn-style shared UI system is not yet built.

### P1 architecture gaps

1. Compliance/regulatory view does not expose decryption authorization flow.
2. Frontend does not yet build a real Merkle proof from on-chain leaves.
3. Frontend does not yet generate real in-browser proofs on user actions.
4. Frontend does not yet generate or persist real stealth accounts.
5. Frontend does not yet read live transfer records and vault state.

### P2 production-readiness

1. localnet and devnet env support
2. asset-loading checks for WASM and zkey
3. CI
4. docs and operator runbook
5. end-to-end browser tests

## Ownership Boundaries

### Mainline Integrator owns

- `app/src/App.tsx`
- `app/src/main.tsx`
- `app/src/lib/**`
- `app/src/hooks/**`
- shared frontend state contracts
- shared program clients

### Agent A owns

- `programs/kyc-registry/**`
- KYC-focused backend tests

### Agent B owns

- `programs/vusd-vault/**`
- `programs/compliance-admin/**`
- vault/compliance-focused backend tests

### Agent C owns

- frontend test config
- frontend test utilities
- frontend baseline tests
- `app/package.json` test scripts if needed

### Agent D owns after gate opens

- `app/src/components/ui/**`
- `app/src/components/credential/**`
- `app/src/components/vault/**`

### Agent E owns after gate opens

- `app/src/components/dashboard/**`
- `app/src/components/compliance/**`
- `app/src/pages/Compliance.tsx`

### Agent F owns after gate opens

- QA
- env handling
- CI
- docs
- browser smoke expansion

## How To Update This File

Each agent may edit only:
- the central tracker row for that agent
- the global change log by appending one new entry
- that agent's own detailed section below

Each update must append a new log entry using this template:

```md
- YYYY-MM-DD HH:MM TZ | status: in_progress|blocked|ready_for_merge|merged
  - tests added first:
  - files changed:
  - commands run:
  - result:
  - blockers:
  - next step:
```

Do not rewrite older entries.

## Central Progress Tracker

This is the single place to scan overall project status quickly.

| Workstream | Owner | Status | Scope | Tests-first started | Last meaningful result | Next step |
|---|---|---|---|---|---|---|
| Frontend core runtime | Mainline Integrator | in_progress | app shell, router, wallet, shared runtime, proof pipeline | no | starter app still needs replacement | land app shell baseline |
| KYC registry correctness | Agent A | not_started | kyc-registry root recomputation and revoke correctness | no | waiting to start | add strict failing registry tests |
| Vault/compliance hardening | Agent B | not_started | vault strictness, emergency success, full metadata, compliance semantics | no | waiting to start | add strict failing vault/compliance tests |
| Frontend test harness | Agent C | not_started | Vitest, RTL, Playwright smoke, test utilities | no | waiting to start | add failing frontend smoke tests |
| UI system | Agent D | blocked | shared UI + credential/vault presentation | no | blocked on Agent C | wait for test harness |
| Dashboard/compliance UI | Agent E | blocked | dashboard + compliance presentation | no | blocked on Mainline Integrator | wait for shell and contracts |
| QA / env / docs | Agent F | blocked | CI, envs, smoke expansion, docs | no | blocked on shell and tests | wait for baseline |

## Global Change Log

This is the single shared chronological log for all progress.

Every agent must append one entry here each time they complete a meaningful step.

Use this template:

```md
- YYYY-MM-DD HH:MM TZ | Agent X | status
  - summary:
  - tests first:
  - files:
  - commands:
  - blockers:
  - next:
```

Entries:

- 2026-03-15 00:00 PT | Mainline Integrator | in_progress
  - summary: created execution-grade mainhead brief with agent scopes, test-first rules, and phase gates
  - tests first: not yet started for this step
  - files: `/Users/anishnarang/VaultProof/mainhead.md`
  - commands: `sed -n ... mainhead.md`, `apply_patch`
  - blockers: none
  - next: begin frontend core runtime work while Agents A/B/C start from their sections

## Mainline Integrator Execution Brief

Status: `in_progress`

### Mission

Turn the frontend core into the real application runtime.

### Exact scope

- `app/src/App.tsx`
- `app/src/main.tsx`
- `app/src/lib/**`
- `app/src/hooks/**`
- route wiring
- wallet provider wiring
- local validator connection
- shared program clients
- proof pipeline
- live feature wiring across existing pages

### Do now

1. Replace the Vite starter app with the real routed shell.
2. Add wallet providers and local validator connection.
3. Create shared typed models for credential, stealth accounts, vault state, transfer records, proof state.
4. Create program client helpers for all three IDLs.
5. Create Merkle, ElGamal, stealth, and proof loader helpers.
6. Wire real data and actions into `Credential`, `Deposit`, `Transfer`, `Withdraw`, `Dashboard`.

### Do not touch

- `programs/kyc-registry/**`
- `programs/vusd-vault/**`
- `programs/compliance-admin/**`
- frontend test config owned by Agent C
- presentational component directories once D/E start

### Required tests to add first

1. app shell route render smoke
2. wallet-provider bootstrap smoke
3. local validator connection helper smoke
4. program client creation smoke

### Acceptance criteria

- app root no longer contains starter content
- frontend builds
- routes exist for all active pages
- shared runtime exists for future page integration
- no collision with Agent C test-harness ownership

### Update log

- 2026-03-15 00:00 PT | status: in_progress
  - tests added first: pending
  - files changed: pending
  - commands run: pending
  - result: starting app shell and runtime baseline
  - blockers: none
  - next step: replace starter app and establish shared frontend runtime

## Agent A Execution Brief

Status: `not_started`

### Mission

Make the KYC registry match the technical architecture instead of the current simplified implementation.

### Exact scope

Allowed:
- `programs/kyc-registry/**`
- new KYC-focused tests under `tests/**`
- `Cargo.toml` only if needed for KYC registry dependencies

Not allowed:
- `programs/vusd-vault/**`
- `programs/compliance-admin/**`
- `app/**`
- shared integration test assertions unrelated to KYC unless absolutely required

### Architecture gaps you must close

1. `add_credential` currently accepts a caller-supplied root. The architecture requires root recomputation on-chain.
2. `revoke_credential` currently adds to `revoked` only. The architecture requires the active root to change when revoked leaves are excluded.
3. Registry behavior must stay authority-gated and duplicate-safe.

### Required tests to write first

Write failing tests first for all of the following:

1. `initialize_registry` creates a deterministic empty root.
2. `add_credential` recomputes the root on-chain from stored leaves without trusting an externally supplied root.
3. Adding N credentials yields the exact expected root from the Poseidon tree.
4. Duplicate leaf insertion is rejected.
5. `revoke_credential` changes the active root.
6. Revoked leaves are excluded from the active root calculation.
7. Revoking a non-existent credential fails.
8. Revoking an already revoked credential fails.
9. Authority transfer preserves all existing root behavior.
10. Old authority cannot modify the registry after transfer.

### Implementation expectations

1. Prefer focused test files, for example:
   - `tests/kyc_registry_strict.ts`
2. If on-chain Poseidon is needed, add the minimal dependency required.
3. Do not fake root updates in tests.
4. Keep account layout changes minimal and justified.
5. If active-vs-all leaves must be represented explicitly, document the choice in your update log.

### Suggested command sequence

```bash
anchor test --skip-build --skip-local-validator --provider.cluster http://127.0.0.1:8897 --run tests/kyc_registry_strict.ts
anchor build
anchor test --skip-local-validator --provider.cluster http://127.0.0.1:8897 --run tests/kyc_registry_strict.ts
```

### Done means

- failing tests were added first
- KYC-specific tests are green
- registry behavior now matches the architecture for root maintenance
- no frontend or vault files were changed

### Agent A copy-paste prompt

```text
You are Agent A working in /Users/anishnarang/VaultProof.

Read /Users/anishnarang/VaultProof/mainhead.md and obey the Agent A section exactly.

Your mission:
- make the KYC registry match the architecture
- use strict TDD
- update only your own Agent A section in mainhead.md

Rules:
1. Add failing tests first.
2. Run the targeted tests and capture the failure.
3. Implement the minimum code to satisfy the tests.
4. Rerun the targeted tests.
5. Run the relevant build command.
6. Update Agent A's log in mainhead.md.
7. Do not touch vusd-vault, compliance-admin, or app files.

Required test cases:
- initialize deterministic empty root
- on-chain root recomputation on add
- exact expected root after multiple additions
- duplicate rejection
- root change on revoke
- revoked leaf exclusion from active root
- revoke non-existent fails
- revoke already-revoked fails
- authority transfer preserves correctness
- old authority rejected after transfer

Prefer a focused test file such as tests/kyc_registry_strict.ts.
End by reporting: files changed, tests added, commands run, result, blockers, next step.
```

### Update log

- no updates yet

## Agent B Execution Brief

Status: `not_started`

### Mission

Make the vault and compliance backend behavior strict and architecture-aligned.

### Exact scope

Allowed:
- `programs/vusd-vault/**`
- `programs/compliance-admin/**`
- new vault/compliance-focused tests under `tests/**`
- workspace config only if needed for these tests

Not allowed:
- `programs/kyc-registry/**`
- `app/**`
- shared frontend runtime

### Architecture gaps you must close

1. Transfer records should store full encrypted metadata bytes, not only a 32-byte hash.
2. Zero-amount deposit must reject deterministically.
3. The insufficient-balance deposit case must be a real insufficient-funds case.
4. Emergency withdrawal after timelock must actually succeed in the happy path with funded balances.
5. Threshold and regulator-key updates need stronger behavioral coverage.
6. Decryption authorization semantics are currently simplified.

### Required tests to write first

Write failing tests first for all of the following:

1. Deposit with amount `0` rejects with a specific program error.
2. Deposit with a valid proof but insufficient actual USDC balance fails at token transfer.
3. Transfer record persists full encrypted metadata bytes and expected length.
4. Emergency withdrawal happy path succeeds after timelock when the stealth account is actually funded.
5. Double execution of emergency withdrawal still fails after a true successful execution.
6. Updating AML thresholds changes enforcement behavior in a targeted test.
7. Updating the regulator public key changes acceptance behavior for proof submission in a targeted test.
8. `authorize_decryption` rejects invalid or mismatched transfer record references if you introduce that validation.
9. Compliance authorization record is created with correct audit data.

### Implementation expectations

1. Prefer a focused test file, for example:
   - `tests/vault_backend_strict.ts`
2. Do not soften assertions.
3. Do not preserve current hash-only metadata storage if full byte storage is feasible.
4. If account layouts change, update tests to prove backward expectations where relevant.
5. Keep compliance-admin changes minimal and aligned to the architecture.

### Suggested command sequence

```bash
anchor test --skip-build --skip-local-validator --provider.cluster http://127.0.0.1:8897 --run tests/vault_backend_strict.ts
anchor build
anchor test --skip-local-validator --provider.cluster http://127.0.0.1:8897 --run tests/vault_backend_strict.ts
```

### Done means

- failing tests were added first
- strict vault/compliance backend tests are green
- transfer-record storage is architecture-aligned
- softened backend behaviors were replaced by strict behavior and proof

### Agent B copy-paste prompt

```text
You are Agent B working in /Users/anishnarang/VaultProof.

Read /Users/anishnarang/VaultProof/mainhead.md and obey the Agent B section exactly.

Your mission:
- harden vusd-vault and compliance-admin to match the architecture
- use strict TDD
- update only your own Agent B section in mainhead.md

Rules:
1. Add failing tests first.
2. Run the targeted tests and capture the failure.
3. Implement the minimum code to satisfy the tests.
4. Rerun the targeted tests.
5. Run the relevant build command.
6. Update Agent B's log in mainhead.md.
7. Do not touch kyc-registry or app files.

Required test cases:
- zero-amount deposit rejects
- real insufficient-balance deposit fails
- full encrypted metadata bytes persist in TransferRecord
- emergency withdrawal actually succeeds after timelock with funded balances
- double execution fails after real success
- AML threshold updates affect behavior
- regulator key updates affect behavior
- stricter decryption authorization semantics and audit record coverage

Prefer a focused test file such as tests/vault_backend_strict.ts.
End by reporting: files changed, tests added, commands run, result, blockers, next step.
```

### Update log

- no updates yet

## Agent C Execution Brief

Status: `not_started`

### Mission

Create the frontend test foundation so UI and runtime work can proceed test-first.

### Exact scope

Allowed:
- `app/package.json`
- frontend test config files
- `app/src/test/**`
- frontend test utilities
- frontend baseline test files
- Playwright baseline setup

Not allowed:
- `app/src/App.tsx`
- `app/src/main.tsx`
- `app/src/lib/**`
- `app/src/hooks/**`
- backend programs

### Architecture gaps you must close

1. No Vitest + React Testing Library setup.
2. No route or shell smoke tests.
3. No reusable test render helpers.
4. No Playwright smoke baseline.

### Required tests to write first

Write failing tests first for all of the following:

1. app shell route smoke with a placeholder router harness
2. Navbar render and active-link behavior
3. `ProofGenerationModal` step rendering and completion state
4. `Credential` page basic form validation render smoke
5. `Deposit`, `Transfer`, and `Withdraw` page render smoke
6. one Playwright smoke test that verifies the app boots and the root renders

### Implementation expectations

1. Install and configure:
   - Vitest
   - React Testing Library
   - jsdom
   - Playwright
2. Add shared helpers for rendering with router context.
3. Add test scripts to `app/package.json`.
4. Do not take ownership of business logic or routing implementation.
5. If a component currently cannot be tested because of missing providers, create minimal test wrappers rather than changing owned runtime files.

### Suggested command sequence

```bash
cd app
npm test
npm run build
npx playwright test
```

### Done means

- frontend unit test harness exists
- frontend smoke tests exist and pass
- playwright baseline exists
- runtime owners can now continue TDD against stable test tooling

### Agent C copy-paste prompt

```text
You are Agent C working in /Users/anishnarang/VaultProof.

Read /Users/anishnarang/VaultProof/mainhead.md and obey the Agent C section exactly.

Your mission:
- set up the frontend test foundation
- use strict TDD
- update only your own Agent C section in mainhead.md

Rules:
1. Add failing tests first.
2. Run the targeted tests and capture the failure.
3. Implement the minimum config and utilities to satisfy the tests.
4. Rerun the tests.
5. Run the build command.
6. Update Agent C's log in mainhead.md.
7. Do not touch App.tsx, main.tsx, lib/**, hooks/**, or backend files.

Required test cases:
- route/shell smoke
- Navbar active-link render
- ProofGenerationModal rendering
- Credential page form smoke
- Deposit/Transfer/Withdraw render smoke
- Playwright app boot smoke

Set up Vitest, React Testing Library, jsdom, and Playwright.
End by reporting: files changed, tests added, commands run, result, blockers, next step.
```

### Update log

- no updates yet

## Agent D Execution Brief

Status: `blocked`

### Start gate

Do not start until Agent C is marked `ready_for_merge` or `merged`.

### Scope

- `app/src/components/ui/**`
- `app/src/components/credential/**`
- `app/src/components/vault/**`

### Mission when unblocked

Build the shared presentational UI system and credential/vault presentational components with component tests first.

### Update log

- no updates yet

## Agent E Execution Brief

Status: `blocked`

### Start gate

Do not start until Mainline Integrator lands route shell and shared data contracts.

### Scope

- `app/src/components/dashboard/**`
- `app/src/components/compliance/**`
- `app/src/pages/Compliance.tsx`

### Mission when unblocked

Build prop-driven dashboard and compliance presentation components with tests first.

### Update log

- no updates yet

## Agent F Execution Brief

Status: `blocked`

### Start gate

Do not start until shell and test baseline are stable.

### Scope

- QA
- env handling
- CI
- docs
- smoke expansion

### Mission when unblocked

Add production-readiness scaffolding and browser validation.

### Update log

- no updates yet
