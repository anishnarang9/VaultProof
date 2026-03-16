import * as anchor from "@coral-xyz/anchor";
import { execFileSync } from "child_process";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";

export const ROOT = "/Users/anishnarang/VaultProof";
export const BN254_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function usd(dollars: number): bigint {
  return BigInt(dollars) * 1_000_000n;
}

export function bigintToBytes32(value: bigint): Buffer {
  const hex = value.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

export function bytesToBigint(bytes: Uint8Array): bigint {
  return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

export function publicKeyToField(pubkey: PublicKey): bigint {
  return bytesToBigint(pubkey.toBytes());
}

export function isFieldCompatible(pubkey: PublicKey): boolean {
  return publicKeyToField(pubkey) < BN254_FIELD;
}

export async function airdropIfNeeded(
  provider: anchor.AnchorProvider,
  pubkey: PublicKey,
  minimumLamports = anchor.web3.LAMPORTS_PER_SOL
) {
  const balance = await provider.connection.getBalance(pubkey, "confirmed");
  if (balance >= minimumLamports) {
    return;
  }

  const signature = await provider.connection.requestAirdrop(
    pubkey,
    minimumLamports * 2
  );
  await provider.connection.confirmTransaction(signature, "confirmed");
}

export async function generateFieldCompatibleKeypair(
  provider: anchor.AnchorProvider
) {
  while (true) {
    const candidate = Keypair.generate();
    if (!isFieldCompatible(candidate.publicKey)) {
      continue;
    }

    await airdropIfNeeded(provider, candidate.publicKey);
    return candidate;
  }
}

export function computeSha256(buffers: Buffer[]) {
  const hash = createHash("sha256");
  for (const buffer of buffers) {
    hash.update(buffer);
  }
  return hash.digest();
}

export function enumVariantName(value: unknown) {
  if (!value || typeof value !== "object") {
    return String(value);
  }

  return Object.keys(value as Record<string, unknown>)[0] ?? "";
}

export function run(command: string, args: string[]) {
  try {
    execFileSync(command, args, {
      cwd: ROOT,
      stdio: "pipe",
    });
  } catch (error: any) {
    const stdout = error.stdout?.toString() ?? "";
    const stderr = error.stderr?.toString() ?? "";
    throw new Error(`${command} ${args.join(" ")} failed\n${stdout}\n${stderr}`.trim());
  }
}
