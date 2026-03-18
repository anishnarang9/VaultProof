import * as anchor from "@coral-xyz/anchor";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint } from "@solana/spl-token";

import { buildDevnetCredential } from "./devnet-credential";
import {
  airdropIfNeeded,
  createApproveExecuteVaultTransaction,
  createSquadsMultisig,
  SQUADS_PROGRAM_ID,
  transferLamports,
  type SquadsContext,
} from "./squads";

const ROOT = resolve(__dirname, "..");
const OUTPUT_DIR = resolve(ROOT, "target", "devnet");
const STATE_TREE_DEPTH = 20;
const TEST_YIELD_VENUE = Keypair.fromSeed(Uint8Array.from(Array(32).fill(9))).publicKey;
const USDC_DECIMALS = 1_000_000n;
const RISK_LIMITS = {
  circuitBreakerThreshold: 100_000n * USDC_DECIMALS,
  maxSingleDeposit: 50_000n * USDC_DECIMALS,
  maxSingleTransaction: 50_000n * USDC_DECIMALS,
  maxDailyTransactions: 100,
};

type SparseLeaf = {
  active: boolean;
  hash: Buffer;
  index: number;
};

function bn(value: bigint | number) {
  return new anchor.BN(value.toString());
}

function bigIntToBuffer(value: bigint) {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}

function bufferToBigInt(value: Buffer) {
  return BigInt(`0x${value.toString("hex")}`);
}

function toHex(value: Buffer) {
  return value.toString("hex");
}

function fromHex(value: string) {
  return Buffer.from(value, "hex");
}

function bytes32Sequence(offset: number) {
  return Array.from({ length: 32 }, (_, index) => (index + offset) & 0xff);
}

function loadIdl(name: string) {
  const idlPath = resolve(ROOT, "target", "idl", `${name}.json`);
  return JSON.parse(readFileSync(idlPath, "utf8"));
}

function providerPayer(provider: anchor.AnchorProvider) {
  const payer = (provider.wallet as any).payer;
  if (!payer) {
    throw new Error("Anchor provider wallet does not expose a payer keypair.");
  }

  return payer as Keypair;
}

