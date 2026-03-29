import * as anchor from "@coral-xyz/anchor";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { buildDevnetCredential } from "./devnet-credential";
import {
  createAccountsCoderFromIdl,
  createProgramFromIdl,
  decodeAccountData,
  decodeMatchingProgramAccounts,
  ensureRequiredIdlArtifacts,
  resolveDevnetBootstrapPlan,
} from "./devnet-bootstrap-helpers";
import { initializeDevnetVault } from "./init-vault-devnet";

const ROOT = resolve(__dirname, "..");
const OUTPUT_DIR = resolve(ROOT, "target", "devnet");
const STATE_TREE_DEPTH = 20;

type SparseLeaf = {
  active: boolean;
  hash: Buffer;
  index: number;
};

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

function loadIdl(name: string) {
  const idlPath = resolve(ROOT, "target", "idl", `${name}.json`);
  return JSON.parse(readFileSync(idlPath, "utf8"));
}

async function fetchDecodedAccount<T>(
  connection: anchor.web3.Connection,
  coder: {
    decode: (accountName: string, data: Buffer) => T;
  },
  accountName: string,
  address: PublicKey,
) {
  const info = await connection.getAccountInfo(address, "confirmed");

  if (!info) {
    throw new Error(`Account ${address.toBase58()} was not found.`);
  }

  return decodeAccountData(coder, accountName, info.data);
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

async function confirmSignature(
  connection: anchor.web3.Connection,
  signature: string,
) {
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      signature,
    },
    "confirmed",
  );
}

async function transferLamports(
  connection: anchor.web3.Connection,
  payer: Keypair,
  recipient: PublicKey,
  lamports: number,
) {
  const latest = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        lamports,
        toPubkey: recipient,
      }),
    ],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([payer]);

  const signature = await connection.sendTransaction(transaction);
  await connection.confirmTransaction(
    {
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      signature,
    },
    "confirmed",
  );
}

async function fundFromPayerIfNeeded(
  connection: anchor.web3.Connection,
  payer: Keypair,
  recipient: PublicKey,
  minimumLamports = LAMPORTS_PER_SOL,
) {
  const balance = await connection.getBalance(recipient, "confirmed");
  if (balance >= minimumLamports) {
    return;
  }

  if (recipient.equals(payer.publicKey)) {
    const signature = await connection.requestAirdrop(recipient, minimumLamports * 2);
    await confirmSignature(connection, signature);
    return;
  }

  await transferLamports(connection, payer, recipient, minimumLamports * 2);
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
  const program = createProgramFromIdl<anchor.Program<any>>(anchor, idl, provider);
  const accountsCoder = createAccountsCoderFromIdl<anchor.BorshAccountsCoder>(anchor, idl);

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
    accountsCoder,
    program,
    registryPda,
    stateTreePda,
  };
}

async function issueCredential(
  provider: anchor.AnchorProvider,
  registryAccountsCoder: anchor.BorshAccountsCoder,
  registryProgram: anchor.Program<any>,
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
    const stateTree = await fetchDecodedAccount<{ nextIndex: number }>(
      provider.connection,
      registryAccountsCoder,
      "StateTree",
      stateTreePda,
    );
    const nextIndex = Number(stateTree.nextIndex);
    const leaves = decodeMatchingProgramAccounts<{
      active: boolean;
      leafHash: number[] | Uint8Array;
      leafIndex: number;
      registry: PublicKey;
    }>(
      registryAccountsCoder,
      "CredentialLeaf",
      await provider.connection.getProgramAccounts(registryProgram.programId, {
        commitment: "confirmed",
      }),
    );
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

  const bootstrapPlan = resolveDevnetBootstrapPlan(process.env);
  ensureRequiredIdlArtifacts({
    programNames: bootstrapPlan.requiredIdlPrograms,
    rootDir: ROOT,
  });

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  await fundFromPayerIfNeeded(provider.connection, providerPayer(provider), provider.wallet.publicKey);

  const registry = await ensureRegistry(provider);
  const vault = bootstrapPlan.credentialsOnly ? null : await initializeDevnetVault();
  const credential = await issueCredential(
    provider,
    registry.accountsCoder,
    registry.program,
    registry.registryPda,
    registry.stateTreePda,
  );
  const stateTree = await fetchDecodedAccount<{ root: number[] }>(
    provider.connection,
    registry.accountsCoder,
    "StateTree",
    registry.stateTreePda,
  );

  console.log("=== VaultProof Devnet State ===");
  console.log(`Authority: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Authority model: ${bootstrapPlan.authorityModel}`);
  console.log(`Production note: ${bootstrapPlan.authorityModelNote}`);
  console.log(`Registry: ${registry.registryPda.toBase58()}`);
  console.log(`State tree: ${registry.stateTreePda.toBase58()}`);
  console.log(`Merkle root: ${Buffer.from(stateTree.root as number[]).toString("hex")}`);
  if (vault) {
    console.log(`Vault state: ${vault.vaultStatePda.toBase58()}`);
    console.log(`Vault authority: ${vault.vaultState.authority.toBase58()}`);
    console.log(`Yield venue: ${vault.yieldVenuePda.toBase58()}`);
  } else {
    console.log("Vault bootstrap: skipped because VAULTPROOF_CREDENTIALS_ONLY is enabled.");
  }
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
