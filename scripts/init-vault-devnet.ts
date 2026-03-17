import * as anchor from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

const ROOT = resolve(__dirname, "..");
const TEST_YIELD_VENUE = Keypair.fromSeed(Uint8Array.from(Array(32).fill(9))).publicKey;
const USDC_DECIMALS = 1_000_000n;
const RISK_LIMITS = {
  circuitBreakerThreshold: 100_000n * USDC_DECIMALS,
  maxSingleDeposit: 50_000n * USDC_DECIMALS,
  maxSingleTransaction: 50_000n * USDC_DECIMALS,
  maxDailyTransactions: 100,
};
const TEST_YIELD_AMOUNT = 100n * USDC_DECIMALS;

type InitializedVault = {
  authority: PublicKey;
  usdcMint: PublicKey;
  usdcReservePda: PublicKey;
  vaultProgram: anchor.Program<any>;
  vaultState: any;
  vaultStatePda: PublicKey;
  yieldVenuePda: PublicKey;
};

function bn(value: bigint | number) {
  return new anchor.BN(value.toString());
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

function deriveYieldVenuePda(programId: PublicKey, vaultStatePda: PublicKey, venue: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yield_venue"), vaultStatePda.toBuffer(), venue.toBuffer()],
    programId,
  );
}

export async function initializeDevnetVault(): Promise<InitializedVault> {
  process.env.ANCHOR_PROVIDER_URL ??= "https://api.devnet.solana.com";
  process.env.ANCHOR_WALLET ??= `${process.env.HOME}/.config/solana/id.json`;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const authority = provider.wallet.publicKey;
  const payer = providerPayer(provider);
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
        authority,
        null,
        6,
      );
      console.log(`Created test USDC mint: ${usdcMint.toBase58()}`);
    }

    const shareMint = Keypair.generate();
    const signature = await (vaultProgram.methods as any)
      .initializeVault(bytes32Sequence(7), bytes32Sequence(8))
      .accounts({
        authority,
        shareMint: shareMint.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        usdcMint,
        usdcReserve: usdcReservePda,
        vaultState: vaultStatePda,
      })
      .signers([shareMint])
      .rpc();

    console.log(`Vault initialized: ${signature}`);
    console.log(`Share mint: ${shareMint.publicKey.toBase58()}`);
  }

  let vaultState = await (vaultProgram.account as any).vaultState.fetch(vaultStatePda);
  if (!vaultState.authority.equals(authority)) {
    throw new Error(
      `Vault authority is ${vaultState.authority.toBase58()}, but this script expects direct control by ${authority.toBase58()}. Use scripts/init-devnet-state.ts for the Squads-governed flow.`,
    );
  }

  usdcMint = new PublicKey(vaultState.usdcMint);

  await (vaultProgram.methods as any)
    .updateRiskLimits(
      bn(RISK_LIMITS.circuitBreakerThreshold),
      bn(RISK_LIMITS.maxSingleTransaction),
      bn(RISK_LIMITS.maxSingleDeposit),
      RISK_LIMITS.maxDailyTransactions,
    )
    .accounts({
      authority,
      vaultState: vaultStatePda,
    })
    .rpc();

  await (vaultProgram.methods as any)
    .updateCustodyProvider({ selfCustody: {} }, authority)
    .accounts({
      authority,
      vaultState: vaultStatePda,
    })
    .rpc();

  const existingYieldVenue = await provider.connection.getAccountInfo(yieldVenuePda, "confirmed");
  if (!existingYieldVenue) {
    await (vaultProgram.methods as any)
      .addYieldVenue(
        TEST_YIELD_VENUE,
        "Kamino Devnet",
        bytes32Sequence(11),
        6_500,
        2,
      )
      .accounts({
        authority,
        systemProgram: SystemProgram.programId,
        vaultState: vaultStatePda,
        yieldVenue: yieldVenuePda,
      })
      .rpc();
  }

  vaultState = await (vaultProgram.account as any).vaultState.fetch(vaultStatePda);
  if (BigInt(vaultState.totalYieldEarned.toString()) === 0n) {
    await (vaultProgram.methods as any)
      .accrueYield(bn(TEST_YIELD_AMOUNT))
      .accounts({
        authority,
        vaultState: vaultStatePda,
      })
      .rpc();
    vaultState = await (vaultProgram.account as any).vaultState.fetch(vaultStatePda);
  }

  await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    usdcMint,
    authority,
  );

  return {
    authority,
    usdcMint,
    usdcReservePda,
    vaultProgram,
    vaultState,
    vaultStatePda,
    yieldVenuePda,
  };
}

async function main() {
  const result = await initializeDevnetVault();

  console.log("=== VaultProof Devnet Vault Initialization ===");
  console.log(`Authority: ${result.authority.toBase58()}`);
  console.log(`Vault program: ${result.vaultProgram.programId.toBase58()}`);
  console.log(`Vault state: ${result.vaultStatePda.toBase58()}`);
  console.log(`USDC reserve: ${result.usdcReservePda.toBase58()}`);
  console.log(`USDC mint: ${result.usdcMint.toBase58()}`);
  console.log(`Yield venue: ${result.yieldVenuePda.toBase58()}`);
  console.log(`Circuit breaker threshold: ${result.vaultState.circuitBreakerThreshold.toString()}`);
  console.log(`Total yield earned: ${result.vaultState.totalYieldEarned.toString()}`);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
