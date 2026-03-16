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

describe("kyc_registry_light", () => {
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
    Array.from({ length: 32 }, (_, index) => (index + 1) & 0xff)
  );

  let hashPair: (...inputs: Buffer[]) => Buffer;
  let zeroHashes: Buffer[];

  function makeLeaf(seed: number) {
    return hashPair(
      bigIntToBuffer(BigInt(seed)),
      bigIntToBuffer(BigInt(seed * 1000))
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
    const existing = await fetchRegistryNullable();
    if (existing) {
      return { created: false, signature: null as string | null };
    }

    const signature = await (program.methods as any)
      .initializeRegistry(stateTreePda, Array.from(issuerPubkey))
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { created: true, signature };
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

  async function addCredential(
    leafHash: Buffer,
    signer: PublicKey,
    signers: Keypair[] = []
  ) {
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

    let builder = (program.methods as any)
      .addCredential(
        Array.from(leafHash),
        proof.map((node) => Array.from(node))
      )
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        credentialLeaf: credentialLeafPda,
        authority: signer,
        systemProgram: SystemProgram.programId,
      });

    if (signers.length > 0) {
      builder = builder.signers(signers);
    }

    const signature = await builder.rpc();
    return { signature, credentialLeafPda };
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
  });

  it("initialize_registry creates registry with correct state_tree reference", async function () {
    this.timeout(60_000);

    const { created, signature } = await ensureRegistryInitialized();
    const registry = await programAccounts.kycRegistry.fetch(registryPda);
    const stateTree = await programAccounts.stateTree.fetch(stateTreePda);

    await ensureAuthority(authority.publicKey);

    assert.equal(registry.stateTree.toBase58(), stateTreePda.toBase58());
    assert.deepEqual(
      Array.from(registry.issuerPubkey),
      Array.from(issuerPubkey)
    );
    assert.equal(stateTree.depth, STATE_TREE_DEPTH);
    assert.equal(stateTree.registry.toBase58(), registryPda.toBase58());
    assert.equal(Buffer.from(stateTree.root).length, 32);

    if (created) {
      assert.equal(registry.credentialCount.toString(), "0");
      assert.equal(registry.revokedCount.toString(), "0");
      assert.equal(
        toHex(Buffer.from(stateTree.root)),
        toHex(zeroHashes[STATE_TREE_DEPTH])
      );

      const events = await decodeEvents(program, signature!);
      assert.isEmpty(events, "registry init should not emit credential events");
    }
  });

  it("StateTree root is readable and matches the expected Poseidon root after add", async function () {
    this.timeout(60_000);

    await ensureRegistryInitialized();
    await ensureAuthority(authority.publicKey);

    const stateTreeBefore = await fetchStateTree();
    const leafHash = await nextFreshLeaf(1);
    const { signature } = await addCredential(leafHash, authority.publicKey);

    const registry = await programAccounts.kycRegistry.fetch(registryPda);
    const stateTreeAfter = await fetchStateTree();
    const activeLeaves = await fetchAllLeaves();
    const addedLeaf = activeLeaves.find((leaf) => toHex(leaf.hash) === toHex(leafHash));
    const events = await decodeEvents(program, signature);

    assert.exists(addedLeaf);
    assert.equal(registry.credentialCount.toString(), activeLeaves.length.toString());
    assert.equal(stateTreeAfter.nextIndex, stateTreeBefore.nextIndex + 1);
    assert.notEqual(toHex(stateTreeBefore.root), toHex(stateTreeAfter.root));
    assert.equal(
      toHex(
        getProofForIndex(hashPair, activeLeaves, zeroHashes, addedLeaf!.index).root
      ),
      toHex(stateTreeAfter.root)
    );

    const addedEvent = events.find((event) => event.name === "credentialAdded");
    assert.exists(addedEvent);
    assert.deepEqual(
      Array.from(addedEvent?.data.leafHash ?? []),
      Array.from(leafHash)
    );
  });

  it("multiple add_credential calls produce distinct roots and valid proofs", async function () {
    this.timeout(60_000);

    await ensureRegistryInitialized();
    await ensureAuthority(authority.publicKey);

    const firstLeaf = await nextFreshLeaf(2);
    const firstBefore = await fetchStateTree();
    await addCredential(firstLeaf, authority.publicKey);
    const firstAfter = await fetchStateTree();

    const secondLeaf = await nextFreshLeaf(3);
    await addCredential(secondLeaf, authority.publicKey);
    const secondAfter = await fetchStateTree();

    const activeLeaves = await fetchAllLeaves();
    const newestLeaf = activeLeaves.find((leaf) => toHex(leaf.hash) === toHex(secondLeaf));

    assert.notEqual(toHex(firstBefore.root), toHex(firstAfter.root));
    assert.notEqual(toHex(firstAfter.root), toHex(secondAfter.root));
    assert.exists(newestLeaf);

    const merkleProof = getProofForIndex(
      hashPair,
      activeLeaves,
      zeroHashes,
      newestLeaf!.index
    );

    assert.equal(toHex(merkleProof.root), toHex(secondAfter.root));
    assert.equal(
      toHex(
        computeRootFromProof(
          hashPair,
          newestLeaf!.hash,
          newestLeaf!.index,
          merkleProof.proof
        )
      ),
      toHex(secondAfter.root)
    );
  });

  it("transfer_authority changes authority and rejects the old authority afterwards", async function () {
    this.timeout(60_000);

    await ensureRegistryInitialized();
    await ensureAuthority(authority.publicKey);

    await (program.methods as any)
      .transferAuthority(secondaryAuthority.publicKey)
      .accounts({
        registry: registryPda,
        authority: authority.publicKey,
      })
      .rpc();

    const registryAfterTransfer = await programAccounts.kycRegistry.fetch(registryPda);
    assert.equal(
      registryAfterTransfer.authority.toBase58(),
      secondaryAuthority.publicKey.toBase58()
    );

    const unauthorizedLeaf = await nextFreshLeaf(4);
    const stateTree = await fetchStateTree();
    const staleAuthorityProof = getProofForIndex(
      hashPair,
      await fetchAllLeaves(),
      zeroHashes,
      stateTree.nextIndex
    ).proof;
    const [credentialLeafPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("credential_leaf"), registryPda.toBuffer(), unauthorizedLeaf],
      program.programId
    );

    await expectReject(
      (program.methods as any)
        .addCredential(
          Array.from(unauthorizedLeaf),
          staleAuthorityProof.map((node) => Array.from(node))
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

    await ensureAuthority(authority.publicKey);
    const restoredRegistry = await programAccounts.kycRegistry.fetch(registryPda);
    assert.equal(
      restoredRegistry.authority.toBase58(),
      authority.publicKey.toBase58()
    );
  });

  it("only the current authority can add_credential", async function () {
    this.timeout(60_000);

    await ensureRegistryInitialized();
    await ensureAuthority(authority.publicKey);
    await ensureAuthority(secondaryAuthority.publicKey);

    const authorizedLeaf = await nextFreshLeaf(5);
    await addCredential(authorizedLeaf, secondaryAuthority.publicKey, [
      secondaryAuthority,
    ]);

    const activeLeaves = await fetchAllLeaves();
    const addedLeaf = activeLeaves.find(
      (leaf) => toHex(leaf.hash) === toHex(authorizedLeaf)
    );
    const stateTree = await fetchStateTree();

    assert.exists(addedLeaf);
    assert.isTrue(addedLeaf!.active);
    assert.equal(addedLeaf?.index, stateTree.nextIndex - 1);

    await ensureAuthority(authority.publicKey);
  });
});
