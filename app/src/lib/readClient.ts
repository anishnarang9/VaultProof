import { BN, BorshAccountsCoder, type Idl } from '@coral-xyz/anchor';
import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js';
import {
  EMPTY_PUBLIC_KEY,
  TransferType,
  createEmptyCredentialLeaf,
  createEmptyKycRegistry,
  createEmptyStateTree,
  createEmptyTransferRecord,
  createEmptyVaultState,
  type CredentialLeafWithAddress,
  type KycRegistry,
  type StateTree,
  type TransferRecordWithAddress,
  type VaultProofReadClient,
  type VaultState,
} from './types';

const endpoint = import.meta.env.VITE_SOLANA_RPC_URL ?? clusterApiUrl('devnet');
const connection = new Connection(endpoint, 'confirmed');
const textEncoder = new TextEncoder();

const VUSD_VAULT_PROGRAM_ID = new PublicKey('CUxwkHjKjGyKa5H1qEQySw98yKn33RZFxc9TbVgU6rdu');
const KYC_REGISTRY_PROGRAM_ID = new PublicKey('NsgKr1qCEUb1vXdwaGvbz3ygG4R4SCrUQm3T8tHoqgD');

const vaultAccountsIdl = {
  version: '0.1.0',
  name: 'vusdVaultAccounts',
  accounts: [
    {
      name: 'vaultState',
      discriminator: [228, 196, 82, 165, 98, 210, 235, 152],
    },
    {
      name: 'transferRecord',
      discriminator: [200, 31, 6, 158, 240, 25, 248, 53],
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
    {
      name: 'transferRecord',
      type: {
        kind: 'struct',
        fields: [
          { name: 'proofHash', type: { array: ['u8', 32] } },
          { name: 'transferType', type: { defined: { name: 'transferType' } } },
          { name: 'amount', type: 'u64' },
          { name: 'timestamp', type: 'i64' },
          { name: 'merkleRootSnapshot', type: { array: ['u8', 32] } },
          { name: 'encryptedMetadata', type: { vec: 'u8' } },
          { name: 'decryptionAuthorized', type: 'bool' },
          { name: 'signer', type: 'pubkey' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'transferType',
      type: {
        kind: 'enum',
        variants: [{ name: 'deposit' }, { name: 'transfer' }, { name: 'withdrawal' }],
      },
    },
  ],
} as unknown as Idl;

const registryAccountsIdl = {
  version: '0.1.0',
  name: 'kycRegistryAccounts',
  accounts: [
    {
      name: 'kycRegistry',
      discriminator: [204, 241, 19, 79, 46, 77, 56, 20],
    },
    {
      name: 'stateTree',
      discriminator: [93, 3, 106, 105, 49, 120, 84, 187],
    },
    {
      name: 'credentialLeaf',
      discriminator: [244, 122, 140, 233, 134, 83, 144, 113],
    },
  ],
  types: [
    {
      name: 'kycRegistry',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'pubkey' },
          { name: 'stateTreePubkey', type: 'pubkey' },
          { name: 'credentialCount', type: 'u64' },
          { name: 'revokedCount', type: 'u64' },
          { name: 'issuerPubkey', type: { array: ['u8', 32] } },
          { name: 'merkleRoot', type: { array: ['u8', 32] } },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
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
    {
      name: 'credentialLeaf',
      type: {
        kind: 'struct',
        fields: [
          { name: 'registry', type: 'pubkey' },
          { name: 'stateTree', type: 'pubkey' },
          { name: 'leafHash', type: { array: ['u8', 32] } },
          { name: 'leafIndex', type: 'u32' },
          { name: 'active', type: 'bool' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
} as unknown as Idl;

const vaultCoder = new BorshAccountsCoder(vaultAccountsIdl);
const registryCoder = new BorshAccountsCoder(registryAccountsIdl);

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

function toBN(value: unknown): BN {
  if (BN.isBN(value)) {
    return value;
  }

  if (typeof value === 'number') {
    return new BN(value);
  }

  if (typeof value === 'bigint') {
    return new BN(value.toString());
  }

  if (typeof value === 'string' && value.length > 0) {
    return new BN(value, 10);
  }

  if (value && typeof value === 'object' && 'toString' in value) {
    return new BN((value as { toString: () => string }).toString(), 10);
  }

  return new BN(0);
}

function toPublicKey(value: unknown) {
  if (value instanceof PublicKey) {
    return value;
  }

  if (value && typeof value === 'object' && 'toBase58' in value) {
    return new PublicKey((value as { toBase58: () => string }).toBase58());
  }

  if (typeof value === 'string' && value.length > 0) {
    return new PublicKey(value);
  }

  return EMPTY_PUBLIC_KEY;
}

function toBytes(value: unknown, width = 32): number[] {
  if (Array.isArray(value)) {
    return value.map((byte) => Number(byte));
  }

  if (value instanceof Uint8Array) {
    return Array.from(value);
  }

  if (typeof value === 'string' && value.startsWith('0x')) {
    const body = value.slice(2).padStart(width * 2, '0');
    return Array.from({ length: body.length / 2 }, (_, index) =>
      Number.parseInt(body.slice(index * 2, index * 2 + 2), 16),
    );
  }

  return Array.from({ length: width }, () => 0);
}

function normalizeTransferType(value: unknown) {
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'deposit':
        return TransferType.Deposit;
      case 'withdrawal':
        return TransferType.Withdrawal;
      default:
        return TransferType.Transfer;
    }
  }

  if (value && typeof value === 'object') {
    const key = Object.keys(value as Record<string, unknown>)[0]?.toLowerCase();

    if (key === 'deposit') {
      return TransferType.Deposit;
    }

    if (key === 'withdrawal') {
      return TransferType.Withdrawal;
    }
  }

  return TransferType.Transfer;
}

function derivePda(programId: PublicKey, ...seeds: Array<PublicKey | Uint8Array | string>) {
  return PublicKey.findProgramAddressSync(
    seeds.map((seed) => {
      if (typeof seed === 'string') {
        return textEncoder.encode(seed);
      }

      return seed instanceof PublicKey ? seed.toBytes() : seed;
    }),
    programId,
  )[0];
}

async function fetchDecodedAccount<T>(
  address: PublicKey,
  coder: BorshAccountsCoder,
  accountName: string,
) {
  const info = await connection.getAccountInfo(address);

  if (!info) {
    return null;
  }

  return coder.decode<T>(accountName, info.data);
}

async function fetchAllAccounts<T>(
  programId: PublicKey,
  coder: BorshAccountsCoder,
  accountName: string,
) {
  const discriminator = coder.accountDiscriminator(accountName);
  const accounts = await connection.getProgramAccounts(programId);

  return accounts
    .filter((account) => bytesEqual(account.account.data.subarray(0, 8), discriminator))
    .map((account) => ({
      address: account.pubkey,
      account: coder.decode<T>(accountName, account.account.data),
    }));
}

function normalizeVaultState(raw: Record<string, unknown>): VaultState {
  return createEmptyVaultState({
    authority: toPublicKey(raw.authority),
    usdcMint: toPublicKey(raw.usdcMint),
    shareMint: toPublicKey(raw.shareMint),
    usdcReserve: toPublicKey(raw.usdcReserve),
    totalAssets: toBN(raw.totalAssets),
    totalShares: toBN(raw.totalShares),
    sharePriceNumerator: toBN(raw.sharePriceNumerator),
    sharePriceDenominator: toBN(raw.sharePriceDenominator),
    yieldSource: toPublicKey(raw.yieldSource),
    liquidBufferBps: Number(raw.liquidBufferBps ?? 0),
    totalYieldEarned: toBN(raw.totalYieldEarned),
    amlThresholds: [
      toBN((raw.amlThresholds as unknown[] | undefined)?.[0]),
      toBN((raw.amlThresholds as unknown[] | undefined)?.[1]),
      toBN((raw.amlThresholds as unknown[] | undefined)?.[2]),
    ],
    expiredThreshold: toBN(raw.expiredThreshold),
    emergencyTimelock: toBN(raw.emergencyTimelock),
    regulatorPubkeyX: toBytes(raw.regulatorPubkeyX),
    regulatorPubkeyY: toBytes(raw.regulatorPubkeyY),
    bump: Number(raw.bump ?? 0),
    reserveBump: Number(raw.reserveBump ?? 0),
  });
}

function normalizeKycRegistry(raw: Record<string, unknown>): KycRegistry {
  return createEmptyKycRegistry({
    authority: toPublicKey(raw.authority),
    stateTreePubkey: toPublicKey(raw.stateTreePubkey),
    credentialCount: toBN(raw.credentialCount),
    revokedCount: toBN(raw.revokedCount),
    issuerPubkey: toBytes(raw.issuerPubkey),
    merkleRoot: toBytes(raw.merkleRoot),
    bump: Number(raw.bump ?? 0),
  });
}

function normalizeStateTree(raw: Record<string, unknown>): StateTree {
  return createEmptyStateTree({
    registry: toPublicKey(raw.registry),
    root: toBytes(raw.root),
    depth: Number(raw.depth ?? 20),
    nextIndex: toBN(raw.nextIndex),
    bump: Number(raw.bump ?? 0),
  });
}

function normalizeTransferRecord(raw: Record<string, unknown>): TransferRecordWithAddress {
  const address = toPublicKey(raw.address);

  return {
    ...createEmptyTransferRecord({
      proofHash: toBytes(raw.proofHash),
      transferType: normalizeTransferType(raw.transferType),
      amount: toBN(raw.amount),
      timestamp: toBN(raw.timestamp),
      merkleRootSnapshot: toBytes(raw.merkleRootSnapshot),
      encryptedMetadata: toBytes(raw.encryptedMetadata, toBytes(raw.encryptedMetadata).length || 0),
      decryptionAuthorized: Boolean(raw.decryptionAuthorized),
      signer: toPublicKey(raw.signer),
      bump: Number(raw.bump ?? 0),
    }),
    address,
  };
}

function normalizeCredentialLeaf(raw: Record<string, unknown>): CredentialLeafWithAddress {
  return createEmptyCredentialLeaf({
    address: toPublicKey(raw.address),
    registry: toPublicKey(raw.registry),
    stateTree: toPublicKey(raw.stateTree),
    leafHash: toBytes(raw.leafHash),
    leafIndex: toBN(raw.leafIndex),
    active: Boolean(raw.active),
    bump: Number(raw.bump ?? 0),
  });
}

export const defaultReadClient: VaultProofReadClient = {
  async fetchVaultState() {
    try {
      const address = derivePda(VUSD_VAULT_PROGRAM_ID, 'vault_state');
      const raw = await fetchDecodedAccount<Record<string, unknown>>(
        address,
        vaultCoder,
        'vaultState',
      );

      return raw ? normalizeVaultState(raw) : createEmptyVaultState();
    } catch {
      return createEmptyVaultState();
    }
  },

  async fetchKycRegistry() {
    try {
      const address = derivePda(KYC_REGISTRY_PROGRAM_ID, 'kyc_registry');
      const raw = await fetchDecodedAccount<Record<string, unknown>>(
        address,
        registryCoder,
        'kycRegistry',
      );

      return raw ? normalizeKycRegistry(raw) : createEmptyKycRegistry();
    } catch {
      return createEmptyKycRegistry();
    }
  },

  async fetchStateTree() {
    try {
      const registryAddress = derivePda(KYC_REGISTRY_PROGRAM_ID, 'kyc_registry');
      const address = derivePda(KYC_REGISTRY_PROGRAM_ID, 'state_tree', registryAddress);
      const raw = await fetchDecodedAccount<Record<string, unknown>>(
        address,
        registryCoder,
        'stateTree',
      );

      return raw ? normalizeStateTree(raw) : createEmptyStateTree();
    } catch {
      return createEmptyStateTree();
    }
  },

  async fetchTransferRecords() {
    try {
      const records = await fetchAllAccounts<Record<string, unknown>>(
        VUSD_VAULT_PROGRAM_ID,
        vaultCoder,
        'transferRecord',
      );

      return records.map(({ address, account }) =>
        normalizeTransferRecord({ ...account, address }),
      );
    } catch {
      return [];
    }
  },

  async fetchCredentialLeaves() {
    try {
      const leaves = await fetchAllAccounts<Record<string, unknown>>(
        KYC_REGISTRY_PROGRAM_ID,
        registryCoder,
        'credentialLeaf',
      );

      return leaves.map(({ address, account }) =>
        normalizeCredentialLeaf({ ...account, address }),
      );
    } catch {
      return [];
    }
  },
};
