import { BorshAccountsCoder, type Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { bytesToBigInt } from './crypto';
import { KYC_REGISTRY_PROGRAM_ID, deriveStateTreePda } from './program';

const STATE_TREE_DEPTH = 20;
const textEncoder = new TextEncoder();

const registryAccountsIdl = {
  version: '0.1.0',
  name: 'kycRegistryAccounts',
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

export interface MerkleProof {
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
  leafIndex: number;
}

type CredentialLeafEntry = {
  hash: bigint;
  index: number;
  active: boolean;
};

let poseidonPromise: Promise<Awaited<ReturnType<typeof import('circomlibjs')['buildPoseidon']>>> | null =
  null;

function decodeAccount<T>(accountName: string, data: Uint8Array | Buffer) {
  return registryCoder.decode(accountName, Buffer.from(data)) as T;
}

async function getPoseidon() {
  if (!poseidonPromise) {
    poseidonPromise = (async () => {
      const { buildPoseidon } = await import('circomlibjs');
      return buildPoseidon();
    })();
  }

  return poseidonPromise;
}

function toSeed(seed: PublicKey | string | Uint8Array) {
  if (typeof seed === 'string') {
    return textEncoder.encode(seed);
  }

  return seed instanceof PublicKey ? seed.toBytes() : seed;
}

function deriveRegistryPda() {
  return PublicKey.findProgramAddressSync([toSeed('kyc_registry')], KYC_REGISTRY_PROGRAM_ID)[0];
}

async function fetchStateTreeAccount(connection: Connection, registryPubkey: PublicKey) {
  const stateTree = deriveStateTreePda(registryPubkey);
  const info = await connection.getAccountInfo(stateTree);

  if (!info) {
    throw new Error(`StateTree account ${stateTree.toBase58()} was not found.`);
  }

  return decodeAccount<Record<string, unknown>>('stateTree', info.data);
}

async function getZeroHashes() {
  const poseidon = await getPoseidon();
  const zeroLeaf = BigInt(poseidon.F.toString(poseidon([0n])));
  const zeroHashes = [zeroLeaf];

  for (let level = 0; level < STATE_TREE_DEPTH; level += 1) {
    zeroHashes.push(BigInt(poseidon.F.toString(poseidon([zeroHashes[level], zeroHashes[level]]))));
  }

  return { poseidon, zeroHashes };
}

async function hashPair(left: bigint, right: bigint) {
  const poseidon = await getPoseidon();
  return BigInt(poseidon.F.toString(poseidon([left, right])));
}

function buildLevelMaps(leaves: CredentialLeafEntry[]) {
  const level = new Map<number, bigint>();

  for (const leaf of leaves) {
    if (leaf.active) {
      level.set(leaf.index, leaf.hash);
    }
  }

  return level;
}

async function buildSparseLevels(leaves: CredentialLeafEntry[], zeroHashes: bigint[]) {
  const levels: Array<Map<number, bigint>> = [];
  let current = buildLevelMaps(leaves);

  levels.push(current);
  for (let level = 0; level < STATE_TREE_DEPTH; level += 1) {
    const parentMap = new Map<number, bigint>();
    const parentIndexes = new Set<number>();

    for (const index of current.keys()) {
      parentIndexes.add(Math.floor(index / 2));
    }

    for (const parentIndex of parentIndexes) {
      const left = current.get(parentIndex * 2) ?? zeroHashes[level];
      const right = current.get(parentIndex * 2 + 1) ?? zeroHashes[level];
      const parent = await hashPair(left, right);

      if (parent !== zeroHashes[level + 1]) {
        parentMap.set(parentIndex, parent);
      }
    }

    current = parentMap;
    levels.push(current);
  }

  return levels;
}

export async function getCurrentMerkleRoot(
  connection: Connection,
  registryPubkey: PublicKey = deriveRegistryPda(),
) {
  const stateTree = await fetchStateTreeAccount(connection, registryPubkey);
  return bytesToBigInt(stateTree.root as number[]);
}

export async function getAllCredentialLeaves(
  connection: Connection,
  registryPubkey: PublicKey = deriveRegistryPda(),
) {
  const accounts = await connection.getProgramAccounts(KYC_REGISTRY_PROGRAM_ID);
  const discriminator = registryCoder.accountDiscriminator('credentialLeaf');

  return accounts
    .filter((account) =>
      Buffer.from(account.account.data.subarray(0, 8)).equals(Buffer.from(discriminator)),
    )
    .map(({ account }) => decodeAccount<Record<string, unknown>>('credentialLeaf', account.data))
    .filter((account) => new PublicKey(account.registry as PublicKey).equals(registryPubkey))
    .map((account) => ({
      hash: bytesToBigInt(account.leafHash as number[]),
      index: Number(account.leafIndex ?? 0),
      active: Boolean(account.active),
    }))
    .sort((left, right) => left.index - right.index);
}

export async function getCredentialMerkleProof(
  connection: Connection,
  registryPubkey: PublicKey = deriveRegistryPda(),
  leafHash: bigint,
): Promise<MerkleProof> {
  const stateTree = await fetchStateTreeAccount(connection, registryPubkey);
  const onChainRoot = bytesToBigInt(stateTree.root as number[]);
  const nextIndex = Number(stateTree.nextIndex ?? 0);
  const leaves = await getAllCredentialLeaves(connection, registryPubkey);
  const activeLeaves = leaves.filter((leaf) => leaf.active);
  const targetLeaf = activeLeaves.find((leaf) => leaf.hash === leafHash);
  const targetIndex = targetLeaf?.index ?? nextIndex;
  const { zeroHashes } = await getZeroHashes();
  const levels = await buildSparseLevels(activeLeaves, zeroHashes);
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let cursor = targetIndex;

  for (let level = 0; level < STATE_TREE_DEPTH; level += 1) {
    pathElements.push(levels[level].get(cursor ^ 1) ?? zeroHashes[level]);
    pathIndices.push(cursor & 1);
    cursor = Math.floor(cursor / 2);
  }

  const computedRoot = levels[STATE_TREE_DEPTH].get(0) ?? zeroHashes[STATE_TREE_DEPTH];

  return {
    pathElements,
    pathIndices,
    root: onChainRoot === 0n ? computedRoot : onChainRoot,
    leafIndex: targetIndex,
  };
}
