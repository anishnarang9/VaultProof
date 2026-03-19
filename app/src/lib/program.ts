import {
  AnchorProvider,
  BN,
  BorshAccountsCoder,
  BorshInstructionCoder,
  Program,
  type Idl,
} from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import { Buffer } from 'buffer/';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { bytesToBigInt, bigintToBytes } from './crypto';
import { getCredentialMerkleProof } from './merkle';

export const VUSD_VAULT_PROGRAM_ID = new PublicKey(
  'BQBzU5JXU9oBkezAqcnaRht4abWhKyqfYW3B2k5vAizT',
);
export const KYC_REGISTRY_PROGRAM_ID = new PublicKey(
  'zeKuZBjVPQaGhsjLQDQ33K8piMDPZ8W7g8vUobNYZTR',
);
export const COMPLIANCE_ADMIN_PROGRAM_ID = new PublicKey(
  'rcSKMdzuL7LLuTh322WXWiteSbqVPe5cR2hGDCNWtu4',
);
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/** Groth16 on-chain verification requires ~1.4M compute units (default is 200K). */
const PROOF_VERIFY_COMPUTE_UNITS = 1_400_000;
const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111');

/** Build a SetComputeUnitLimit instruction without ComputeBudgetProgram (avoids Buffer polyfill issues). */
function computeUnitLimitIx(units: number): TransactionInstruction {
  const data = new Uint8Array(5);
  data[0] = 2; // SetComputeUnitLimit instruction index
  data[1] = units & 0xff;
  data[2] = (units >> 8) & 0xff;
  data[3] = (units >> 16) & 0xff;
  data[4] = (units >> 24) & 0xff;
  return new TransactionInstruction({
    keys: [],
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    data: data as unknown as globalThis.Buffer,
  });
}
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

const NUM_PUBLIC_INPUTS = 22;
const STATE_TREE_DEPTH = 20;
const textEncoder = new TextEncoder();
const IS_TEST_MODE = import.meta.env.MODE === 'test';
const TEST_VAULT_STATE_PDA = new PublicKey('CFfJc2twicWbCwyZX2s7VZmtda6grkE2GYNNJkNF2hDo');
const TEST_USDC_RESERVE_PDA = new PublicKey('GYTpXKDQuZCTHW1Fg2Bs5Mz2rJXqZAMRZ33ie4be6GxM');
const TEST_KYC_REGISTRY_PDA = new PublicKey('EY9cnxuWA3K5iDy1pLdN3GrLmd4Jh4BiKoR7Qj7QKRUY');
const TEST_STATE_TREE_PDA = new PublicKey('8MgBPHCkeQitSpWQUNT6SrqGBMyuWZ7aLAEWsfktzwsK');
const globalWithNodeShims = globalThis as {
  Buffer?: unknown;
  global?: typeof globalThis;
  process?: { env?: Record<string, string> };
};

if (!globalWithNodeShims.Buffer) {
  globalWithNodeShims.Buffer = Buffer;
}

if (!globalWithNodeShims.global) {
  globalWithNodeShims.global = globalThis;
}

if (!globalWithNodeShims.process) {
  globalWithNodeShims.process = { env: {} };
} else if (!globalWithNodeShims.process.env) {
  globalWithNodeShims.process.env = {};
}

