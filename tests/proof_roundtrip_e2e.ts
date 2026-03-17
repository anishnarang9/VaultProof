/**
 * proof_roundtrip_e2e.ts
 *
 * Full on-chain proof round-trip tests:
 *   1. Generate a real Groth16 proof via snarkjs
 *   2. store_proof_data on the local validator
 *   3. deposit_with_proof / transfer_with_proof / withdraw_with_proof on-chain
 *   4. Verify all on-chain state mutations
 *
 * Run: anchor test --skip-build -- --grep proof_roundtrip
 */
import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

import {
  deriveCredentialLeafPda,
  deriveKycRegistryPda,
  deriveProofBufferPda,
  deriveStateTreePda,
  deriveTransferRecordPda,
  deriveUsdcReservePda,
  deriveVaultStatePda,
} from "./helpers/account_utils";
import {
  buildIssuerBytes,
  buildProofBundle,
  buildSparseMerkleProof,
  loadCircuitHarness,
  merkleProofToByteArrays,
  type ProofBundle,
} from "./helpers/proof_utils";
import {
  airdropIfNeeded,
  bigintToBytes32,
  generateFieldCompatibleKeypair,
  usd,
} from "./helpers/test_utils";

const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
  units: 1_400_000,
});

const DEPOSIT_AMOUNT = usd(100);
const TRANSFER_AMOUNT = usd(30);
const WITHDRAW_SHARES = usd(20);
const USER_BALANCE = usd(10_000);

