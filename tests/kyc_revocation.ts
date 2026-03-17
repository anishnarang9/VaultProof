import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const STATE_TREE_DEPTH = 20;
const SECONDARY_AUTHORITY_SEED = Uint8Array.from(
  Array.from({ length: 32 }, (_, index) => (index + 17) & 0xff)
);

type SparseLeaf = {
  active: boolean;
  hash: Buffer;
  index: number;
};

function bigIntToBuffer(value: bigint): Buffer {
  const hex = value.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

function bufferToBigInt(value: Buffer): bigint {
  return BigInt(`0x${value.toString("hex")}`);
}

function toHex(value: Buffer): string {
  return value.toString("hex");
}

function fromHex(value: string): Buffer {
  return Buffer.from(value, "hex");
}

async function loadPoseidon() {
  const circomlibjs = await import("circomlibjs");
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
  zeroNext: Buffer
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
  zeroHashes: Buffer[]
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
    current = compressLevel(
      hashPair,
      current,
      zeroHashes[level],
      zeroHashes[level + 1]
    );
    levels.push(current);
  }

  return levels;
}

function getProofForIndex(
  hashPair: (...inputs: Buffer[]) => Buffer,
  leaves: SparseLeaf[],
  zeroHashes: Buffer[],
  index: number
) {
  const levels = buildSparseLevels(hashPair, leaves, zeroHashes);
  const proof: Buffer[] = [];
  let cursor = index;

  for (let level = 0; level < STATE_TREE_DEPTH; level += 1) {
    const sibling = levels[level].get(cursor ^ 1) ?? toHex(zeroHashes[level]);
    proof.push(fromHex(sibling));
    cursor = Math.floor(cursor / 2);
  }

  const root =
    levels[STATE_TREE_DEPTH].get(0) ?? toHex(zeroHashes[STATE_TREE_DEPTH]);
  return { proof, root: fromHex(root) };
}

function computeRootFromProof(
  hashPair: (...inputs: Buffer[]) => Buffer,
  leaf: Buffer,
  index: number,
  proof: Buffer[]
) {
  let current: Buffer = Buffer.from(leaf);
  let cursor = index;

  for (const sibling of proof) {
    current =
      cursor % 2 === 0
        ? hashPair(current, sibling)
        : hashPair(sibling, current);
    cursor = Math.floor(cursor / 2);
  }

  return current;
}

async function decodeEvents(program: anchor.Program<any>, signature: string) {
  await program.provider.connection.confirmTransaction(signature, "confirmed");
  const tx = await program.provider.connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  const coder = new anchor.BorshEventCoder(program.idl);
  return (tx?.meta?.logMessages ?? [])
    .map((log) => {
      const prefix = "Program data: ";
      return log.startsWith(prefix) ? coder.decode(log.slice(prefix.length)) : null;
    })
    .filter((event): event is NonNullable<typeof event> => event !== null);
}

async function expectReject(promise: Promise<unknown>) {
  let rejected = false;
  try {
    await promise;
  } catch (_error) {
    rejected = true;
  }
  assert.isTrue(rejected, "expected transaction to reject");
}