const vaultProgramIdl = {
  address: VUSD_VAULT_PROGRAM_ID.toBase58(),
  metadata: {
    name: 'vusd_vault',
    version: '0.1.0',
    spec: '0.1.0',
  },
  instructions: [
    {
      name: 'store_proof_data',
      discriminator: [197, 4, 208, 120, 135, 236, 234, 117],
      accounts: [
        { name: 'proof_buffer', writable: true },
        { name: 'payer', writable: true, signer: true },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
      ],
      args: [
        { name: 'proof_a', type: { array: ['u8', 64] } },
        { name: 'proof_b', type: { array: ['u8', 128] } },
        { name: 'proof_c', type: { array: ['u8', 64] } },
        { name: 'public_inputs', type: { array: [{ array: ['u8', 32] }, NUM_PUBLIC_INPUTS] } },
      ],
    },
    {
      name: 'deposit_with_proof',
      discriminator: [243, 59, 31, 140, 239, 132, 57, 225],
      accounts: [
        { name: 'vault_state', writable: true },
        { name: 'kyc_registry' },
        { name: 'risk_oracle' },
        { name: 'address_risk_score', optional: true },
        { name: 'usdc_mint', writable: true },
        { name: 'share_mint', writable: true },
        { name: 'user_usdc_account', writable: true },
        { name: 'usdc_reserve', writable: true },
        { name: 'stealth_share_account', writable: true },
        { name: 'proof_buffer', writable: true },
        { name: 'transfer_record', writable: true },
        { name: 'user', writable: true, signer: true },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
        { name: 'token_program' },
      ],
      args: [
        { name: 'amount', type: 'u64' },
        { name: 'mandate_id', type: { array: ['u8', 32] } },
      ],
    },
    {
      name: 'transfer_with_proof',
      discriminator: [152, 0, 87, 246, 128, 111, 141, 224],
      accounts: [
        { name: 'vault_state' },
        { name: 'kyc_registry' },
        { name: 'risk_oracle' },
        { name: 'address_risk_score', optional: true },
        { name: 'share_mint' },
        { name: 'sender_stealth_account', writable: true },
        { name: 'recipient_stealth_account', writable: true },
        { name: 'proof_buffer', writable: true },
        { name: 'transfer_record', writable: true },
        { name: 'sender', writable: true, signer: true },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
        { name: 'token_program' },
      ],
      args: [
        { name: 'amount', type: 'u64' },
        { name: 'mandate_id', type: { array: ['u8', 32] } },
      ],
    },
    {
      name: 'withdraw_with_proof',
      discriminator: [241, 211, 6, 55, 85, 225, 224, 97],
      accounts: [
        { name: 'vault_state', writable: true },
        { name: 'kyc_registry' },
        { name: 'risk_oracle' },
        { name: 'address_risk_score', optional: true },
        { name: 'usdc_mint' },
        { name: 'share_mint', writable: true },
        { name: 'usdc_reserve', writable: true },
        { name: 'stealth_share_account', writable: true },
        { name: 'user_usdc_account', writable: true },
        { name: 'proof_buffer', writable: true },
        { name: 'transfer_record', writable: true },
        { name: 'stealth_owner', writable: true, signer: true },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
        { name: 'token_program' },
      ],
      args: [
        { name: 'amount', type: 'u64' },
        { name: 'mandate_id', type: { array: ['u8', 32] } },
      ],
    },
    {
      name: 'request_emergency_withdrawal',
      discriminator: [229, 149, 36, 233, 90, 75, 55, 202],
      accounts: [
        { name: 'vault_state' },
        { name: 'emergency', writable: true },
        { name: 'stealth_share_account' },
        { name: 'requester', writable: true, signer: true },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
    {
      name: 'execute_emergency_withdrawal',
      discriminator: [6, 138, 50, 154, 178, 103, 180, 192],
      accounts: [
        { name: 'vault_state', writable: true },
        { name: 'emergency', writable: true },
        { name: 'share_mint', writable: true },
        { name: 'usdc_mint' },
        { name: 'usdc_reserve', writable: true },
        { name: 'stealth_share_account', writable: true },
        { name: 'requester_usdc_account', writable: true },
        { name: 'requester', writable: true, signer: true },
        { name: 'token_program' },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
      ],
      args: [],
    },
    {
      name: 'update_risk_limits',
      discriminator: [48, 53, 83, 216, 119, 29, 74, 182],
      accounts: [
        { name: 'vault_state', writable: true },
        { name: 'authority', signer: true },
      ],
      args: [
        { name: 'circuit_breaker_threshold', type: 'u64' },
        { name: 'max_single_transaction', type: 'u64' },
        { name: 'max_single_deposit', type: 'u64' },
        { name: 'max_daily_transactions', type: 'u32' },
      ],
    },
    {
      name: 'unpause_vault',
      discriminator: [125, 29, 213, 213, 114, 155, 125, 63],
      accounts: [
        { name: 'vault_state', writable: true },
        { name: 'authority', signer: true },
      ],
      args: [],
    },
    {
      name: 'add_yield_venue',
      discriminator: [154, 2, 62, 195, 82, 190, 63, 8],
      accounts: [
        { name: 'vault_state', writable: true },
        { name: 'yield_venue', writable: true },
        { name: 'authority', writable: true, signer: true },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
      ],
      args: [
        { name: 'venue_address', type: 'pubkey' },
        { name: 'name', type: 'string' },
        { name: 'jurisdiction_whitelist', type: { array: ['u8', 32] } },
        { name: 'allocation_cap_bps', type: 'u16' },
        { name: 'risk_rating', type: 'u8' },
      ],
    },
    {
      name: 'remove_yield_venue',
      discriminator: [27, 11, 126, 231, 154, 110, 203, 229],
      accounts: [
        { name: 'vault_state', writable: true },
        { name: 'yield_venue', writable: true },
        { name: 'authority', writable: true, signer: true },
      ],
      args: [],
    },
    {
      name: 'accrue_yield',
      discriminator: [243, 28, 81, 65, 175, 178, 5, 112],
      accounts: [
        { name: 'vault_state', writable: true },
        { name: 'authority', signer: true },
      ],
      args: [
        { name: 'yield_amount', type: 'u64' },
      ],
    },
    {
      name: 'setup_confidential_vault',
      discriminator: [163, 150, 49, 113, 33, 125, 177, 102],
      accounts: [
        { name: 'vault_state' },
        { name: 'confidential_config', writable: true },
        { name: 'confidential_share_mint' },
        { name: 'authority', writable: true, signer: true },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
      ],
      args: [
        { name: 'auditor_elgamal_pubkey', type: { array: ['u8', 32] } },
      ],
    },
    {
      name: 'convert_to_confidential',
      discriminator: [235, 138, 113, 23, 188, 100, 126, 167],
      accounts: [
        { name: 'vault_state', writable: true },
        { name: 'confidential_config', writable: true },
        { name: 'share_mint', writable: true },
        { name: 'confidential_share_mint', writable: true },
        { name: 'user_share_account', writable: true },
        { name: 'user_confidential_account', writable: true },
        { name: 'user', writable: true, signer: true },
        { name: 'token_program' },
        { name: 'confidential_token_program' },
      ],
      args: [
        { name: 'amount', type: 'u64' },
      ],
    },
    {
      name: 'convert_from_confidential',
      discriminator: [6, 87, 4, 59, 160, 140, 109, 71],
      accounts: [
        { name: 'vault_state', writable: true },
        { name: 'confidential_config', writable: true },
        { name: 'share_mint', writable: true },
        { name: 'confidential_share_mint', writable: true },
        { name: 'user_share_account', writable: true },
        { name: 'user_confidential_account', writable: true },
        { name: 'user', writable: true, signer: true },
        { name: 'token_program' },
        { name: 'confidential_token_program' },
      ],
      args: [
        { name: 'amount', type: 'u64' },
      ],
    },
  ],
  accounts: [
    {
      name: 'vaultState',
      discriminator: [228, 196, 82, 165, 98, 210, 235, 152],
    },
  ],
  types: [
    {
      name: 'vaultState',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'pubkey' },
          { name: 'usdcMint', type: 'pubkey' },
          { name: 'shareMint', type: 'pubkey' },
          { name: 'usdcReserve', type: 'pubkey' },
          { name: 'totalAssets', type: 'u64' },
          { name: 'totalShares', type: 'u64' },
          { name: 'sharePriceNumerator', type: 'u64' },
          { name: 'sharePriceDenominator', type: 'u64' },
          { name: 'yieldSource', type: 'pubkey' },
          { name: 'liquidBufferBps', type: 'u16' },
          { name: 'totalYieldEarned', type: 'u64' },
          { name: 'amlThresholds', type: { array: ['u64', 3] } },
          { name: 'expiredThreshold', type: 'u64' },
          { name: 'emergencyTimelock', type: 'i64' },
          { name: 'regulatorPubkeyX', type: { array: ['u8', 32] } },
          { name: 'regulatorPubkeyY', type: { array: ['u8', 32] } },
          { name: 'bump', type: 'u8' },
          { name: 'reserveBump', type: 'u8' },
        ],
      },
    },
  ],
} as const satisfies Idl;

