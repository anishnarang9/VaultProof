import { BorshAccountsCoder, type Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import {
  getAllCredentialLeaves,
  getCredentialMerkleProof,
  getCurrentMerkleRoot,
} from '../lib/merkle';

const KYC_REGISTRY_PROGRAM_ID = new PublicKey('HKAr17WzrUyXudnWb63jxpRtXSEYAFnovv3kVfSKB4ih');
const KYC_REGISTRY_PDA = new PublicKey('DAS2RiFpGVh9enhXq13E9a2ScVCoTi867CSYXCK8gBQ3');
const STATE_TREE_PDA = new PublicKey('B5RQ3bTuoqLdKr4Mi3LMNh4PfQM812ozyRBx1UNnVzzi');

const registryAccountsIdl = {
  version: '0.1.0',
  name: 'registryAccounts',
  accounts: [
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

const registryCoder = new BorshAccountsCoder(registryAccountsIdl);

async function encodeAccount(
  accountName: string,
  account: Record<string, unknown>,
) {
  return Buffer.from(await registryCoder.encode(accountName, account));
}

function bigintToBytes32(value: bigint) {
  const hex = value.toString(16).padStart(64, '0');
  return Array.from(Buffer.from(hex, 'hex'));
}

function createMockConnection() {
  const accounts = new Map<string, { data: Buffer } | null>();
  const programAccounts = new Map<string, Array<{ pubkey: PublicKey; account: { data: Buffer } }>>();

  return {
    accounts,
    programAccounts,
    connection: {
      getAccountInfo: vi.fn(async (address: PublicKey) => accounts.get(address.toBase58()) ?? null),
      getProgramAccounts: vi.fn(
        async (programId: PublicKey) => programAccounts.get(programId.toBase58()) ?? [],
      ),
    },
  };
}

describe('frontend merkle helpers', () => {
  it('getCurrentMerkleRoot returns a bigint', async () => {
    const mock = createMockConnection();
    mock.accounts.set(
      STATE_TREE_PDA.toBase58(),
      {
        data: await encodeAccount('stateTree', {
          registry: KYC_REGISTRY_PDA,
          root: bigintToBytes32(99n),
          depth: 20,
          nextIndex: 2,
          bump: 42,
        }),
      },
    );

    const root = await getCurrentMerkleRoot(mock.connection as never, KYC_REGISTRY_PDA);
    expect(root).toBe(99n);
  });

  it('getAllCredentialLeaves returns an array', async () => {
    const mock = createMockConnection();
    const leafA = new PublicKey('4vJ9JU1bJJE96FWS7xL4TvT42P4Jd5Zr2Z8m6Rv4X2oK');
    const leafB = new PublicKey('8qbHbw2BbbTHBW1sG7z4W9P8ivVnJQqA7DiJ9N6byN1d');

    mock.programAccounts.set(KYC_REGISTRY_PROGRAM_ID.toBase58(), [
      {
        pubkey: leafA,
        account: {
          data: await encodeAccount('credentialLeaf', {
            registry: KYC_REGISTRY_PDA,
            stateTree: STATE_TREE_PDA,
            leafHash: bigintToBytes32(11n),
            leafIndex: 0,
            active: true,
            bump: 1,
          }),
        },
      },
      {
        pubkey: leafB,
        account: {
          data: await encodeAccount('credentialLeaf', {
            registry: KYC_REGISTRY_PDA,
            stateTree: STATE_TREE_PDA,
            leafHash: bigintToBytes32(22n),
            leafIndex: 1,
            active: true,
            bump: 1,
          }),
        },
      },
    ]);

    const leaves = await getAllCredentialLeaves(mock.connection as never, KYC_REGISTRY_PDA);
    expect(leaves).toHaveLength(2);
    expect(leaves[0]?.index).toBe(0);
  });

  it('getCredentialMerkleProof returns proof with 20 path elements', async () => {
    const mock = createMockConnection();
    mock.accounts.set(
      STATE_TREE_PDA.toBase58(),
      {
        data: await encodeAccount('stateTree', {
          registry: KYC_REGISTRY_PDA,
          root: bigintToBytes32(0n),
          depth: 20,
          nextIndex: 2,
          bump: 42,
        }),
      },
    );
    mock.programAccounts.set(KYC_REGISTRY_PROGRAM_ID.toBase58(), [
      {
        pubkey: new PublicKey('4vJ9JU1bJJE96FWS7xL4TvT42P4Jd5Zr2Z8m6Rv4X2oK'),
        account: {
          data: await encodeAccount('credentialLeaf', {
            registry: KYC_REGISTRY_PDA,
            stateTree: STATE_TREE_PDA,
            leafHash: bigintToBytes32(11n),
            leafIndex: 0,
            active: true,
            bump: 1,
          }),
        },
      },
      {
        pubkey: new PublicKey('8qbHbw2BbbTHBW1sG7z4W9P8ivVnJQqA7DiJ9N6byN1d'),
        account: {
          data: await encodeAccount('credentialLeaf', {
            registry: KYC_REGISTRY_PDA,
            stateTree: STATE_TREE_PDA,
            leafHash: bigintToBytes32(22n),
            leafIndex: 1,
            active: true,
            bump: 1,
          }),
        },
      },
    ]);

    const proof = await getCredentialMerkleProof(
      mock.connection as never,
      KYC_REGISTRY_PDA,
      22n,
    );

    expect(proof.pathElements).toHaveLength(20);
    expect(proof.pathIndices).toHaveLength(20);
    expect(proof.leafIndex).toBe(1);
    expect(typeof proof.root).toBe('bigint');
  });
});
