import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';

const VAULT_PROGRAM_ID = new PublicKey('CUxwkHjKjGyKa5H1qEQySw98yKn33RZFxc9TbVgU6rdu');
const KYC_PROGRAM_ID = new PublicKey('NsgKr1qCEUb1vXdwaGvbz3ygG4R4SCrUQm3T8tHoqgD');

// Use the test USDC mint we just created — update this if you create a new one
const TEST_USDC_MINT = new PublicKey('Rzy12Rn2BeyWMo47P5byzkKFPAWsvJqg19ju2Mmu8Da');

async function main() {
  process.env.ANCHOR_PROVIDER_URL ??= 'https://api.devnet.solana.com';
  process.env.ANCHOR_WALLET ??= `${process.env.HOME}/.config/solana/id.json`;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const authority = provider.wallet.publicKey;
  const connection = provider.connection;

  console.log('=== VaultProof Devnet Vault Initialization ===');
  console.log(`Authority: ${authority.toBase58()}`);
  console.log(`USDC Mint: ${TEST_USDC_MINT.toBase58()}`);

  // Load vault IDL
  const idlPath = resolve(process.cwd(), 'target/idl/vusd_vault.json');
  let idl: any;
  try {
    idl = JSON.parse(readFileSync(idlPath, 'utf8'));
  } catch {
    console.error('IDL not found at', idlPath);
    console.error('Run "anchor build" first to generate the IDL.');
    process.exit(1);
  }

  const vaultProgram = new anchor.Program(idl, provider);

  // Derive PDAs
  const [vaultStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_state')],
    VAULT_PROGRAM_ID,
  );
  const [usdcReservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('usdc_reserve')],
    VAULT_PROGRAM_ID,
  );

  console.log(`Vault State PDA: ${vaultStatePda.toBase58()}`);
  console.log(`USDC Reserve PDA: ${usdcReservePda.toBase58()}`);

  // Check if vault already initialized
  const vaultInfo = await connection.getAccountInfo(vaultStatePda, 'confirmed');
  if (vaultInfo) {
    console.log('\nVault already initialized!');
    console.log('Skipping initialization...');
  } else {
    console.log('\nInitializing vault...');

    // Create the share mint keypair (needs to be a fresh keypair for init)
    const shareMintKeypair = Keypair.generate();
    console.log(`Share Mint: ${shareMintKeypair.publicKey.toBase58()}`);

    // Regulator keys (test values — 32 bytes each)
    const regulatorPubKeyX = Array.from({ length: 32 }, (_, i) => (i + 7) & 0xff);
    const regulatorPubKeyY = Array.from({ length: 32 }, (_, i) => (i + 8) & 0xff);

    try {
      const tx = await (vaultProgram.methods as any)
        .initializeVault(regulatorPubKeyX, regulatorPubKeyY)
        .accounts({
          vaultState: vaultStatePda,
          usdcMint: TEST_USDC_MINT,
          shareMint: shareMintKeypair.publicKey,
          usdcReserve: usdcReservePda,
          authority,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([shareMintKeypair])
        .rpc();

      console.log(`Vault initialized! Tx: ${tx}`);
      console.log(`Share Mint: ${shareMintKeypair.publicKey.toBase58()}`);
    } catch (err: any) {
      console.error('Vault initialization failed:', err.message || err);
      if (err.logs) {
        console.error('Logs:', err.logs.slice(-10));
      }
      process.exit(1);
    }
  }

  // Fund the deployer with test USDC (if ATA exists and has low balance)
  console.log('\n=== Checking Test USDC Balance ===');
  try {
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      (provider.wallet as any).payer || Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf8')))
      ),
      TEST_USDC_MINT,
      authority,
    );
    const balance = Number(ata.amount) / 1_000_000;
    console.log(`Test USDC balance: ${balance} USDC`);
    console.log(`ATA: ${ata.address.toBase58()}`);
  } catch (err: any) {
    console.log('Could not fetch USDC balance:', err.message);
  }

  // Verify KYC registry
  console.log('\n=== Verifying KYC Registry ===');
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('kyc_registry')],
    KYC_PROGRAM_ID,
  );
  const registryInfo = await connection.getAccountInfo(registryPda, 'confirmed');
  console.log(`KYC Registry: ${registryPda.toBase58()} — ${registryInfo ? 'EXISTS' : 'NOT FOUND'}`);

  // Summary
  console.log('\n=== Devnet Deployment Summary ===');
  console.log('Programs:');
  console.log(`  KYC Registry:    NsgKr1qCEUb1vXdwaGvbz3ygG4R4SCrUQm3T8tHoqgD`);
  console.log(`  vUSD Vault:      CUxwkHjKjGyKa5H1qEQySw98yKn33RZFxc9TbVgU6rdu`);
  console.log(`  Compliance Admin: BsEMZCJzj3SqwSj6z2F3X8m9rFHjLubgBzMeSgj8Lp6K`);
  console.log('Accounts:');
  console.log(`  Vault State:     ${vaultStatePda.toBase58()}`);
  console.log(`  USDC Reserve:    ${usdcReservePda.toBase58()}`);
  console.log(`  KYC Registry:    ${registryPda.toBase58()}`);
  console.log(`  Test USDC Mint:  ${TEST_USDC_MINT.toBase58()}`);
  console.log(`  Authority:       ${authority.toBase58()}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