const kycRegistryIdl = {
  address: KYC_REGISTRY_PROGRAM_ID.toBase58(),
  metadata: {
    name: 'kyc_registry',
    version: '0.1.0',
    spec: '0.1.0',
  },
  instructions: [
    {
      name: 'add_credential',
      discriminator: [227, 73, 113, 139, 17, 230, 192, 146],
      accounts: [
        { name: 'registry', writable: true },
        { name: 'state_tree', writable: true },
        { name: 'credential_leaf', writable: true },
        { name: 'authority', writable: true, signer: true },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
      ],
      args: [
        { name: 'leaf_hash', type: { array: ['u8', 32] } },
        { name: 'merkle_proof', type: { vec: { array: ['u8', 32] } } },
      ],
    },
  ],
} as const satisfies Idl;

const complianceAdminIdl = {
  address: COMPLIANCE_ADMIN_PROGRAM_ID.toBase58(),
  metadata: {
    name: 'compliance_admin',
    version: '0.1.0',
    spec: '0.1.0',
  },
  instructions: [
    {
      name: 'authorize_decryption',
      discriminator: [114, 245, 30, 117, 209, 140, 74, 121],
      accounts: [
        { name: 'decryption_auth', writable: true },
        { name: 'vault_state', writable: true },
        { name: 'transfer_record', writable: true },
        { name: 'authority', writable: true, signer: true },
        { name: 'vusd_vault_program', address: VUSD_VAULT_PROGRAM_ID.toBase58() },
        { name: 'system_program', address: SystemProgram.programId.toBase58() },
      ],
      args: [{ name: 'reason_hash', type: { array: ['u8', 32] } }],
    },
  ],
} as const satisfies Idl;

