/**
 * Playwright global setup — initializes on-chain state on localnet
 * so the browser e2e tests have a funded wallet, KYC registry, and vault.
 *
 * Requires solana-test-validator running with the 3 VaultProof programs deployed.
 * Typically started by `anchor test --skip-build` or manually.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import bs58 from 'bs58';

const RPC_URL = process.env.VITE_SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const ROOT = resolve(__dirname, '..', '..');
const PROJECT_ROOT = resolve(ROOT, '..');
const E2E_STATE_FILE = resolve(ROOT, 'e2e', '.localnet-state.json');

const KYC_REGISTRY_PROGRAM_ID = new PublicKey('NsgKr1qCEUb1vXdwaGvbz3ygG4R4SCrUQm3T8tHoqgD');
const VUSD_VAULT_PROGRAM_ID = new PublicKey('CUxwkHjKjGyKa5H1qEQySw98yKn33RZFxc9TbVgU6rdu');

interface LocalnetState {
  walletSecretBase58: string;
  walletPublicKey: string;
  usdcMint: string;
  shareMint: string;
  vaultInitialized: boolean;
  registryInitialized: boolean;
  credentialAdded: boolean;
}

function derivePda(programId: PublicKey, ...seeds: Buffer[]): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

export default async function globalSetup() {
  console.log('[e2e setup] Connecting to localnet:', RPC_URL);
  const connection = new Connection(RPC_URL, 'confirmed');

  // Generate or load a persistent test wallet
  let testWallet: Keypair;
  if (existsSync(E2E_STATE_FILE)) {
    const state: LocalnetState = JSON.parse(readFileSync(E2E_STATE_FILE, 'utf8'));
    testWallet = Keypair.fromSecretKey(bs58.decode(state.walletSecretBase58));
    console.log('[e2e setup] Loaded existing test wallet:', testWallet.publicKey.toBase58());
  } else {
    testWallet = Keypair.generate();
    console.log('[e2e setup] Generated new test wallet:', testWallet.publicKey.toBase58());
  }

  // Airdrop SOL
  const balance = await connection.getBalance(testWallet.publicKey);
  if (balance < 2 * LAMPORTS_PER_SOL) {
    console.log('[e2e setup] Airdropping 5 SOL...');
    const sig = await connection.requestAirdrop(testWallet.publicKey, 5 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
  }

  // Also fund the authority (default Anchor keypair) if needed
  const authorityPath = resolve(process.env.HOME ?? '~', '.config', 'solana', 'id.json');
  let authorityKeypair: Keypair;
  if (existsSync(authorityPath)) {
    authorityKeypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(authorityPath, 'utf8'))),
    );
  } else {
    authorityKeypair = testWallet; // Use test wallet as authority on localnet
  }

  const provider = new AnchorProvider(connection, new Wallet(authorityKeypair), {
    commitment: 'confirmed',
  });

  // Load IDLs
  const kycIdlPath = resolve(PROJECT_ROOT, 'target', 'idl', 'kyc_registry.json');
  const vaultIdlPath = resolve(PROJECT_ROOT, 'target', 'idl', 'vusd_vault.json');

  if (!existsSync(kycIdlPath) || !existsSync(vaultIdlPath)) {
    console.log('[e2e setup] IDL files not found — skipping on-chain init. Run anchor build first.');
    saveState(testWallet, '', '', false, false, false);
    return;
  }

  const kycIdl = JSON.parse(readFileSync(kycIdlPath, 'utf8'));
  const vaultIdl = JSON.parse(readFileSync(vaultIdlPath, 'utf8'));
  const kycProgram = new Program(kycIdl, provider);
  const vaultProgram = new Program(vaultIdl, provider);

  // Derive PDAs
  const [registryPda] = derivePda(KYC_REGISTRY_PROGRAM_ID, Buffer.from('kyc_registry'));
  const [stateTreePda] = derivePda(
    KYC_REGISTRY_PROGRAM_ID,
    Buffer.from('state_tree'),
    registryPda.toBuffer(),
  );
  const [vaultStatePda] = derivePda(VUSD_VAULT_PROGRAM_ID, Buffer.from('vault_state'));
  const [usdcReservePda] = derivePda(VUSD_VAULT_PROGRAM_ID, Buffer.from('usdc_reserve'));

  let usdcMintAddress = '';
  let shareMintAddress = '';
  let registryInitialized = false;
  let vaultInitialized = false;
  let credentialAdded = false;

  // Check if registry already exists
  const registryInfo = await connection.getAccountInfo(registryPda);
  if (!registryInfo) {
    console.log('[e2e setup] Initializing KYC registry...');
    const issuerPubkey = Uint8Array.from(
      Array.from({ length: 32 }, (_, index) => (index + 1) & 0xff),
    );
    await (kycProgram.methods as any)
      .initializeRegistry(stateTreePda, Array.from(issuerPubkey))
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        authority: authorityKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    registryInitialized = true;
  } else {
    console.log('[e2e setup] KYC registry already exists');
    registryInitialized = true;
  }

  // Check if vault already exists
  const vaultInfo = await connection.getAccountInfo(vaultStatePda);
  if (!vaultInfo) {
    console.log('[e2e setup] Creating USDC mint and initializing vault...');

    // Create USDC mint
    const usdcMint = await createMint(
      connection,
      authorityKeypair,
      authorityKeypair.publicKey,
      null,
      6,
    );
    usdcMintAddress = usdcMint.toBase58();

    // Create share mint keypair
    const shareMintKeypair = Keypair.generate();
    shareMintAddress = shareMintKeypair.publicKey.toBase58();

    // Regulator keys (test values — 32 bytes each)
    const regKeyX = Buffer.alloc(32);
    regKeyX[31] = 1;
    const regKeyY = Buffer.alloc(32);
    regKeyY[31] = 2;

    await (vaultProgram.methods as any)
      .initializeVault(Array.from(regKeyX), Array.from(regKeyY))
      .accounts({
        vaultState: vaultStatePda,
        usdcMint,
        shareMint: shareMintKeypair.publicKey,
        usdcReserve: usdcReservePda,
        authority: authorityKeypair.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([shareMintKeypair])
      .rpc();

    // Fund test wallet with USDC
    const userUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      authorityKeypair,
      usdcMint,
      testWallet.publicKey,
    );
    await mintTo(
      connection,
      authorityKeypair,
      usdcMint,
      userUsdcAccount.address,
      authorityKeypair.publicKey,
      1_000_000_000_000n, // 1M USDC
    );

    // Create share ATA for test wallet
    await getOrCreateAssociatedTokenAccount(
      connection,
      authorityKeypair,
      shareMintKeypair.publicKey,
      testWallet.publicKey,
    );

    vaultInitialized = true;
    console.log('[e2e setup] Vault initialized, test wallet funded with 1M USDC');
  } else {
    console.log('[e2e setup] Vault already exists');
    vaultInitialized = true;
    // Read existing vault state to get mint addresses
    try {
      const vaultState = await (vaultProgram.account as any).vaultState.fetch(vaultStatePda);
      usdcMintAddress = vaultState.usdcMint.toBase58();
      shareMintAddress = vaultState.shareMint.toBase58();
    } catch {
      console.log('[e2e setup] Could not read vault state');
    }
  }

  saveState(
    testWallet,
    usdcMintAddress,
    shareMintAddress,
    registryInitialized,
    vaultInitialized,
    credentialAdded,
  );

  // Export the wallet secret so Playwright config can pass it to Vite
  process.env.VITE_E2E_WALLET_SECRET = bs58.encode(testWallet.secretKey);
  process.env.VITE_E2E_WALLET_PUBKEY = testWallet.publicKey.toBase58();

  console.log('[e2e setup] Done. Wallet:', testWallet.publicKey.toBase58());
}

function saveState(
  wallet: Keypair,
  usdcMint: string,
  shareMint: string,
  registryInitialized: boolean,
  vaultInitialized: boolean,
  credentialAdded: boolean,
) {
  const state: LocalnetState = {
    walletSecretBase58: bs58.encode(wallet.secretKey),
    walletPublicKey: wallet.publicKey.toBase58(),
    usdcMint,
    shareMint,
    registryInitialized,
    vaultInitialized,
    credentialAdded,
  };
  writeFileSync(E2E_STATE_FILE, JSON.stringify(state, null, 2));
}
