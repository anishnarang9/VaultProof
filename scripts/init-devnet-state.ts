import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STATE_TREE_DEPTH = 20;
type SparseLeaf = {
  active: boolean;
  hash: Buffer;
  index: number;
};

function bigIntToBuffer(value: bigint) {
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
}

function bufferToBigInt(value: Buffer) {
  return BigInt(`0x${value.toString('hex')}`);
}

function toHex(value: Buffer) {
  return value.toString('hex');
}

function fromHex(value: string) {
  return Buffer.from(value, 'hex');
}

async function loadPoseidon() {
  const circomlibjs = await import('circomlibjs');
  const poseidon = await circomlibjs.buildPoseidon();
  const field = poseidon.F;

  const hash = (...inputs: Buffer[]) => {
    const output = poseidon(inputs.map(bufferToBigInt));
    return bigIntToBuffer(BigInt(field.toString(output)));
  };

  const zeroLeaf = hash(Buffer.alloc(32));
  const zeroHashes = [zeroLeaf];

  for (let level = 0; level < STATE_TREE_DEPTH; level += 1) {
    zeroHashes.push(hash(zeroHashes[level], zeroHashes[level]));
  }

  return { hash, zeroHashes };
}

function compressLevel(
  hashPair: (...inputs: Buffer[]) => Buffer,
  levelMap: Map<number, string>,
  zeroCurrent: Buffer,
  zeroNext: Buffer,
) {
  const parentMap = new Map<number, string>();
  const parentIndexes = new Set<number>();

  for (const index of Array.from(levelMap.keys())) {
    parentIndexes.add(Math.floor(index / 2));
  }

  for (const parentIndex of Array.from(parentIndexes)) {
    const left = levelMap.get(parentIndex * 2) ?? toHex(zeroCurrent);
    const right = levelMap.get(parentIndex * 2 + 1) ?? toHex(zeroCurrent);
    const parent = hashPair(fromHex(left), fromHex(right));

    if (toHex(parent) !== toHex(zeroNext)) {
      parentMap.set(parentIndex, toHex(parent));
    }
  }

  return parentMap;
}

function buildSparseLevels(
  hashPair: (...inputs: Buffer[]) => Buffer,
  leaves: SparseLeaf[],
  zeroHashes: Buffer[],
) {
  const levels: Array<Map<number, string>> = [];
  let current = new Map<number, string>();

  for (const leaf of leaves) {
    if (leaf.active) {
      current.set(leaf.index, toHex(leaf.hash));
    }
  }

  levels.push(current);

  for (let level = 0; level < STATE_TREE_DEPTH; level += 1) {
    current = compressLevel(hashPair, current, zeroHashes[level], zeroHashes[level + 1]);
    levels.push(current);
  }

  return levels;
}

function getProofForIndex(
  hashPair: (...inputs: Buffer[]) => Buffer,
  leaves: SparseLeaf[],
  zeroHashes: Buffer[],
  index: number,
) {
  const levels = buildSparseLevels(hashPair, leaves, zeroHashes);
  const proof: Buffer[] = [];
  let cursor = index;

  for (let level = 0; level < STATE_TREE_DEPTH; level += 1) {
    const sibling = levels[level].get(cursor ^ 1) ?? toHex(zeroHashes[level]);
    proof.push(fromHex(sibling));
    cursor = Math.floor(cursor / 2);
  }

  const root = levels[STATE_TREE_DEPTH].get(0) ?? toHex(zeroHashes[STATE_TREE_DEPTH]);
  return { proof, root: fromHex(root) };
}

async function main() {
  process.env.ANCHOR_PROVIDER_URL ??= 'https://api.devnet.solana.com';
  process.env.ANCHOR_WALLET ??= `${process.env.HOME}/.config/solana/id.json`;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const authority = provider.wallet.publicKey;

  const idlPath = resolve(process.cwd(), 'target/idl/kyc_registry.json');
  const idl = JSON.parse(readFileSync(idlPath, 'utf8'));
  const program = new anchor.Program(idl, provider);
  const programAccounts = program.account as any;

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('kyc_registry')],
    program.programId,
  );
  const [stateTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('state_tree'), registryPda.toBuffer()],
    program.programId,
  );

  const poseidon = await loadPoseidon();
  const issuerPubkey = Uint8Array.from(Array.from({ length: 32 }, (_, index) => (index + 1) & 0xff));

  const registryInfo = await provider.connection.getAccountInfo(registryPda, 'confirmed');

  if (!registryInfo) {
    console.log('Initializing registry...');
    await (program.methods as any)
      .initializeRegistry(stateTreePda, Array.from(issuerPubkey))
      .accounts({
        authority,
        registry: registryPda,
        stateTree: stateTreePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } else {
    console.log(`Registry already exists: ${registryPda.toBase58()}`);
  }

  const stateTree = await programAccounts.stateTree.fetch(stateTreePda);
  const stateTreeRoot = Buffer.from(stateTree.root as number[]);
  const nextIndex = Number(stateTree.nextIndex);

  const leafHash = poseidon.hash(bigIntToBuffer(1n), bigIntToBuffer(1000n));
  const [credentialLeafPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('credential_leaf'), registryPda.toBuffer(), leafHash],
    program.programId,
  );
  const existingLeaf = await provider.connection.getAccountInfo(credentialLeafPda, 'confirmed');

  if (!existingLeaf) {
    console.log('Adding test credential leaf...');
    const leaves = await programAccounts.credentialLeaf.all();
    const activeLeaves: SparseLeaf[] = leaves
      .filter((entry: any) => entry.account.registry.equals(registryPda))
      .map((entry: any) => ({
        active: entry.account.active,
        hash: Buffer.from(entry.account.leafHash),
        index: entry.account.leafIndex,
      }));
    const proof = getProofForIndex(poseidon.hash, activeLeaves, poseidon.zeroHashes, nextIndex).proof;

    await (program.methods as any)
      .addCredential(
        Array.from(leafHash),
        proof.map((node) => Array.from(node)),
      )
      .accounts({
        authority,
        credentialLeaf: credentialLeafPda,
        registry: registryPda,
        stateTree: stateTreePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } else {
    console.log(`Test credential already exists: ${credentialLeafPda.toBase58()}`);
  }

  const refreshedTree = await programAccounts.stateTree.fetch(stateTreePda);
  console.log(`Registry: ${registryPda.toBase58()}`);
  console.log(`StateTree: ${stateTreePda.toBase58()}`);
  console.log(`Previous root: ${toHex(stateTreeRoot)}`);
  console.log(`Current root:  ${Buffer.from(refreshedTree.root as number[]).toString('hex')}`);
  console.log(`Next index:    ${refreshedTree.nextIndex.toString()}`);
  console.log(`Credential:    ${credentialLeafPda.toBase58()}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