describe("proof_roundtrip_e2e", function () {
  this.timeout(600_000); // 10 min for 3 proof generations

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const kycProgram = anchor.workspace.KycRegistry as anchor.Program<any>;
  const vaultProgram = anchor.workspace.VusdVault as anchor.Program<any>;
  const authority = provider.wallet as anchor.Wallet;
  const authorityPayer = (provider.wallet as any).payer as Keypair;

  const [registryPda] = deriveKycRegistryPda(kycProgram.programId);
  const [stateTreePda] = deriveStateTreePda(kycProgram.programId, registryPda);
  const [vaultStatePda] = deriveVaultStatePda(vaultProgram.programId);
  const [usdcReservePda] = deriveUsdcReservePda(vaultProgram.programId);

  const issuerPubkey = buildIssuerBytes();

  let user: Keypair;
  let recipient: Keypair;
  let usdcMint: PublicKey;
  let shareMint: Keypair;
  let userUsdc: { address: PublicKey };
  let userShares: { address: PublicKey };
  let recipientShares: { address: PublicKey };

  let userCredentialBundle: ProofBundle;
  let circuit: Awaited<ReturnType<typeof loadCircuitHarness>>;

  function toBn(value: bigint) {
    return new anchor.BN(value.toString());
  }

  async function storeProof(bundle: ProofBundle, payer: Keypair) {
    const [proofBufferPda] = deriveProofBufferPda(
      vaultProgram.programId,
      payer.publicKey
    );

    const instruction = await (vaultProgram.methods as any)
      .storeProofData(
        Array.from(bundle.proofA),
        Array.from(bundle.proofB),
        Array.from(bundle.proofC),
        bundle.publicInputs.map((input: Buffer) => Array.from(input))
      )
      .accounts({
        proofBuffer: proofBufferPda,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const latest = await provider.connection.getLatestBlockhash("confirmed");
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: latest.blockhash,
        instructions: [instruction],
      }).compileToV0Message()
    );
    tx.sign([payer]);

    const signature = await provider.connection.sendTransaction(tx);
    await provider.connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );

    return proofBufferPda;
  }

  async function fetchVaultState() {
    return (vaultProgram.account as any).vaultState.fetch(vaultStatePda);
  }

  async function tokenBalance(address: PublicKey): Promise<bigint> {
    const account = await getAccount(provider.connection, address);
    return BigInt(account.amount.toString());
  }

  before(async function () {
    const existingRegistry = await provider.connection.getAccountInfo(
      registryPda,
      "confirmed"
    );
    const existingVault = await provider.connection.getAccountInfo(
      vaultStatePda,
      "confirmed"
    );

    if (existingRegistry || existingVault) {
      this.skip();
      return;
    }

    circuit = await loadCircuitHarness();

    // Generate field-compatible keypairs for circuit compatibility
    user = await generateFieldCompatibleKeypair(provider);
    recipient = await generateFieldCompatibleKeypair(provider);
    await airdropIfNeeded(provider, recipient.publicKey);

    // ---------- Initialize KYC Registry + State Tree ----------
    await (kycProgram.methods as any)
      .initializeRegistry(stateTreePda, Array.from(issuerPubkey))
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // ---------- Initialize Vault ----------
    usdcMint = await createMint(
      provider.connection,
      authorityPayer,
      authority.publicKey,
      null,
      6
    );
    shareMint = Keypair.generate();

    await (vaultProgram.methods as any)
      .initializeVault(
        Array.from(bigintToBytes32(circuit.defaultRegulator.pubKeyX)),
        Array.from(bigintToBytes32(circuit.defaultRegulator.pubKeyY))
      )
      .accounts({
        vaultState: vaultStatePda,
        usdcMint,
        shareMint: shareMint.publicKey,
        usdcReserve: usdcReservePda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([shareMint])
      .rpc();

    // ---------- Create Token Accounts + Fund USDC ----------
    userUsdc = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authorityPayer,
      usdcMint,
      user.publicKey
    );
    userShares = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authorityPayer,
      shareMint.publicKey,
      user.publicKey
    );
    recipientShares = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authorityPayer,
      shareMint.publicKey,
      recipient.publicKey
    );

    await mintTo(
      provider.connection,
      authorityPayer,
      usdcMint,
      userUsdc.address,
      authority.publicKey,
      BigInt((USER_BALANCE * 2n).toString())
    );

    // ---------- Build credential + add to registry ----------
    userCredentialBundle = await buildProofBundle({
      wallet: user.publicKey,
      transferAmount: DEPOSIT_AMOUNT,
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: USER_BALANCE,
      leafIndex: 0,
    });

    const zeroProof = await buildSparseMerkleProof([], 0);
    const [userLeafPda] = deriveCredentialLeafPda(
      kycProgram.programId,
      registryPda,
      userCredentialBundle.leafBytes
    );

    await (kycProgram.methods as any)
      .addCredential(
        Array.from(userCredentialBundle.leafBytes),
        merkleProofToByteArrays(zeroProof.pathElements)
      )
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        credentialLeaf: userLeafPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify on-chain root matches our local computation
    const stateTree = await (kycProgram.account as any).stateTree.fetch(
      stateTreePda
    );
    assert.equal(
      Buffer.from(stateTree.root).toString("hex"),
      userCredentialBundle.merkleRootBytes.toString("hex"),
      "On-chain merkle root must match proof bundle root after credential add"
    );
  });

  // ================================================================
  //  TEST 1: deposit_with_proof full on-chain round-trip
  // ================================================================
  it("deposit: store_proof_data → deposit_with_proof on-chain with real ZK proof", async function () {
    // Generate a fresh proof with current timestamp for the deposit
    const depositBundle = await buildProofBundle({
      wallet: user.publicKey,
      transferAmount: DEPOSIT_AMOUNT,
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: USER_BALANCE,
      credential: userCredentialBundle.credential,
      merkleLeaves: [
        { index: 0, value: userCredentialBundle.leafBigInt, active: true },
      ],
      leafIndex: 0,
    });

    // Verify root still matches on-chain
    const registry = await (kycProgram.account as any).kycRegistry.fetch(
      registryPda
    );
    assert.equal(
      Buffer.from(registry.merkleRoot).toString("hex"),
      depositBundle.merkleRootBytes.toString("hex"),
      "Deposit proof merkle root must match registry"
    );

    const usdcBefore = await tokenBalance(userUsdc.address);

    // Step 1: store_proof_data
    const proofBufferPda = await storeProof(depositBundle, user);

    // Verify proof buffer exists
    const bufferAccount = await provider.connection.getAccountInfo(
      proofBufferPda
    );
    assert.isNotNull(bufferAccount, "ProofBuffer should exist after store");

    // Step 2: deposit_with_proof
    const [transferRecordPda] = deriveTransferRecordPda(
      vaultProgram.programId,
      depositBundle.proofHash
    );

    await (vaultProgram.methods as any)
      .depositWithProof(toBn(DEPOSIT_AMOUNT))
      .accounts({
        vaultState: vaultStatePda,
        kycRegistry: registryPda,
        usdcMint,
        shareMint: shareMint.publicKey,
        userUsdcAccount: userUsdc.address,
        usdcReserve: usdcReservePda,
        stealthShareAccount: userShares.address,
        proofBuffer: proofBufferPda,
        transferRecord: transferRecordPda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .preInstructions([computeBudgetIx])
      .rpc();

    // ---------- Verify all state mutations ----------

    // 1. Shares minted (1:1 for first deposit)
    const shareBalance = await tokenBalance(userShares.address);
    assert.equal(
      shareBalance,
      DEPOSIT_AMOUNT,
      "First deposit should mint shares 1:1"
    );

    // 2. USDC transferred from user to vault
    const usdcAfter = await tokenBalance(userUsdc.address);
    assert.equal(
      usdcBefore - usdcAfter,
      DEPOSIT_AMOUNT,
      "User USDC should decrease by deposit amount"
    );

    // 3. VaultState updated
    const vaultState = await fetchVaultState();
    assert.equal(
      BigInt(vaultState.totalAssets.toString()),
      DEPOSIT_AMOUNT,
      "Vault total_assets should equal deposit"
    );
    assert.equal(
      BigInt(vaultState.totalShares.toString()),
      DEPOSIT_AMOUNT,
      "Vault total_shares should equal deposit"
    );

    // 4. TransferRecord created
    const transferRecord = await (
      vaultProgram.account as any
    ).transferRecord.fetch(transferRecordPda);
    assert.equal(
      Buffer.from(transferRecord.proofHash).toString("hex"),
      depositBundle.proofHash.toString("hex"),
      "TransferRecord proof_hash must match"
    );
    assert.equal(
      BigInt(transferRecord.amount.toString()),
      DEPOSIT_AMOUNT,
      "TransferRecord amount must match"
    );
    assert.isTrue(
      transferRecord.encryptedMetadata.length > 32,
      "TransferRecord must store full encrypted metadata (not just hash)"
    );
    assert.equal(
      transferRecord.signer.toBase58(),
      user.publicKey.toBase58(),
      "TransferRecord signer must be the depositor"
    );

    // 5. ProofBuffer closed (rent returned to user)
    const closedBuffer = await provider.connection.getAccountInfo(
      proofBufferPda
    );
    assert.isNull(closedBuffer, "ProofBuffer should be closed after deposit");
  });

  // ================================================================
  //  TEST 2: transfer_with_proof full on-chain round-trip
  // ================================================================
  it("transfer: store_proof_data → transfer_with_proof on-chain with real ZK proof", async function () {
    const senderSharesBefore = await tokenBalance(userShares.address);
    const recipientSharesBefore = await tokenBalance(recipientShares.address);

    // Generate transfer proof
    const transferBundle = await buildProofBundle({
      wallet: user.publicKey,
      transferAmount: TRANSFER_AMOUNT,
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: DEPOSIT_AMOUNT, // balance is shares held
      credential: userCredentialBundle.credential,
      merkleLeaves: [
        { index: 0, value: userCredentialBundle.leafBigInt, active: true },
      ],
      leafIndex: 0,
      recipientAddress: BigInt(
        `0x${recipient.publicKey.toBuffer().toString("hex")}`
      ),
    });

    // Step 1: store_proof_data
    const proofBufferPda = await storeProof(transferBundle, user);

    // Step 2: transfer_with_proof
    const [transferRecordPda] = deriveTransferRecordPda(
      vaultProgram.programId,
      transferBundle.proofHash
    );

    await (vaultProgram.methods as any)
      .transferWithProof(toBn(TRANSFER_AMOUNT))
      .accounts({
        vaultState: vaultStatePda,
        kycRegistry: registryPda,
        shareMint: shareMint.publicKey,
        senderStealthAccount: userShares.address,
        recipientStealthAccount: recipientShares.address,
        proofBuffer: proofBufferPda,
        transferRecord: transferRecordPda,
        sender: user.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .preInstructions([computeBudgetIx])
      .rpc();

    // ---------- Verify ----------

    // Sender shares decreased
    const senderSharesAfter = await tokenBalance(userShares.address);
    assert.equal(
      senderSharesBefore - senderSharesAfter,
      TRANSFER_AMOUNT,
      "Sender shares should decrease by transfer amount"
    );

    // Recipient shares increased
    const recipientSharesAfter = await tokenBalance(recipientShares.address);
    assert.equal(
      recipientSharesAfter - recipientSharesBefore,
      TRANSFER_AMOUNT,
      "Recipient shares should increase by transfer amount"
    );

    // TransferRecord created
    const record = await (vaultProgram.account as any).transferRecord.fetch(
      transferRecordPda
    );
    assert.equal(
      Buffer.from(record.proofHash).toString("hex"),
      transferBundle.proofHash.toString("hex")
    );
    assert.equal(BigInt(record.amount.toString()), TRANSFER_AMOUNT);

    // ProofBuffer closed
    const closedBuffer = await provider.connection.getAccountInfo(
      proofBufferPda
    );
    assert.isNull(closedBuffer, "ProofBuffer should be closed after transfer");
  });

  // ================================================================
  //  TEST 3: withdraw_with_proof full on-chain round-trip
  // ================================================================
  it("withdraw: store_proof_data → withdraw_with_proof on-chain with real ZK proof", async function () {
    const sharesBefore = await tokenBalance(userShares.address);
    const usdcBefore = await tokenBalance(userUsdc.address);
    const vaultBefore = await fetchVaultState();

    // Generate withdraw proof — amount is in share units
    const withdrawBundle = await buildProofBundle({
      wallet: user.publicKey,
      transferAmount: WITHDRAW_SHARES,
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: sharesBefore, // current share balance
      credential: userCredentialBundle.credential,
      merkleLeaves: [
        { index: 0, value: userCredentialBundle.leafBigInt, active: true },
      ],
      leafIndex: 0,
    });

    // Step 1: store_proof_data
    const proofBufferPda = await storeProof(withdrawBundle, user);

    // Step 2: withdraw_with_proof
    const [transferRecordPda] = deriveTransferRecordPda(
      vaultProgram.programId,
      withdrawBundle.proofHash
    );

    await (vaultProgram.methods as any)
      .withdrawWithProof(toBn(WITHDRAW_SHARES))
      .accounts({
        vaultState: vaultStatePda,
        kycRegistry: registryPda,
        usdcMint,
        shareMint: shareMint.publicKey,
        usdcReserve: usdcReservePda,
        stealthShareAccount: userShares.address,
        userUsdcAccount: userUsdc.address,
        proofBuffer: proofBufferPda,
        transferRecord: transferRecordPda,
        stealthOwner: user.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .preInstructions([computeBudgetIx])
      .rpc();

    // ---------- Verify ----------

    // Shares burned
    const sharesAfter = await tokenBalance(userShares.address);
    assert.equal(
      sharesBefore - sharesAfter,
      WITHDRAW_SHARES,
      "Shares should be burned"
    );

    // USDC returned (at 1:1 since it's the only deposit and no yield)
    const usdcAfter = await tokenBalance(userUsdc.address);
    const usdcReturned = usdcAfter - usdcBefore;
    assert.isAbove(
      Number(usdcReturned),
      0,
      "User should receive USDC back from withdrawal"
    );

    // Vault totals decreased
    const vaultAfter = await fetchVaultState();
    assert.isBelow(
      Number(vaultAfter.totalShares.toString()),
      Number(vaultBefore.totalShares.toString()),
      "Vault total_shares should decrease"
    );
    assert.isBelow(
      Number(vaultAfter.totalAssets.toString()),
      Number(vaultBefore.totalAssets.toString()),
      "Vault total_assets should decrease"
    );

    // TransferRecord created
    const record = await (vaultProgram.account as any).transferRecord.fetch(
      transferRecordPda
    );
    assert.equal(
      Buffer.from(record.proofHash).toString("hex"),
      withdrawBundle.proofHash.toString("hex")
    );

    // ProofBuffer closed
    const closedBuffer = await provider.connection.getAccountInfo(
      proofBufferPda
    );
    assert.isNull(
      closedBuffer,
      "ProofBuffer should be closed after withdrawal"
    );
  });
});