const registryAccountsIdl = {
  version: '0.1.0',
  name: 'kycRegistryAccounts',
  accounts: [
    {
      name: 'stateTree',
      discriminator: [93, 3, 106, 105, 49, 120, 84, 187],
    },
  ],
  types: [
    {
      name: 'stateTree',
      type: {
        kind: 'struct',
        fields: [
          { name: 'registry', type: 'pubkey' },
          { name: 'root', type: { array: ['u8', 32] } },
          { name: 'depth', type: 'u8' },
          { name: 'nextIndex', type: 'u32' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
} as unknown as Idl;

const vaultAccountsCoder = new BorshAccountsCoder(vaultProgramIdl);
const registryAccountsCoder = new BorshAccountsCoder(registryAccountsIdl);

type VaultStateAccount = {
  authority: PublicKey;
  usdcMint: PublicKey;
  shareMint: PublicKey;
  usdcReserve: PublicKey;
  reserveBump: number;
  bump: number;
};

type Programs = {
  kycRegistry: Program<Idl>;
  vusdVault: Program<Idl>;
  complianceAdmin: Program<Idl>;
};

function toSeed(seed: PublicKey | string | Uint8Array) {
  if (typeof seed === 'string') {
    return Buffer.from(textEncoder.encode(seed));
  }

  return Buffer.from(seed instanceof PublicKey ? seed.toBytes() : seed);
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function deriveTestAddress(programId: PublicKey, seeds: Uint8Array[]) {
  const bytes = new Uint8Array(32);
  const parts = [programId.toBytes(), ...seeds];

  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex];

    for (let index = 0; index < part.length; index += 1) {
      bytes[(index + partIndex) % 32] =
        (bytes[(index + partIndex) % 32] + part[index] + partIndex + 1) & 0xff;
    }
  }

  if (bytes.every((value) => value === 0)) {
    bytes[0] = 1;
  }

  return new PublicKey(bytes);
}

function deriveAssociatedTokenAddress(owner: PublicKey, mint: PublicKey) {
  if (IS_TEST_MODE) {
    return deriveTestAddress(ASSOCIATED_TOKEN_PROGRAM_ID, [
      owner.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ]);
  }

  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export function deriveOwnedTokenAddress(owner: PublicKey, mint: PublicKey) {
  return deriveAssociatedTokenAddress(owner, mint);
}

function maybeDeriveTestPda(programId: PublicKey, seeds: Uint8Array[]) {
  if (!IS_TEST_MODE) {
    return null;
  }

  if (
    programId.equals(VUSD_VAULT_PROGRAM_ID) &&
    seeds.length === 1 &&
    bytesEqual(seeds[0], Buffer.from('vault_state'))
  ) {
    return TEST_VAULT_STATE_PDA;
  }

  if (
    programId.equals(VUSD_VAULT_PROGRAM_ID) &&
    seeds.length === 1 &&
    bytesEqual(seeds[0], Buffer.from('usdc_reserve'))
  ) {
    return TEST_USDC_RESERVE_PDA;
  }

  if (
    programId.equals(KYC_REGISTRY_PROGRAM_ID) &&
    seeds.length === 1 &&
    bytesEqual(seeds[0], Buffer.from('kyc_registry'))
  ) {
    return TEST_KYC_REGISTRY_PDA;
  }

  if (
    programId.equals(KYC_REGISTRY_PROGRAM_ID) &&
    seeds.length === 2 &&
    bytesEqual(seeds[0], Buffer.from('state_tree')) &&
    bytesEqual(seeds[1], TEST_KYC_REGISTRY_PDA.toBuffer())
  ) {
    return TEST_STATE_TREE_PDA;
  }

  return deriveTestAddress(programId, seeds);
}

function derivePda(programId: PublicKey, ...seeds: Array<PublicKey | string | Uint8Array>) {
  const normalizedSeeds = seeds.map(toSeed);
  return maybeDeriveTestPda(programId, normalizedSeeds) ??
    PublicKey.findProgramAddressSync(normalizedSeeds, programId)[0];
}

function createAssociatedTokenAccountIx(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0) as never,
  });
}

export function deriveVaultStatePda() {
  return derivePda(VUSD_VAULT_PROGRAM_ID, 'vault_state');
}

export function deriveUsdcReservePda() {
  return derivePda(VUSD_VAULT_PROGRAM_ID, 'usdc_reserve');
}

export function deriveRiskOraclePda() {
  return derivePda(VUSD_VAULT_PROGRAM_ID, 'risk_oracle', deriveVaultStatePda());
}

export function deriveProofBufferPda(owner: PublicKey) {
  return derivePda(VUSD_VAULT_PROGRAM_ID, 'proof_buffer', owner);
}

export function deriveTransferRecordPda(proofHash: Uint8Array) {
  return derivePda(VUSD_VAULT_PROGRAM_ID, 'transfer_record', proofHash);
}

export function deriveEmergencyWithdrawalPda(owner: PublicKey) {
  return derivePda(VUSD_VAULT_PROGRAM_ID, 'emergency', owner);
}

export function deriveRegistryPda() {
  return derivePda(KYC_REGISTRY_PROGRAM_ID, 'kyc_registry');
}

export function deriveStateTreePda(registry: PublicKey) {
  return derivePda(KYC_REGISTRY_PROGRAM_ID, 'state_tree', registry);
}

export function deriveCredentialLeafPda(leafHash: Uint8Array) {
  return derivePda(KYC_REGISTRY_PROGRAM_ID, 'credential_leaf', deriveRegistryPda(), leafHash);
}

export function deriveDecryptionAuthorizationPda(transferRecord: PublicKey) {
  return derivePda(COMPLIANCE_ADMIN_PROGRAM_ID, 'decryption_auth', transferRecord);
}

export function deriveYieldVenuePda(vaultState: PublicKey, venueAddress: PublicKey) {
  return derivePda(VUSD_VAULT_PROGRAM_ID, 'yield_venue', vaultState, venueAddress);
}

export function deriveConfidentialConfigPda(vaultState: PublicKey) {
  return derivePda(VUSD_VAULT_PROGRAM_ID, 'confidential_config', vaultState);
}

function createProvider(connection: Connection, wallet: AnchorWallet) {
  return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}

export function getPrograms(connection: Connection, wallet: AnchorWallet): Programs {
  const provider = createProvider(connection, wallet);

  return {
    kycRegistry: new Program(kycRegistryIdl, provider),
    vusdVault: new Program(vaultProgramIdl, provider),
    complianceAdmin: new Program(complianceAdminIdl, provider),
  };
}

function normalizePublicKey(value: unknown) {
  if (value instanceof PublicKey) {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    return new PublicKey(value);
  }

  if (value && typeof value === 'object' && 'toBase58' in value) {
    return new PublicKey((value as { toBase58(): string }).toBase58());
  }

  throw new Error('Unable to normalize public key.');
}

function decodeAccount<T>(coder: BorshAccountsCoder, accountName: string, data: Uint8Array): T {
  return coder.decode(accountName, data as never) as T;
}

async function fetchAccountInfo(connection: Connection, address: PublicKey) {
  const info = await connection.getAccountInfo(address);

  if (!info) {
    throw new Error(`Missing account ${address.toBase58()}.`);
  }

  return Buffer.from(info.data);
}

async function fetchVaultState(program: Program<Idl>): Promise<VaultStateAccount> {
  const raw = decodeAccount<Record<string, unknown>>(
    vaultAccountsCoder,
    'vaultState',
    await fetchAccountInfo(program.provider.connection, deriveVaultStatePda()),
  );

  return {
    authority: normalizePublicKey(raw.authority),
    usdcMint: normalizePublicKey(raw.usdcMint),
    shareMint: normalizePublicKey(raw.shareMint),
    usdcReserve: normalizePublicKey(raw.usdcReserve),
    reserveBump: Number(raw.reserveBump ?? 0),
    bump: Number(raw.bump ?? 0),
  };
}

async function fetchStateTree(program: Program<Idl>) {
  const registry = deriveRegistryPda();
  const raw = decodeAccount<Record<string, unknown>>(
    registryAccountsCoder,
    'stateTree',
    await fetchAccountInfo(program.provider.connection, deriveStateTreePda(registry)),
  );

  return {
    nextIndex: Number(raw.nextIndex ?? 0),
  };
}

function getInstructionCoder(program: Program<Idl>) {
  return new BorshInstructionCoder(program.rawIdl);
}

function createInstruction(
  program: Program<Idl>,
  name: string,
  args: Record<string, unknown>,
  keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>,
) {
  return new TransactionInstruction({
    data: getInstructionCoder(program).encode(name, args),
    keys,
    programId: program.programId,
  });
}

function ensureProofLength<T>(proof: T[], expectedLength: number, label: string) {
  if (proof.length !== expectedLength) {
    throw new Error(`${label} must contain ${expectedLength} bytes.`);
  }

  return proof.map((value) => Number(value));
}

function normalizeProofInputs(publicInputs: number[][]) {
  if (publicInputs.length !== NUM_PUBLIC_INPUTS) {
    throw new Error(`publicInputs must contain ${NUM_PUBLIC_INPUTS} field elements.`);
  }

  return publicInputs.map((input, index) => {
    if (input.length !== 32) {
      throw new Error(`public input ${index} must contain 32 bytes.`);
    }

    return input.map((value) => Number(value));
  });
}

async function sha256(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for transaction hashing.');
  }

  const payload = bytes.slice();
  return new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', payload.buffer as ArrayBuffer),
  );
}