function loadOrCreateKeypair(path: string) {
  if (existsSync(path)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  }

  const keypair = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

async function fundFromPayerIfNeeded(
  connection: anchor.web3.Connection,
  payer: Keypair,
  recipient: PublicKey,
  minimumLamports = LAMPORTS_PER_SOL / 10,
) {
  const balance = await connection.getBalance(recipient, "confirmed");
  if (balance >= minimumLamports) {
    return;
  }

  await transferLamports(connection, payer, recipient, minimumLamports + LAMPORTS_PER_SOL / 20);
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

async function ensureRegistry(provider: anchor.AnchorProvider) {
  const idl = loadIdl("kyc_registry");
  const program = new anchor.Program(idl, provider);
  const programAccounts = program.account as any;

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("kyc_registry")],
    program.programId,
  );
  const [stateTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state_tree"), registryPda.toBuffer()],
    program.programId,
  );

  const issuerPubkey = Uint8Array.from(
    Array.from({ length: 32 }, (_, index) => (index + 1) & 0xff),
  );
  const registryInfo = await provider.connection.getAccountInfo(registryPda, "confirmed");

  if (!registryInfo) {
    await (program.methods as any)
      .initializeRegistry(stateTreePda, Array.from(issuerPubkey))
      .accounts({
        authority: provider.wallet.publicKey,
        registry: registryPda,
        stateTree: stateTreePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  return {
    program,
    programAccounts,
    registryPda,
    stateTreePda,
  };
}

function deriveYieldVenuePda(programId: PublicKey, vaultStatePda: PublicKey, venue: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yield_venue"), vaultStatePda.toBuffer(), venue.toBuffer()],
    programId,
  );
}

async function loadOrCreateSquadsContext(
  provider: anchor.AnchorProvider,
  payer: Keypair,
): Promise<SquadsContext> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const memberPaths = [1, 2, 3].map((index) =>
    resolve(OUTPUT_DIR, `squads-member-${index}.json`),
  );
  const members = memberPaths.map((path) => loadOrCreateKeypair(path)) as [
    Keypair,
    Keypair,
    Keypair,
  ];
  const contextPath = resolve(OUTPUT_DIR, "squads-context.json");

  await airdropIfNeeded(provider.connection, payer.publicKey, LAMPORTS_PER_SOL / 2);
  for (const member of members) {
    await fundFromPayerIfNeeded(provider.connection, payer, member.publicKey, LAMPORTS_PER_SOL / 10);
  }

  if (existsSync(contextPath)) {
    const persisted = JSON.parse(readFileSync(contextPath, "utf8"));
    const multisigPda = new PublicKey(persisted.multisigPda);
    const vaultPda = new PublicKey(persisted.vaultPda);
    const accountInfo = await provider.connection.getAccountInfo(multisigPda, "confirmed");

    if (accountInfo) {
      return {
        createKey: loadOrCreateKeypair(resolve(OUTPUT_DIR, "squads-create-key.json")),
        members,
        multisigPda,
        programId: new PublicKey(persisted.programId),
        threshold: persisted.threshold,
        vaultIndex: persisted.vaultIndex,
        vaultPda,
      };
    }
  }

  const squads = await createSquadsMultisig(provider.connection, members, 2, SQUADS_PROGRAM_ID);
  await fundFromPayerIfNeeded(provider.connection, payer, squads.vaultPda, LAMPORTS_PER_SOL / 2);
  writeFileSync(
    resolve(OUTPUT_DIR, "squads-create-key.json"),
    JSON.stringify(Array.from(squads.createKey.secretKey)),
  );
  writeFileSync(
    contextPath,
    JSON.stringify(
      {
        members: squads.members.map((member) => member.publicKey.toBase58()),
        multisigPda: squads.multisigPda.toBase58(),
        programId: squads.programId.toBase58(),
        threshold: squads.threshold,
        vaultIndex: squads.vaultIndex,
        vaultPda: squads.vaultPda.toBase58(),
      },
      null,
      2,
    ),
  );

  return squads;
}

async function buildVaultMessage(
  connection: anchor.web3.Connection,
  payerKey: PublicKey,
  instructions: anchor.web3.TransactionInstruction[],
) {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  return new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions,
  });
}

