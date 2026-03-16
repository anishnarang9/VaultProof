# VaultProof

VaultProof is confidential compliance infrastructure for institutional vaults on Solana.

The product is positioned as a B2B2C protocol:

- VaultProof sells compliance infrastructure to institutions.
- Institutions operate the investor-facing vault product.
- End users hold vault shares, not a wrapped stablecoin.

## Positioning

- Tagline: `Compliant stablecoins with confidential identity`
- Category: confidential compliance infrastructure
- Product unit: vault shares representing a proportional claim on vault assets
- Buyer: institutions operating regulated vaults and investor products

## Privacy Model

VaultProof provides **confidential identity**, not anonymous transactions.

### What is confidential

- Your identity and KYC source data never touch the blockchain.
- Your credential details such as accreditation tier, jurisdiction, and expiry stay inside the proof witness.
- The link between a real wallet and a stealth vault position is kept confidential until the user exits.
- Travel Rule metadata is encrypted for authorized compliance review.

### What is not confidential

- Vault share balances on stealth accounts remain visible on-chain.
- The fact that a verified transfer occurred is public through `TransferRecord` accounts.
- Withdrawals intentionally reconnect a stealth position to a destination wallet.

### Why this design

Institutional reporting requires public balance visibility and a durable audit trail. Full balance privacy conflicts with fund accounting, regulator review, and operational reconciliation. VaultProof chooses confidential identity instead: confidential participants, visible vault rails.

## Architecture Summary

- The KYC registry is authority-controlled and currently stored as `KycRegistry`, `StateTree`, and `CredentialLeaf` PDAs that emulate the intended Light/Photon shape.
- The compliance circuit is depth 20 and exposes 22 public inputs: 10 scalar values plus 12 ElGamal ciphertext scalars.
- Wallet binding uses `Poseidon(credHashFinal, identitySecret, walletPubkey)` for the credential leaf.
- Vault thresholds are public inputs checked against live on-chain state.
- Proof generation runs in the browser with `/circuits/compliance.wasm`, `/circuits/compliance_final.zkey`, and `snarkjs`.
- Emergency withdrawals use a 72-hour timelock everywhere in product copy and UI.
- Vault accounting is share-based, so yield accrues through share price rather than rebasing balances.

## Hackathon Scope vs Production Scope

| Component | Hackathon | Production |
|---|---|---|
| Tree capacity | 1,048,576 leaves (depth 20 target) | Same or deeper |
| Tree storage | `KycRegistry` + `StateTree` + `CredentialLeaf` PDA fallback | Light Protocol / Photon-backed proof retrieval |
| Credential storage | Browser localStorage | Encrypted vault / HSM / Fireblocks |
| Issuer model | Single issuer (AMINA) | Multi-issuer whitelist |
| Custody | Self-custody / PDA-led demo flow | Fireblocks MPC wallet |
| Governance | Single authority key | Squads Protocol multisig |
| Yield source | Simulated / not wired | Kamino / marginfi / Solstice allowlist |
| KYC validation | Browser-staged credential demo | AMINA Bank operator issuance pipeline |
| Circuit thresholds | Governable via public inputs | Same plus circuit version management |
| Proof generation | Browser WASM when artifacts exist | Browser WASM plus optional managed proving |
| Network | Solana devnet | Solana mainnet |

## Program IDs

These IDs come from the committed deploy keypairs and are the same across localnet and devnet deployments:

| Program | Address |
|---|---|
| `kyc_registry` | `NsgKr1qCEUb1vXdwaGvbz3ygG4R4SCrUQm3T8tHoqgD` |
| `vusd_vault` | `CUxwkHjKjGyKa5H1qEQySw98yKn33RZFxc9TbVgU6rdu` |
| `compliance_admin` | `BsEMZCJzj3SqwSj6z2F3X8m9rFHjLubgBzMeSgj8Lp6K` |

## Devnet Status

As of March 15, 2026:

- `kyc_registry` is deployed on devnet.
- `compliance_admin` is deployed on devnet.
- `vusd_vault` deployment is blocked by devnet SOL funding limits during `solana program deploy`.
- The devnet registry was initialized and a test credential leaf was added with `scripts/create-devnet-credentials.sh`.

## Production Roadmap

### Phase 1

- Land the new verifier and KYC registry interfaces from the program agents.
- Replace browser-staged credential issuance with operator-authorized registry writes.
- Ship real transfer record enrichment once the updated account layouts are final.

### Phase 2

- Move credential custody out of browser storage and into secure institutional storage.
- Add Squads-based governance and operational approval flows.
- Integrate whitelisted yield venues and real share-price accounting.

### Phase 3

- Add multi-issuer support and issuer governance policy.
- Add optional managed proving for slower client devices.
- Move from devnet pilot to mainnet deployment with formal operational controls.

## Documentation

- [Production roadmap](docs/production-roadmap.md)
- [ADR-001 Trusted Authority for KYC Registry](docs/adr-001-trusted-authority-kyc-registry.md)
- [ADR-002 Light Protocol for Merkle Tree Storage](docs/adr-002-light-protocol-storage.md)
- [ADR-003 Tokenized Vault Shares Model](docs/adr-003-tokenized-vault-shares.md)
- [ADR-004 Browser-Based Proof Generation](docs/adr-004-browser-proof-generation.md)
- [ADR-005 ElGamal Trapdoor Inside Circuit](docs/adr-005-elgamal-trapdoor.md)
- [ADR-006 Wallet-Bound Credentials](docs/adr-006-wallet-bound-credentials.md)

## Frontend

The frontend lives in [`app`](app) and now includes:

- Real routing for home, credential, deposit, transfer, withdraw, dashboard, and compliance views
- Live read hooks for vault state, registry state, and transfer records
- Browser-side proof lifecycle wiring without fake timer animations
- Cluster config files for localnet and devnet under `app/.env.local` and `app/.env.devnet`
- Updated branding and privacy copy aligned with the addendum

Run it with:

```bash
cd app
npm install
npm test
npm run build
```

Use devnet mode with:

```bash
cd app
npm run dev -- --mode devnet
```