async function computeProofHash(proofA: number[], proofB: number[], proofC: number[]) {
  return sha256(Uint8Array.from([...proofA, ...proofB, ...proofC]));
}

async function ensureAta(
  transaction: Transaction,
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
) {
  const ata = deriveAssociatedTokenAddress(owner, mint);
  const accountInfo = await connection.getAccountInfo(ata);

  if (!accountInfo) {
    transaction.add(
      createAssociatedTokenAccountIx(
        payer,
        ata,
        owner,
        mint,
      ),
    );
  }

  return ata;
}

function amountToArg(value: BN) {
  return value;
}

function bytes32(value: bigint | Uint8Array | number[]) {
  if (typeof value === 'bigint') {
    return Array.from(bigintToBytes(value, 32));
  }

  const bytes = value instanceof Uint8Array ? Array.from(value) : value;
  if (bytes.length !== 32) {
    throw new Error('Expected 32 bytes.');
  }
  return bytes.map((byte) => Number(byte));
}

function proofArgs(
  proofA: number[],
  proofB: number[],
  proofC: number[],
  publicInputs: number[][],
) {
  return {
    proof_a: ensureProofLength(proofA, 64, 'proofA'),
    proof_b: ensureProofLength(proofB, 128, 'proofB'),
    proof_c: ensureProofLength(proofC, 64, 'proofC'),
    public_inputs: normalizeProofInputs(publicInputs),
  };
}