async function ensureVaultViaSquads(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  squads: SquadsContext,
) {
  const idl = loadIdl("vusd_vault");
  const vaultProgram = new anchor.Program(idl, provider);
  const [vaultStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state")],
    vaultProgram.programId,
  );
  const [usdcReservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("usdc_reserve")],
    vaultProgram.programId,
  );
  const [yieldVenuePda] = deriveYieldVenuePda(
    vaultProgram.programId,
    vaultStatePda,
    TEST_YIELD_VENUE,
  );

  let usdcMint = process.env.VAULTPROOF_TEST_USDC_MINT
    ? new PublicKey(process.env.VAULTPROOF_TEST_USDC_MINT)
    : undefined;
  const existingVault = await provider.connection.getAccountInfo(vaultStatePda, "confirmed");
  if (!existingVault) {
    if (!usdcMint) {
      usdcMint = await createMint(
        provider.connection,
        payer,
        payer.publicKey,
        null,
        6,
      );
    }

    const shareMint = Keypair.generate();
    const instruction = await (vaultProgram.methods as any)
      .initializeVault(bytes32Sequence(7), bytes32Sequence(8))
      .accounts({
        authority: squads.vaultPda,
        shareMint: shareMint.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        usdcMint,
        usdcReserve: usdcReservePda,
        vaultState: vaultStatePda,
      })
      .instruction();
    const message = await buildVaultMessage(provider.connection, squads.vaultPda, [instruction]);

    await createApproveExecuteVaultTransaction({
      additionalSigners: [shareMint],
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      feePayer: squads.members[0],
      instructionLabel: "initialize_vault",
      multisigPda: squads.multisigPda,
      programId: squads.programId,
      transactionMessage: message,
      vaultIndex: squads.vaultIndex,
    });
  }

  let vaultState = await (vaultProgram.account as any).vaultState.fetch(vaultStatePda);
  if (!vaultState.authority.equals(squads.vaultPda)) {
    throw new Error(
      `Vault authority ${vaultState.authority.toBase58()} does not match Squads vault ${squads.vaultPda.toBase58()}. Fresh deploy required because the vault program does not expose an authority handoff instruction.`,
    );
  }

  usdcMint = new PublicKey(vaultState.usdcMint);

  const riskInstruction = await (vaultProgram.methods as any)
    .updateRiskLimits(
      bn(RISK_LIMITS.circuitBreakerThreshold),
      bn(RISK_LIMITS.maxSingleTransaction),
      bn(RISK_LIMITS.maxSingleDeposit),
      RISK_LIMITS.maxDailyTransactions,
    )
    .accounts({
      authority: squads.vaultPda,
      vaultState: vaultStatePda,
    })
    .instruction();
  await createApproveExecuteVaultTransaction({
    approver: squads.members[1],
    connection: provider.connection,
    creator: squads.members[0],
    feePayer: squads.members[0],
    instructionLabel: "update_risk_limits",
    multisigPda: squads.multisigPda,
    programId: squads.programId,
    transactionMessage: await buildVaultMessage(provider.connection, squads.vaultPda, [
      riskInstruction,
    ]),
    vaultIndex: squads.vaultIndex,
  });

  const custodyInstruction = await (vaultProgram.methods as any)
    .updateCustodyProvider({ selfCustody: {} }, squads.vaultPda)
    .accounts({
      authority: squads.vaultPda,
      vaultState: vaultStatePda,
    })
    .instruction();
  await createApproveExecuteVaultTransaction({
    approver: squads.members[1],
    connection: provider.connection,
    creator: squads.members[0],
    feePayer: squads.members[0],
    instructionLabel: "update_custody_provider",
    multisigPda: squads.multisigPda,
    programId: squads.programId,
    transactionMessage: await buildVaultMessage(provider.connection, squads.vaultPda, [
      custodyInstruction,
    ]),
    vaultIndex: squads.vaultIndex,
  });

  const existingYieldVenue = await provider.connection.getAccountInfo(yieldVenuePda, "confirmed");
  if (!existingYieldVenue) {
    const venueInstruction = await (vaultProgram.methods as any)
      .addYieldVenue(
        TEST_YIELD_VENUE,
        "Kamino Devnet",
        bytes32Sequence(11),
        6_500,
        2,
      )
      .accounts({
        authority: squads.vaultPda,
        systemProgram: SystemProgram.programId,
        vaultState: vaultStatePda,
        yieldVenue: yieldVenuePda,
      })
      .instruction();
    await createApproveExecuteVaultTransaction({
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      feePayer: squads.members[0],
      instructionLabel: "add_yield_venue",
      multisigPda: squads.multisigPda,
      programId: squads.programId,
      transactionMessage: await buildVaultMessage(provider.connection, squads.vaultPda, [
        venueInstruction,
      ]),
      vaultIndex: squads.vaultIndex,
    });
  }

  vaultState = await (vaultProgram.account as any).vaultState.fetch(vaultStatePda);
  return {
    usdcMint,
    usdcReservePda,
    vaultProgram,
    vaultState,
    vaultStatePda,
    yieldVenuePda,
  };
}

