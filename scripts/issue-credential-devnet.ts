import * as anchor from "@coral-xyz/anchor";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { buildDevnetCredential } from "./devnet-credential";

const ROOT = resolve(__dirname, "..");
const OUTPUT_DIR = resolve(ROOT, "target", "devnet");
const STATE_TREE_DEPTH = 20;

function loadIdl(name: string) {
  return JSON.parse(readFileSync(resolve(ROOT, "target", "idl", `${name}.json`), "utf8"));
}

function bigIntToBuffer(value: bigint) {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}

function bufferToBigInt(value: Buffer) {
  return BigInt(`0x${value.toString("hex")}`);
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

function getProofForIndex(
  hashPair: (...inputs: Buffer[]) => Buffer,
  zeroHashes: Buffer[],
  index: number,
) {
  const proof: Buffer[] = [];
  for (let level = 0; level < STATE_TREE_DEPTH; level += 1) {
    proof.push(zeroHashes[level]);
  }
  return proof;
}

async function main() {
  process.env.ANCHOR_PROVIDER_URL ??= "https://api.devnet.solana.com";
  process.env.ANCHOR_WALLET ??= `${process.env.HOME}/.config/solana/id.json`;
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const authority = provider.wallet.publicKey;

  const idl = loadIdl("kyc_registry");
  const program = new anchor.Program(idl as any, provider) as any;

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("kyc_registry")],
    program.programId,
  );
  const [stateTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state_tree"), registryPda.toBuffer()],
    program.programId,
  );

  const artifact = await buildDevnetCredential({
    accreditation: "accredited",
    countryCode: "US",
    dateOfBirth: "1990-01-01",
    expiresAt: "2027-12-31",
    fullName: "VaultProof Devnet Investor",
    identitySecret: "42424242424242",
    jurisdiction: "US",
    sourceOfFundsReference: "Wire transfer from regulated bank account",
    wallet: authority,
    credentialVersion: 1,
  });

  const leafHash = Buffer.from(artifact.leafHashHex.slice(2), "hex");
  const [credentialLeafPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("credential_leaf"), registryPda.toBuffer(), leafHash],
    program.programId,
  );

  const existingLeaf = await provider.connection.getAccountInfo(credentialLeafPda, "confirmed");
  if (existingLeaf) {
    console.log("Credential already exists at", credentialLeafPda.toBase58());
  } else {
    const poseidon = await loadPoseidon();
    const stateTree = await (program.account as any).stateTree.fetch(stateTreePda);
    const nextIndex = Number(stateTree.nextIndex);

    const proof = getProofForIndex(poseidon.hash, poseidon.zeroHashes, nextIndex);

    const sig = await (program.methods as any)
      .addCredential(
        Array.from(leafHash),
        proof.map((node: Buffer) => Array.from(node)),
      )
      .accounts({
        authority,
        credentialLeaf: credentialLeafPda,
        registry: registryPda,
        stateTree: stateTreePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Credential added:", sig);
  }

  // Build StoredCredential format for frontend
  const storedCredential = {
    fullName: artifact.fullName,
    dateOfBirth: artifact.dateOfBirth,
    countryCode: artifact.countryCode,
    jurisdiction: artifact.jurisdiction,
    accreditationStatus: artifact.accreditationStatus,
    credentialExpiry: artifact.credentialExpiry,
    credentialVersion: artifact.credentialVersion,
    identitySecret: artifact.identitySecret,
    sourceOfFundsReference: artifact.sourceOfFundsReference,
    sourceOfFundsHashHex: artifact.sourceOfFundsHashHex,
    leafHashHex: artifact.leafHashHex,
    wallet: artifact.wallet,
  };

  const outputPath = resolve(OUTPUT_DIR, "credential.json");
  writeFileSync(outputPath, JSON.stringify(storedCredential, null, 2));

  console.log("=== Credential Issued ===");
  console.log(`Wallet: ${artifact.wallet}`);
  console.log(`Leaf hash: ${artifact.leafHashHex}`);
  console.log(`Credential PDA: ${credentialLeafPda.toBase58()}`);
  console.log(`Source of funds hash: ${artifact.sourceOfFundsHashHex}`);
  console.log(`Saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