async function createVaultProofInstructions(
  program: Program<Idl>,
  signer: PublicKey,
  proofA: number[],
  proofB: number[],
  proofC: number[],
  publicInputs: number[][],
) {
  const proofBuffer = deriveProofBufferPda(signer);
  const proofHash = await computeProofHash(proofA, proofB, proofC);
  const transferRecord = deriveTransferRecordPda(proofHash);

  return {
    proofBuffer,
    proofHash,
    storeProofInstruction: createInstruction(program, 'store_proof_data', proofArgs(proofA, proofB, proofC, publicInputs), [
      { pubkey: proofBuffer, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]),
    transferRecord,
  };
}

export function proofToOnchainFormat(
  proof: unknown,
  publicSignals: string[],
) {
  const parsed = proof as {
    pi_a: [string, string, string];
    pi_b: [[string, string], [string, string], [string, string]];
    pi_c: [string, string, string];
  };

  const proofA = [
    ...bytes32(BigInt(parsed.pi_a[0])),
    ...bytes32(BigInt(parsed.pi_a[1])),
  ];
  const proofB = [
    ...bytes32(BigInt(parsed.pi_b[0][1])),
    ...bytes32(BigInt(parsed.pi_b[0][0])),
    ...bytes32(BigInt(parsed.pi_b[1][1])),
    ...bytes32(BigInt(parsed.pi_b[1][0])),
  ];
  const proofC = [
    ...bytes32(BigInt(parsed.pi_c[0])),
    ...bytes32(BigInt(parsed.pi_c[1])),
  ];
  const normalizedPublicInputs = publicSignals.map((signal) => bytes32(BigInt(signal)));

  return {
    proofA,
    proofB,
    proofC,
    publicInputs: normalizedPublicInputs,
  };
}

export async function buildDepositTx(params: {
  program: Program<Idl>;
  proofA: number[];
  proofB: number[];
  proofC: number[];
  publicInputs: number[][];
  amount: BN;
  encryptedMetadata: Uint8Array;
  signer: PublicKey;
}): Promise<{ storeProofTx: Transaction; depositTx: Transaction }> {
  const { program, proofA, proofB, proofC, publicInputs, amount, signer } = params;
  const connection = program.provider.connection;
  const vaultState = await fetchVaultState(program);
  const registry = deriveRegistryPda();
  const { proofBuffer, storeProofInstruction, transferRecord } =
    await createVaultProofInstructions(program, signer, proofA, proofB, proofC, publicInputs);

  // Transaction 1: Store proof data in buffer PDA
  const storeProofTx = new Transaction();
  storeProofTx.add(storeProofInstruction);

  // Transaction 2: Deposit referencing the proof buffer
  const depositTx = new Transaction();
  depositTx.add(computeUnitLimitIx(PROOF_VERIFY_COMPUTE_UNITS));
  const userUsdcAccount = await ensureAta(
    depositTx,
    connection,
    signer,
    signer,
    vaultState.usdcMint,
  );
  const stealthShareAccount = await ensureAta(
    depositTx,
    connection,
    signer,
    signer,
    vaultState.shareMint,
  );

  depositTx.add(
    createInstruction(
      program,
      'deposit_with_proof',
      { amount: amountToArg(amount), mandate_id: Array.from({ length: 32 }, () => 0) },
      [
        // Account order must match IDL exactly
        { pubkey: deriveVaultStatePda(), isSigner: false, isWritable: true },
        { pubkey: registry, isSigner: false, isWritable: false },
        { pubkey: deriveRiskOraclePda(), isSigner: false, isWritable: false },
        { pubkey: VUSD_VAULT_PROGRAM_ID, isSigner: false, isWritable: false }, // address_risk_score (optional: None)
        { pubkey: vaultState.usdcMint, isSigner: false, isWritable: true },
        { pubkey: vaultState.shareMint, isSigner: false, isWritable: true },
        { pubkey: userUsdcAccount, isSigner: false, isWritable: true },
        { pubkey: vaultState.usdcReserve, isSigner: false, isWritable: true },
        { pubkey: stealthShareAccount, isSigner: false, isWritable: true },
        { pubkey: proofBuffer, isSigner: false, isWritable: true },
        { pubkey: transferRecord, isSigner: false, isWritable: true },
        { pubkey: signer, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    ),
  );

  return { storeProofTx, depositTx };
}

export async function buildTransferTx(params: {
  program: Program<Idl>;
  proofA: number[];
  proofB: number[];
  proofC: number[];
  publicInputs: number[][];
  amount: BN;
  encryptedMetadata: Uint8Array;
  recipient: PublicKey;
  signer: PublicKey;
}): Promise<{ storeProofTx: Transaction; transferTx: Transaction }> {
  const { program, proofA, proofB, proofC, publicInputs, amount, recipient, signer } = params;
  const connection = program.provider.connection;
  const vaultState = await fetchVaultState(program);
  const registry = deriveRegistryPda();
  const { proofBuffer, storeProofInstruction, transferRecord } =
    await createVaultProofInstructions(program, signer, proofA, proofB, proofC, publicInputs);

  // Transaction 1: Store proof data in buffer PDA
  const storeProofTx = new Transaction();
  storeProofTx.add(storeProofInstruction);

  // Transaction 2: Transfer referencing the proof buffer
  const transferTx = new Transaction();
  transferTx.add(computeUnitLimitIx(PROOF_VERIFY_COMPUTE_UNITS));
  const senderStealthAccount = await ensureAta(
    transferTx,
    connection,
    signer,
    signer,
    vaultState.shareMint,
  );
  const recipientStealthAccount = await ensureAta(
    transferTx,
    connection,
    signer,
    recipient,
    vaultState.shareMint,
  );

  transferTx.add(
    createInstruction(
      program,
      'transfer_with_proof',
      { amount: amountToArg(amount), mandate_id: Array.from({ length: 32 }, () => 0) },
      [
        // Account order must match IDL exactly
        { pubkey: deriveVaultStatePda(), isSigner: false, isWritable: false },
        { pubkey: registry, isSigner: false, isWritable: false },
        { pubkey: deriveRiskOraclePda(), isSigner: false, isWritable: false },
        { pubkey: VUSD_VAULT_PROGRAM_ID, isSigner: false, isWritable: false }, // address_risk_score (optional: None)
        { pubkey: vaultState.shareMint, isSigner: false, isWritable: false },
        { pubkey: senderStealthAccount, isSigner: false, isWritable: true },
        { pubkey: recipientStealthAccount, isSigner: false, isWritable: true },
        { pubkey: proofBuffer, isSigner: false, isWritable: true },
        { pubkey: transferRecord, isSigner: false, isWritable: true },
        { pubkey: signer, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    ),
  );

  return { storeProofTx, transferTx };
}

export async function buildWithdrawTx(params: {
  program: Program<Idl>;
  proofA: number[];
  proofB: number[];
  proofC: number[];
  publicInputs: number[][];
  shares: BN;
  signer: PublicKey;
}): Promise<{ storeProofTx: Transaction; withdrawTx: Transaction }> {
  const { program, proofA, proofB, proofC, publicInputs, shares, signer } = params;
  const connection = program.provider.connection;
  const vaultState = await fetchVaultState(program);
  const registry = deriveRegistryPda();
  const { proofBuffer, storeProofInstruction, transferRecord } =
    await createVaultProofInstructions(program, signer, proofA, proofB, proofC, publicInputs);

  // Transaction 1: Store proof data in buffer PDA
  const storeProofTx = new Transaction();
  storeProofTx.add(storeProofInstruction);

  // Transaction 2: Withdraw referencing the proof buffer
  const withdrawTx = new Transaction();
  withdrawTx.add(computeUnitLimitIx(PROOF_VERIFY_COMPUTE_UNITS));
  const stealthShareAccount = await ensureAta(
    withdrawTx,
    connection,
    signer,
    signer,
    vaultState.shareMint,
  );
  const userUsdcAccount = await ensureAta(
    withdrawTx,
    connection,
    signer,
    signer,
    vaultState.usdcMint,
  );

  withdrawTx.add(
    createInstruction(
      program,
      'withdraw_with_proof',
      { amount: amountToArg(shares), mandate_id: Array.from({ length: 32 }, () => 0) },
      [
        // Account order must match IDL exactly
        { pubkey: deriveVaultStatePda(), isSigner: false, isWritable: true },
        { pubkey: registry, isSigner: false, isWritable: false },
        { pubkey: deriveRiskOraclePda(), isSigner: false, isWritable: false },
        { pubkey: VUSD_VAULT_PROGRAM_ID, isSigner: false, isWritable: false }, // address_risk_score (optional: None)
        { pubkey: vaultState.usdcMint, isSigner: false, isWritable: false },
        { pubkey: vaultState.shareMint, isSigner: false, isWritable: true },
        { pubkey: vaultState.usdcReserve, isSigner: false, isWritable: true },
        { pubkey: stealthShareAccount, isSigner: false, isWritable: true },
        { pubkey: userUsdcAccount, isSigner: false, isWritable: true },
        { pubkey: proofBuffer, isSigner: false, isWritable: true },
        { pubkey: transferRecord, isSigner: false, isWritable: true },
        { pubkey: signer, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    ),
  );

  return { storeProofTx, withdrawTx };
}

async function fetchTokenBalance(connection: Connection, tokenAccount: PublicKey) {
  const balance = await connection.getTokenAccountBalance(tokenAccount);
  return balance.value.amount;
}

export async function buildEmergencyWithdrawRequestTx(params: {
  program: Program<Idl>;
  stealthAccount: PublicKey;
  signer: PublicKey;
}) {
  const { program, stealthAccount, signer } = params;
  const shares = await fetchTokenBalance(program.provider.connection, stealthAccount);

  return new Transaction().add(
    createInstruction(program, 'request_emergency_withdrawal', { amount: new BN(shares) }, [
      { pubkey: deriveVaultStatePda(), isSigner: false, isWritable: false },
      { pubkey: deriveEmergencyWithdrawalPda(signer), isSigner: false, isWritable: true },
      { pubkey: stealthAccount, isSigner: false, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]),
  );
}

export async function buildEmergencyWithdrawExecuteTx(params: {
  program: Program<Idl>;
  stealthAccount: PublicKey;
  signer: PublicKey;
}) {
  const { program, stealthAccount, signer } = params;
  const vaultState = await fetchVaultState(program);
  const requesterUsdcAccount = deriveAssociatedTokenAddress(signer, vaultState.usdcMint);

  return new Transaction().add(
    createInstruction(program, 'execute_emergency_withdrawal', {}, [
      { pubkey: deriveVaultStatePda(), isSigner: false, isWritable: true },
      { pubkey: deriveEmergencyWithdrawalPda(signer), isSigner: false, isWritable: true },
      { pubkey: vaultState.shareMint, isSigner: false, isWritable: true },
      { pubkey: vaultState.usdcMint, isSigner: false, isWritable: false },
      { pubkey: vaultState.usdcReserve, isSigner: false, isWritable: true },
      { pubkey: stealthAccount, isSigner: false, isWritable: true },
      { pubkey: requesterUsdcAccount, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]),
  );
}

export async function buildAddCredentialTx(params: {
  program: Program<Idl>;
  leafHash: number[];
  signer: PublicKey;
}) {
  const { program, leafHash, signer } = params;
  const registry = deriveRegistryPda();
  const stateTree = deriveStateTreePda(registry);
  const proof = await getCredentialMerkleProof(
    program.provider.connection,
    registry,
    bytesToBigInt(leafHash),
  );
  const leafHashBytes = bytes32(Uint8Array.from(leafHash));

  if (proof.pathElements.length !== STATE_TREE_DEPTH) {
    throw new Error(`Merkle proof must contain ${STATE_TREE_DEPTH} path elements.`);
  }

  return new Transaction().add(
    createInstruction(program, 'add_credential', {
      leaf_hash: leafHashBytes,
      merkle_proof: proof.pathElements.map((node) => bytes32(node)),
    }, [
      { pubkey: registry, isSigner: false, isWritable: true },
      { pubkey: stateTree, isSigner: false, isWritable: true },
      { pubkey: deriveCredentialLeafPda(Uint8Array.from(leafHashBytes)), isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]),
  );
}

async function buildReasonHash() {
  return bytes32(await sha256(textEncoder.encode('vaultproof:decryption-authorized')));
}

export async function buildAuthorizeDecryptionTx(params: {
  program: Program<Idl>;
  transferRecord: PublicKey;
  signer: PublicKey;
}) {
  const { program, transferRecord, signer } = params;

  return new Transaction().add(
    createInstruction(program, 'authorize_decryption', { reason_hash: await buildReasonHash() }, [
      {
        pubkey: deriveDecryptionAuthorizationPda(transferRecord),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: deriveVaultStatePda(), isSigner: false, isWritable: true },
      { pubkey: transferRecord, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: VUSD_VAULT_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]),
  );
}

export async function getCurrentLeafIndex(program: Program<Idl>) {
  const stateTree = await fetchStateTree(program);
  return stateTree.nextIndex;
}

// ── Admin transaction builders ──

export function buildUpdateRiskLimitsTx(params: {
  program: Program<Idl>;
  circuitBreakerThreshold: BN;
  maxSingleTransaction: BN;
  maxSingleDeposit: BN;
  maxDailyTransactions: number;
  signer: PublicKey;
}) {
  const { program, circuitBreakerThreshold, maxSingleTransaction, maxSingleDeposit, maxDailyTransactions, signer } = params;

  return new Transaction().add(
    createInstruction(program, 'update_risk_limits', {
      circuit_breaker_threshold: circuitBreakerThreshold,
      max_single_transaction: maxSingleTransaction,
      max_single_deposit: maxSingleDeposit,
      max_daily_transactions: maxDailyTransactions,
    }, [
      { pubkey: deriveVaultStatePda(), isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: false },
    ]),
  );
}

export function buildUnpauseVaultTx(params: {
  program: Program<Idl>;
  signer: PublicKey;
}) {
  return new Transaction().add(
    createInstruction(params.program, 'unpause_vault', {}, [
      { pubkey: deriveVaultStatePda(), isSigner: false, isWritable: true },
      { pubkey: params.signer, isSigner: true, isWritable: false },
    ]),
  );
}

export function buildAddYieldVenueTx(params: {
  program: Program<Idl>;
  venueAddress: PublicKey;
  name: string;
  jurisdictionWhitelist: number[];
  allocationCapBps: number;
  riskRating: number;
  signer: PublicKey;
}) {
  const { program, venueAddress, name, jurisdictionWhitelist, allocationCapBps, riskRating, signer } = params;
  const vaultStatePda = deriveVaultStatePda();

  return new Transaction().add(
    createInstruction(program, 'add_yield_venue', {
      venue_address: venueAddress,
      name,
      jurisdiction_whitelist: jurisdictionWhitelist,
      allocation_cap_bps: allocationCapBps,
      risk_rating: riskRating,
    }, [
      { pubkey: vaultStatePda, isSigner: false, isWritable: true },
      { pubkey: deriveYieldVenuePda(vaultStatePda, venueAddress), isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]),
  );
}

export function buildRemoveYieldVenueTx(params: {
  program: Program<Idl>;
  venueAddress: PublicKey;
  signer: PublicKey;
}) {
  const vaultStatePda = deriveVaultStatePda();

  return new Transaction().add(
    createInstruction(params.program, 'remove_yield_venue', {}, [
      { pubkey: vaultStatePda, isSigner: false, isWritable: true },
      { pubkey: deriveYieldVenuePda(vaultStatePda, params.venueAddress), isSigner: false, isWritable: true },
      { pubkey: params.signer, isSigner: true, isWritable: true },
    ]),
  );
}

export function buildAccrueYieldTx(params: {
  program: Program<Idl>;
  yieldAmount: BN;
  signer: PublicKey;
}) {
  return new Transaction().add(
    createInstruction(params.program, 'accrue_yield', {
      yield_amount: params.yieldAmount,
    }, [
      { pubkey: deriveVaultStatePda(), isSigner: false, isWritable: true },
      { pubkey: params.signer, isSigner: true, isWritable: false },
    ]),
  );
}

export function buildSetupConfidentialVaultTx(params: {
  program: Program<Idl>;
  confidentialShareMint: PublicKey;
  auditorElgamalPubkey: number[];
  signer: PublicKey;
}) {
  const vaultStatePda = deriveVaultStatePda();

  return new Transaction().add(
    createInstruction(params.program, 'setup_confidential_vault', {
      auditor_elgamal_pubkey: params.auditorElgamalPubkey,
    }, [
      { pubkey: vaultStatePda, isSigner: false, isWritable: false },
      { pubkey: deriveConfidentialConfigPda(vaultStatePda), isSigner: false, isWritable: true },
      { pubkey: params.confidentialShareMint, isSigner: false, isWritable: false },
      { pubkey: params.signer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]),
  );
}

const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export async function buildConvertToConfidentialTx(params: {
  program: Program<Idl>;
  amount: BN;
  signer: PublicKey;
}) {
  const { program, amount, signer } = params;
  const vaultState = await fetchVaultState(program);
  const vaultStatePda = deriveVaultStatePda();
  const confidentialConfig = deriveConfidentialConfigPda(vaultStatePda);
  const confidentialShareMint = await fetchConfidentialShareMint(program.provider.connection, confidentialConfig);
  const userShareAccount = deriveAssociatedTokenAddress(signer, vaultState.shareMint);
  const userConfidentialAccount = deriveAssociatedTokenAddress(signer, confidentialShareMint);

  return new Transaction().add(
    createInstruction(program, 'convert_to_confidential', { amount }, [
      { pubkey: vaultStatePda, isSigner: false, isWritable: true },
      { pubkey: confidentialConfig, isSigner: false, isWritable: true },
      { pubkey: vaultState.shareMint, isSigner: false, isWritable: true },
      { pubkey: confidentialShareMint, isSigner: false, isWritable: true },
      { pubkey: userShareAccount, isSigner: false, isWritable: true },
      { pubkey: userConfidentialAccount, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]),
  );
}

export async function buildConvertFromConfidentialTx(params: {
  program: Program<Idl>;
  amount: BN;
  signer: PublicKey;
}) {
  const { program, amount, signer } = params;
  const vaultState = await fetchVaultState(program);
  const vaultStatePda = deriveVaultStatePda();
  const confidentialConfig = deriveConfidentialConfigPda(vaultStatePda);
  const confidentialShareMint = await fetchConfidentialShareMint(program.provider.connection, confidentialConfig);
  const userShareAccount = deriveAssociatedTokenAddress(signer, vaultState.shareMint);
  const userConfidentialAccount = deriveAssociatedTokenAddress(signer, confidentialShareMint);

  return new Transaction().add(
    createInstruction(program, 'convert_from_confidential', { amount }, [
      { pubkey: vaultStatePda, isSigner: false, isWritable: true },
      { pubkey: confidentialConfig, isSigner: false, isWritable: true },
      { pubkey: vaultState.shareMint, isSigner: false, isWritable: true },
      { pubkey: confidentialShareMint, isSigner: false, isWritable: true },
      { pubkey: userShareAccount, isSigner: false, isWritable: true },
      { pubkey: userConfidentialAccount, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ]),
  );
}

async function fetchConfidentialShareMint(connection: Connection, confidentialConfig: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(confidentialConfig);
  if (!info) {
    throw new Error('Confidential vault not configured. Set up confidential transfers first.');
  }
  // The confidential_share_mint pubkey is stored after the 8-byte discriminator + 1 byte (enabled) = offset 9, 32 bytes
  // ConfidentialVaultConfig: enabled(bool=1), confidential_share_mint(pubkey=32), auditor_elgamal_pubkey([u8;32]=32), bump(u8=1)
  const data = Buffer.from(info.data);
  return new PublicKey(data.subarray(8 + 1, 8 + 1 + 32));
}