async function issueCredential(
  provider: anchor.AnchorProvider,
  registryProgram: anchor.Program<any>,
  registryAccounts: any,
  registryPda: PublicKey,
  stateTreePda: PublicKey,
) {
  const investorKeypair = loadOrCreateKeypair(resolve(OUTPUT_DIR, "investor.json"));
  await fundFromPayerIfNeeded(provider.connection, providerPayer(provider), investorKeypair.publicKey);

  const artifact = await buildDevnetCredential({
    accreditation: (process.env.VAULTPROOF_CREDENTIAL_TIER as any) ?? "accredited",
    countryCode: process.env.VAULTPROOF_CREDENTIAL_COUNTRY ?? "US",
    dateOfBirth: process.env.VAULTPROOF_CREDENTIAL_DOB ?? "1990-01-01",
    expiresAt: process.env.VAULTPROOF_CREDENTIAL_EXPIRY ?? "2027-12-31",
    fullName: process.env.VAULTPROOF_CREDENTIAL_NAME ?? "VaultProof Devnet Investor",
    identitySecret: process.env.VAULTPROOF_IDENTITY_SECRET ?? "42424242424242",
    jurisdiction: process.env.VAULTPROOF_CREDENTIAL_JURISDICTION ?? "US",
    sourceOfFundsReference:
      process.env.VAULTPROOF_SOURCE_OF_FUNDS ??
      "Wire transfer from regulated bank account",
    wallet: investorKeypair.publicKey,
    credentialVersion: Number(process.env.VAULTPROOF_CREDENTIAL_VERSION ?? "1"),
  });

  const leafHash = Buffer.from(artifact.leafHashHex.slice(2), "hex");
  const [credentialLeafPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("credential_leaf"), registryPda.toBuffer(), leafHash],
    registryProgram.programId,
  );
  const existingLeaf = await provider.connection.getAccountInfo(credentialLeafPda, "confirmed");

  if (!existingLeaf) {
    const poseidon = await loadPoseidon();
    const stateTree = await registryAccounts.stateTree.fetch(stateTreePda);
    const nextIndex = Number(stateTree.nextIndex);
    const leaves = await registryAccounts.credentialLeaf.all();
    const activeLeaves: SparseLeaf[] = leaves
      .filter((entry: any) => entry.account.registry.equals(registryPda))
      .map((entry: any) => ({
        active: entry.account.active,
        hash: Buffer.from(entry.account.leafHash),
        index: entry.account.leafIndex,
      }));
    const proof = getProofForIndex(poseidon.hash, activeLeaves, poseidon.zeroHashes, nextIndex).proof;

    await (registryProgram.methods as any)
      .addCredential(
        Array.from(leafHash),
        proof.map((node) => Array.from(node)),
      )
      .accounts({
        authority: provider.wallet.publicKey,
        credentialLeaf: credentialLeafPda,
        registry: registryPda,
        stateTree: stateTreePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  const outputPath = resolve(OUTPUT_DIR, `credential-${investorKeypair.publicKey.toBase58()}.json`);
  writeFileSync(outputPath, JSON.stringify(artifact, null, 2));

  return {
    artifact,
    credentialLeafPda,
    investorKeypair,
    outputPath,
  };
}

async function main() {
  process.env.ANCHOR_PROVIDER_URL ??= "https://api.devnet.solana.com";
  process.env.ANCHOR_WALLET ??= `${process.env.HOME}/.config/solana/id.json`;
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = providerPayer(provider);

  const registry = await ensureRegistry(provider);
  const squads = await loadOrCreateSquadsContext(provider, payer);
  const vault = await ensureVaultViaSquads(provider, payer, squads);
  const credential = await issueCredential(
    provider,
    registry.program,
    registry.programAccounts,
    registry.registryPda,
    registry.stateTreePda,
  );
  const stateTree = await registry.programAccounts.stateTree.fetch(registry.stateTreePda);

  console.log("=== VaultProof Devnet State ===");
  console.log(`Registry: ${registry.registryPda.toBase58()}`);
  console.log(`State tree: ${registry.stateTreePda.toBase58()}`);
  console.log(`Merkle root: ${Buffer.from(stateTree.root as number[]).toString("hex")}`);
  console.log(`Squads multisig: ${squads.multisigPda.toBase58()}`);
  console.log(`Squads vault PDA: ${squads.vaultPda.toBase58()}`);
  console.log(`Vault state: ${vault.vaultStatePda.toBase58()}`);
  console.log(`Vault authority: ${vault.vaultState.authority.toBase58()}`);
  console.log(`Yield venue: ${vault.yieldVenuePda.toBase58()}`);
  console.log(`Credential leaf: ${credential.credentialLeafPda.toBase58()}`);
  console.log(`Credential file: ${credential.outputPath}`);
  console.log(`Source-of-funds hash: ${credential.artifact.sourceOfFundsHashHex}`);
  console.log(`Credential version: ${credential.artifact.credentialVersion}`);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