describe("kyc_revocation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.KycRegistry as anchor.Program<any>;
  const programAccounts = program.account as any;
  const authority = provider.wallet as anchor.Wallet;
  const secondaryAuthority = Keypair.fromSeed(SECONDARY_AUTHORITY_SEED);

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("kyc_registry")],
    program.programId
  );
  const [stateTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state_tree"), registryPda.toBuffer()],
    program.programId
  );

  const issuerPubkey = Uint8Array.from(
    Array.from({ length: 32 }, (_, index) => ((index + 33) * 3) & 0xff)
  );

  let hashPair: (...inputs: Buffer[]) => Buffer;
  let zeroHashes: Buffer[];
  let survivorLeaf: Buffer;
  let targetLeaf: Buffer;
  let extraLeaf: Buffer;

  function makeLeaf(seed: number) {
    return hashPair(
      bigIntToBuffer(BigInt(seed)),
      bigIntToBuffer(BigInt(seed * 777))
    );
  }

  async function fundSecondaryAuthority() {
    const balance = await provider.connection.getBalance(
      secondaryAuthority.publicKey,
      "confirmed"
    );
    if (balance >= anchor.web3.LAMPORTS_PER_SOL) {
      return;
    }

    const signature = await provider.connection.requestAirdrop(
      secondaryAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature, "confirmed");
  }

  async function fetchRegistryNullable() {
    const accountInfo = await provider.connection.getAccountInfo(registryPda);
    if (!accountInfo) {
      return null;
    }

    return programAccounts.kycRegistry.fetch(registryPda);
  }

  async function fetchStateTree() {
    const stateTree = await programAccounts.stateTree.fetch(stateTreePda);
    return {
      raw: stateTree,
      root: Buffer.from(stateTree.root as number[]),
      nextIndex: Number(stateTree.nextIndex),
    };
  }

  async function fetchAllLeaves(): Promise<SparseLeaf[]> {
    const leaves = await programAccounts.credentialLeaf.all();
    return leaves
      .filter((entry: any) => entry.account.registry.equals(registryPda))
      .map((entry: any) => ({
        active: entry.account.active,
        hash: Buffer.from(entry.account.leafHash),
        index: entry.account.leafIndex,
      }));
  }

  async function ensureRegistryInitialized() {
    if (await fetchRegistryNullable()) {
      return;
    }

    await (program.methods as any)
      .initializeRegistry(stateTreePda, Array.from(issuerPubkey))
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function ensureAuthority(target: PublicKey) {
    const registry = await fetchRegistryNullable();
    assert.exists(registry, "registry must exist before authority changes");

    if (registry!.authority.equals(target)) {
      return;
    }

    if (registry!.authority.equals(authority.publicKey)) {
      await (program.methods as any)
        .transferAuthority(target)
        .accounts({
          registry: registryPda,
          authority: authority.publicKey,
        })
        .rpc();
      return;
    }

    if (registry!.authority.equals(secondaryAuthority.publicKey)) {
      await (program.methods as any)
        .transferAuthority(target)
        .accounts({
          registry: registryPda,
          authority: secondaryAuthority.publicKey,
        })
        .signers([secondaryAuthority])
        .rpc();
      return;
    }

    throw new Error(`unknown registry authority ${registry!.authority.toBase58()}`);
  }

  async function addLeaf(leafHash: Buffer) {
    const stateTree = await fetchStateTree();
    const proof = getProofForIndex(
      hashPair,
      await fetchAllLeaves(),
      zeroHashes,
      stateTree.nextIndex
    ).proof;
    const [credentialLeafPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("credential_leaf"), registryPda.toBuffer(), leafHash],
      program.programId
    );

    await (program.methods as any)
      .addCredential(
        Array.from(leafHash),
        proof.map((node) => Array.from(node))
      )
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        credentialLeaf: credentialLeafPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function nextFreshLeaf(offset: number) {
    const stateTree = await fetchStateTree();
    return makeLeaf(offset * 10_000 + stateTree.nextIndex + 1);
  }

  before(async function () {
    this.timeout(60_000);
    const poseidon = await loadPoseidon();
    hashPair = poseidon.hash;
    zeroHashes = poseidon.zeroHashes;
    await fundSecondaryAuthority();
    await ensureRegistryInitialized();
    await ensureAuthority(authority.publicKey);

    survivorLeaf = await nextFreshLeaf(11);
    targetLeaf = await nextFreshLeaf(22);
    extraLeaf = await nextFreshLeaf(33);

    await addLeaf(survivorLeaf);
    await addLeaf(targetLeaf);
    await addLeaf(extraLeaf);
  });

  it("revoke_credential updates root, increments revoked_count, and invalidates the old proof", async function () {
    this.timeout(60_000);

    const leavesBefore = await fetchAllLeaves();
    const targetRecord = leavesBefore.find(
      (leaf) => toHex(leaf.hash) === toHex(targetLeaf)
    );
    assert.exists(targetRecord);

    const registryBefore = await programAccounts.kycRegistry.fetch(registryPda);
    const stateTreeBefore = await fetchStateTree();
    const oldProof = getProofForIndex(
      hashPair,
      leavesBefore,
      zeroHashes,
      targetRecord!.index
    );

    const [credentialLeafPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("credential_leaf"), registryPda.toBuffer(), targetLeaf],
      program.programId
    );

    const signature = await (program.methods as any)
      .revokeCredential(
        Array.from(targetLeaf),
        oldProof.proof.map((node) => Array.from(node))
      )
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        credentialLeaf: credentialLeafPda,
        authority: authority.publicKey,
      })
      .rpc();

    const registryAfter = await programAccounts.kycRegistry.fetch(registryPda);
    const stateTreeAfter = await fetchStateTree();
    const events = await decodeEvents(program, signature);
    const revokedEvent = events.find((event) => event.name === "credentialRevoked");
    const targetAfter = (await fetchAllLeaves()).find(
      (leaf) => toHex(leaf.hash) === toHex(targetLeaf)
    );

    assert.equal(
      registryAfter.credentialCount.toString(),
      registryBefore.credentialCount.toString()
    );
    assert.equal(
      Number(registryAfter.revokedCount),
      Number(registryBefore.revokedCount) + 1
    );
    assert.equal(stateTreeAfter.nextIndex, stateTreeBefore.nextIndex);
    assert.notEqual(toHex(stateTreeBefore.root), toHex(stateTreeAfter.root));
    assert.exists(revokedEvent);
    assert.deepEqual(
      Array.from(revokedEvent?.data.leafHash ?? []),
      Array.from(targetLeaf)
    );
    assert.exists(targetAfter);
    assert.isFalse(targetAfter!.active);
    assert.notEqual(
      toHex(
        computeRootFromProof(
          hashPair,
          targetLeaf,
          targetRecord!.index,
          oldProof.proof
        )
      ),
      toHex(stateTreeAfter.root)
    );
  });

  it("other credentials retain valid proofs after revocation", async function () {
    this.timeout(60_000);

    const leaves = await fetchAllLeaves();
    const survivor = leaves.find(
      (leaf) => toHex(leaf.hash) === toHex(survivorLeaf)
    );
    const currentRoot = (await fetchStateTree()).root;

    assert.exists(survivor);
    assert.isTrue(survivor!.active);

    const survivorProof = getProofForIndex(
      hashPair,
      leaves,
      zeroHashes,
      survivor!.index
    );

    assert.equal(toHex(survivorProof.root), toHex(currentRoot));
    assert.equal(
      toHex(
        computeRootFromProof(
          hashPair,
          survivorLeaf,
          survivor!.index,
          survivorProof.proof
        )
      ),
      toHex(currentRoot)
    );
  });

  it("revoking a non-existent or already-revoked credential fails", async function () {
    this.timeout(60_000);

    const missingLeaf = await nextFreshLeaf(44);
    const currentLeaves = await fetchAllLeaves();
    const placeholderProof = getProofForIndex(
      hashPair,
      currentLeaves,
      zeroHashes,
      currentLeaves[0]?.index ?? 0
    ).proof;

    const [revokedLeafPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("credential_leaf"), registryPda.toBuffer(), targetLeaf],
      program.programId
    );
    const [missingLeafPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("credential_leaf"), registryPda.toBuffer(), missingLeaf],
      program.programId
    );

    await expectReject(
      (program.methods as any)
        .revokeCredential(
          Array.from(targetLeaf),
          placeholderProof.map((node) => Array.from(node))
        )
        .accounts({
          registry: registryPda,
          stateTree: stateTreePda,
          credentialLeaf: revokedLeafPda,
          authority: authority.publicKey,
        })
        .rpc()
    );

    await expectReject(
      (program.methods as any)
        .revokeCredential(
          Array.from(missingLeaf),
          placeholderProof.map((node) => Array.from(node))
        )
        .accounts({
          registry: registryPda,
          stateTree: stateTreePda,
          credentialLeaf: missingLeafPda,
          authority: authority.publicKey,
        })
        .rpc()
    );
  });

  it("re-adding the same revoked leaf hash is rejected in the PDA fallback path", async function () {
    this.timeout(60_000);

    const stateTree = await fetchStateTree();
    const nextInsertProof = getProofForIndex(
      hashPair,
      await fetchAllLeaves(),
      zeroHashes,
      stateTree.nextIndex
    ).proof;
    const [credentialLeafPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("credential_leaf"), registryPda.toBuffer(), targetLeaf],
      program.programId
    );

    await expectReject(
      (program.methods as any)
        .addCredential(
          Array.from(targetLeaf),
          nextInsertProof.map((node) => Array.from(node))
        )
        .accounts({
          registry: registryPda,
          stateTree: stateTreePda,
          credentialLeaf: credentialLeafPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc()
    );
  });

  it("revocation followed by add produces a fresh root and a new valid proof", async function () {
    this.timeout(60_000);

    const rootBeforeAdd = (await fetchStateTree()).root;
    const newLeaf = await nextFreshLeaf(55);

    await addLeaf(newLeaf);

    const rootAfterAdd = (await fetchStateTree()).root;
    const leaves = await fetchAllLeaves();
    const newRecord = leaves.find((leaf) => toHex(leaf.hash) === toHex(newLeaf));

    assert.exists(newRecord);
    assert.notEqual(toHex(rootBeforeAdd), toHex(rootAfterAdd));

    const proof = getProofForIndex(
      hashPair,
      leaves,
      zeroHashes,
      newRecord!.index
    );
    assert.equal(toHex(proof.root), toHex(rootAfterAdd));
  });
});
