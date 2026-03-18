import * as anchor from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const ROOT = resolve(__dirname, "..");

process.env.ANCHOR_PROVIDER_URL ??= "https://api.devnet.solana.com";
process.env.ANCHOR_WALLET ??= `${process.env.HOME}/.config/solana/id.json`;

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const idl = JSON.parse(readFileSync(resolve(ROOT, "target/idl/kyc_registry.json"), "utf8"));
const program = new anchor.Program(idl as any, provider) as any;

const [registryPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("kyc_registry")],
  program.programId,
);
const [stateTreePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("state_tree"), registryPda.toBuffer()],
  program.programId,
);

const issuerPubkey = Uint8Array.from(
  Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff),
);

async function main() {
  const registryInfo = await provider.connection.getAccountInfo(registryPda, "confirmed");
  if (!registryInfo) {
    const sig = await (program.methods as any)
      .initializeRegistry(stateTreePda, Array.from(issuerPubkey))
      .accounts({
        authority: provider.wallet.publicKey,
        registry: registryPda,
        stateTree: stateTreePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Registry initialized:", sig);
  } else {
    console.log("Registry already exists at", registryPda.toBase58());
  }
  console.log("Registry PDA:", registryPda.toBase58());
  console.log("State tree PDA:", stateTreePda.toBase58());
}

main().catch(console.error);
