import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import * as multisig from "@sqds/multisig";
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
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
  deriveDecryptionAuthPda,
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
  bigintToBytes32,
  generateFieldCompatibleKeypair,
  publicKeyToField,
  usd,
} from "./helpers/test_utils";
import { computeSourceOfFundsHash } from "../scripts/devnet-credential";
import {
  airdropIfNeeded,
  createApproveExecuteVaultTransaction,
  createSquadsMultisig,
  SQUADS_PROGRAM_ID,
  transferLamports,
} from "../scripts/squads";

const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
  units: 1_400_000,
});

const INITIAL_DEPOSIT = usd(50_000);
const TRANSFER_AMOUNT = usd(10_000);
const WITHDRAW_AMOUNT = usd(5_000);
const BREAKER_WITHDRAW_AMOUNT = usd(10_000);
const INITIAL_USER_BALANCE = usd(120_000);
const TEST_YIELD_AMOUNT = usd(100);
const TEST_YIELD_VENUE = Keypair.fromSeed(Uint8Array.from(Array(32).fill(9))).publicKey;
const INITIAL_RISK_LIMITS = {
  circuitBreakerThreshold: usd(100_000),
  maxSingleTransaction: usd(50_000),
  maxSingleDeposit: usd(50_000),
  maxDailyTransactions: 100,
};
const BREAKER_RISK_LIMITS = {
  circuitBreakerThreshold: usd(9_000),
  maxSingleTransaction: usd(20_000),
  maxSingleDeposit: usd(50_000),
  maxDailyTransactions: 100,
};

function bn(value: bigint | number) {
  return new anchor.BN(value.toString());
}

function deriveYieldVenuePda(programId: PublicKey, vaultState: PublicKey, venue: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("yield_venue"), vaultState.toBuffer(), venue.toBuffer()],
    programId,
  );
}

async function ensureLocalSquadsProgram(connection: anchor.web3.Connection) {
  const account = await connection.getAccountInfo(SQUADS_PROGRAM_ID, "confirmed");
  if (account?.executable) {
    return SQUADS_PROGRAM_ID;
  }

  throw new Error(
    "Squads program not found on local validator. Start localnet with SQDS4 cloned from devnet.",
  );
}

describe("integration_e2e", function () {
  this.timeout(1_200_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const kycProgram = anchor.workspace.KycRegistry as anchor.Program<any>;
  const vaultProgram = anchor.workspace.VusdVault as anchor.Program<any>;
  const complianceProgram = anchor.workspace.ComplianceAdmin as anchor.Program<any>;
  const authority = provider.wallet as anchor.Wallet;
  const authorityPayer = (provider.wallet as any).payer as Keypair;

  const [registryPda] = deriveKycRegistryPda(kycProgram.programId);
  const [stateTreePda] = deriveStateTreePda(kycProgram.programId, registryPda);
  const [vaultStatePda] = deriveVaultStatePda(vaultProgram.programId);
  const [usdcReservePda] = deriveUsdcReservePda(vaultProgram.programId);
  const [yieldVenuePda] = deriveYieldVenuePda(
    vaultProgram.programId,
    vaultStatePda,
    TEST_YIELD_VENUE,
  );

  const issuerPubkey = buildIssuerBytes();

  let squadsProgramId: PublicKey;
  let squads!: Awaited<ReturnType<typeof createSquadsMultisig>>;
  let user: Keypair;
  let recipient: Keypair;
  let nonMember: Keypair;
  let usdcMint: PublicKey;
  let shareMint: Keypair;
  let userUsdc: { address: PublicKey };
  let userShares: { address: PublicKey };
  let recipientShares: { address: PublicKey };
  let userCredential: any;
  let userCredentialBundle: ProofBundle;
  let depositRecordPda: PublicKey;
  let transferRecordPda: PublicKey;
  let decryptionAuthPda: PublicKey;
  let decryptionExecuteSignature = "";

  async function expectReject(promise: Promise<unknown>) {
    let rejected = false;
    try {
      await promise;
    } catch {
      rejected = true;
    }
    assert.isTrue(rejected, "expected transaction to reject");
  }

  async function storeProof(bundle: ProofBundle, payer: Keypair) {
    const [proofBufferPda] = deriveProofBufferPda(vaultProgram.programId, payer.publicKey);

    const instruction = await (vaultProgram.methods as any)
      .storeProofData(
        Array.from(bundle.proofA),
        Array.from(bundle.proofB),
        Array.from(bundle.proofC),
        bundle.publicInputs.map((input) => Array.from(input)),
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
      }).compileToV0Message(),
    );
    tx.sign([payer]);

    const signature = await provider.connection.sendTransaction(tx);
    await provider.connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed",
    );

    return proofBufferPda;
  }

  async function fetchVaultState() {
    return (vaultProgram.account as any).vaultState.fetch(vaultStatePda);
  }

  async function tokenAmount(address: PublicKey) {
    const account = await getAccount(provider.connection, address);
    return BigInt(account.amount.toString());
  }

  async function buildSourceAwareCredential(wallet: PublicKey) {
    const harness = await loadCircuitHarness();
    const sourceOfFundsHash = await computeSourceOfFundsHash(
      "Integration test wire transfer source verification",
    );
    const walletField = publicKeyToField(wallet);
    return harness.circuit.createCredential(
      harness.crypto,
      harness.issuer,
      {
        name: harness.crypto.F.toObject(harness.crypto.poseidon([123456789n])),
        nationality: 756n,
        dateOfBirth: 631152000n,
        jurisdiction: 756n,
        accreditationStatus: 1n,
        credentialExpiry: BigInt(Math.floor(Date.now() / 1000)) + 86_400n * 365n,
        sourceOfFundsHash,
        credentialVersion: 1n,
        walletPubkey: walletField,
      },
      9876543210987654321n,
    );
  }

  async function buildSourceAwareProofBundle(
    wallet: PublicKey,
    transferAmount: bigint,
    balance: bigint,
    recipientAddress?: bigint,
  ) {
    const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

    return buildProofBundle({
      balance,
      credential: userCredential,
      currentTimestamp,
      leafIndex: 0,
      merkleLeaves: [{ index: 0, value: userCredential.leafBigInt, active: true }],
      recipientAddress,
      transferAmount,
      wallet,
    });
  }

  async function fetchProposalStatus(proposalPda: PublicKey) {
    const proposal = await multisig.accounts.Proposal.fromAccountAddress(
      provider.connection,
      proposalPda,
      "confirmed",
    );
    return proposal.status.__kind;
  }

  async function confirmTx(signature: string) {
    await provider.connection.confirmTransaction(signature, "confirmed");
  }

  before(async function () {
    squadsProgramId = await ensureLocalSquadsProgram(provider.connection);

    user = await generateFieldCompatibleKeypair(provider);
    recipient = await generateFieldCompatibleKeypair(provider);
    nonMember = Keypair.generate();

    await airdropIfNeeded(provider.connection, nonMember.publicKey);
    await airdropIfNeeded(provider.connection, authority.publicKey);

    const members: [Keypair, Keypair, Keypair] = [
      Keypair.generate(),
      Keypair.generate(),
      Keypair.generate(),
    ];
    for (const member of members) {
      await airdropIfNeeded(provider.connection, member.publicKey);
    }

    squads = await createSquadsMultisig(provider.connection, members, 2, squadsProgramId);
    await transferLamports(
      provider.connection,
      authorityPayer,
      squads.vaultPda,
      2 * LAMPORTS_PER_SOL,
    );
  });

  it("1. initializes the KYC registry", async () => {
    await (kycProgram.methods as any)
      .initializeRegistry(stateTreePda, Array.from(issuerPubkey))
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const registry = await (kycProgram.account as any).kycRegistry.fetch(registryPda);
    assert.equal(registry.authority.toBase58(), authority.publicKey.toBase58());
  });

  it("2. creates a Squads multisig and initializes the vault under the vault PDA", async () => {
    usdcMint = await createMint(
      provider.connection,
      authorityPayer,
      authority.publicKey,
      null,
      6,
    );
    shareMint = Keypair.generate();

    const initializeInstruction = await (vaultProgram.methods as any)
      .initializeVault(
        Array.from(bigintToBytes32((await loadCircuitHarness()).defaultRegulator.pubKeyX)),
        Array.from(bigintToBytes32((await loadCircuitHarness()).defaultRegulator.pubKeyY)),
      )
      .accounts({
        vaultState: vaultStatePda,
        usdcMint,
        shareMint: shareMint.publicKey,
        usdcReserve: usdcReservePda,
        authority: squads.vaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    await createApproveExecuteVaultTransaction({
      additionalSigners: [shareMint],
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      feePayer: squads.members[0],
      instructionLabel: "initialize_vault",
      multisigPda: squads.multisigPda,
      programId: squadsProgramId,
      transactionMessage: new TransactionMessage({
        payerKey: squads.vaultPda,
        recentBlockhash: (await provider.connection.getLatestBlockhash("confirmed")).blockhash,
        instructions: [initializeInstruction],
      }),
      vaultIndex: squads.vaultIndex,
    });

    const vaultState = await fetchVaultState();
    assert.equal(vaultState.authority.toBase58(), squads.vaultPda.toBase58());
    assert.equal(vaultState.usdcMint.toBase58(), usdcMint.toBase58());
    assert.equal(vaultState.shareMint.toBase58(), shareMint.publicKey.toBase58());
  });

  it("3. configures risk limits, custody, and a yield venue via Squads", async () => {
    const riskInstruction = await (vaultProgram.methods as any)
      .updateRiskLimits(
        bn(INITIAL_RISK_LIMITS.circuitBreakerThreshold),
        bn(INITIAL_RISK_LIMITS.maxSingleTransaction),
        bn(INITIAL_RISK_LIMITS.maxSingleDeposit),
        INITIAL_RISK_LIMITS.maxDailyTransactions,
      )
      .accounts({
        vaultState: vaultStatePda,
        authority: squads.vaultPda,
      })
      .instruction();
    await createApproveExecuteVaultTransaction({
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      instructionLabel: "update_risk_limits",
      multisigPda: squads.multisigPda,
      programId: squadsProgramId,
      transactionMessage: new TransactionMessage({
        payerKey: squads.vaultPda,
        recentBlockhash: (await provider.connection.getLatestBlockhash("confirmed")).blockhash,
        instructions: [riskInstruction],
      }),
      vaultIndex: squads.vaultIndex,
    });

    const custodyInstruction = await (vaultProgram.methods as any)
      .updateCustodyProvider({ selfCustody: {} }, squads.vaultPda)
      .accounts({
        vaultState: vaultStatePda,
        authority: squads.vaultPda,
      })
      .instruction();
    await createApproveExecuteVaultTransaction({
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      instructionLabel: "update_custody_provider",
      multisigPda: squads.multisigPda,
      programId: squadsProgramId,
      transactionMessage: new TransactionMessage({
        payerKey: squads.vaultPda,
        recentBlockhash: (await provider.connection.getLatestBlockhash("confirmed")).blockhash,
        instructions: [custodyInstruction],
      }),
      vaultIndex: squads.vaultIndex,
    });

    const venueInstruction = await (vaultProgram.methods as any)
      .addYieldVenue(TEST_YIELD_VENUE, "Kamino Devnet", Array.from(bigintToBytes32(11n)), 6_500, 2)
      .accounts({
        vaultState: vaultStatePda,
        yieldVenue: yieldVenuePda,
        authority: squads.vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    await createApproveExecuteVaultTransaction({
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      instructionLabel: "add_yield_venue",
      multisigPda: squads.multisigPda,
      programId: squadsProgramId,
      transactionMessage: new TransactionMessage({
        payerKey: squads.vaultPda,
        recentBlockhash: (await provider.connection.getLatestBlockhash("confirmed")).blockhash,
        instructions: [venueInstruction],
      }),
      vaultIndex: squads.vaultIndex,
    });

    const vaultState = await fetchVaultState();
    assert.equal(
      BigInt(vaultState.circuitBreakerThreshold.toString()),
      INITIAL_RISK_LIMITS.circuitBreakerThreshold,
    );
    assert.equal(vaultState.custodyProvider.selfCustody !== undefined, true);
    assert.equal(vaultState.yieldSource.toBase58(), TEST_YIELD_VENUE.toBase58());
  });

  it("4. issues a credential with source-of-funds fields", async () => {
    userCredential = await buildSourceAwareCredential(user.publicKey);
    userCredentialBundle = await buildSourceAwareProofBundle(
      user.publicKey,
      INITIAL_DEPOSIT,
      INITIAL_USER_BALANCE,
    );

    const zeroProof = await buildSparseMerkleProof([], 0);
    const [userLeafPda] = deriveCredentialLeafPda(
      kycProgram.programId,
      registryPda,
      userCredentialBundle.leafBytes,
    );

    await (kycProgram.methods as any)
      .addCredential(
        Array.from(userCredentialBundle.leafBytes),
        merkleProofToByteArrays(zeroProof.pathElements),
      )
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        credentialLeaf: userLeafPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const stateTree = await (kycProgram.account as any).stateTree.fetch(stateTreePda);
    assert.equal(
      Buffer.from(stateTree.root).toString("hex"),
      userCredentialBundle.merkleRootBytes.toString("hex"),
    );
  });

  it("5. deposits USDC with a real proof", async () => {
    userUsdc = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authorityPayer,
      usdcMint,
      user.publicKey,
    );
    userShares = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authorityPayer,
      shareMint.publicKey,
      user.publicKey,
    );
    recipientShares = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authorityPayer,
      shareMint.publicKey,
      recipient.publicKey,
    );

    await mintTo(
      provider.connection,
      authorityPayer,
      usdcMint,
      userUsdc.address,
      authority.publicKey,
      BigInt(INITIAL_USER_BALANCE.toString()),
    );

    const depositBundle = await buildSourceAwareProofBundle(
      user.publicKey,
      INITIAL_DEPOSIT,
      INITIAL_USER_BALANCE,
    );
    const proofBufferPda = await storeProof(depositBundle, user);
    [depositRecordPda] = deriveTransferRecordPda(vaultProgram.programId, depositBundle.proofHash);

    await (vaultProgram.methods as any)
      .depositWithProof(bn(INITIAL_DEPOSIT))
      .accounts({
        vaultState: vaultStatePda,
        kycRegistry: registryPda,
        usdcMint,
        shareMint: shareMint.publicKey,
        userUsdcAccount: userUsdc.address,
        usdcReserve: usdcReservePda,
        stealthShareAccount: userShares.address,
        proofBuffer: proofBufferPda,
        transferRecord: depositRecordPda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .preInstructions([computeBudgetIx])
      .rpc();

    assert.equal(await tokenAmount(userShares.address), INITIAL_DEPOSIT);
    const vaultState = await fetchVaultState();
    assert.equal(BigInt(vaultState.totalAssets.toString()), INITIAL_DEPOSIT);
    assert.equal(BigInt(vaultState.totalShares.toString()), INITIAL_DEPOSIT);
  });

  it("6. verifies the initial share price after deposit", async () => {
    const vaultState = await fetchVaultState();
    assert.equal(BigInt(vaultState.sharePriceNumerator.toString()), INITIAL_DEPOSIT);
    assert.equal(BigInt(vaultState.sharePriceDenominator.toString()), INITIAL_DEPOSIT);
  });

  it("7. transfers shares with a real proof", async () => {
    const transferBundle = await buildSourceAwareProofBundle(
      user.publicKey,
      TRANSFER_AMOUNT,
      INITIAL_DEPOSIT,
      BigInt(`0x${recipient.publicKey.toBuffer().toString("hex")}`),
    );

    const proofBufferPda = await storeProof(transferBundle, user);
    [transferRecordPda] = deriveTransferRecordPda(vaultProgram.programId, transferBundle.proofHash);

    await (vaultProgram.methods as any)
      .transferWithProof(bn(TRANSFER_AMOUNT))
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

    assert.equal(await tokenAmount(userShares.address), INITIAL_DEPOSIT - TRANSFER_AMOUNT);
    assert.equal(await tokenAmount(recipientShares.address), TRANSFER_AMOUNT);
  });

  it("8. withdraws shares with a real proof", async () => {
    const withdrawBundle = await buildSourceAwareProofBundle(
      user.publicKey,
      WITHDRAW_AMOUNT,
      INITIAL_DEPOSIT - TRANSFER_AMOUNT,
    );
    const proofBufferPda = await storeProof(withdrawBundle, user);
    const [withdrawRecordPda] = deriveTransferRecordPda(
      vaultProgram.programId,
      withdrawBundle.proofHash,
    );
    const usdcBefore = await tokenAmount(userUsdc.address);

    await (vaultProgram.methods as any)
      .withdrawWithProof(bn(WITHDRAW_AMOUNT))
      .accounts({
        vaultState: vaultStatePda,
        kycRegistry: registryPda,
        usdcMint,
        shareMint: shareMint.publicKey,
        usdcReserve: usdcReservePda,
        stealthShareAccount: userShares.address,
        userUsdcAccount: userUsdc.address,
        proofBuffer: proofBufferPda,
        transferRecord: withdrawRecordPda,
        stealthOwner: user.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .preInstructions([computeBudgetIx])
      .rpc();

    assert.equal(await tokenAmount(userShares.address), INITIAL_DEPOSIT - TRANSFER_AMOUNT - WITHDRAW_AMOUNT);
    assert.equal(await tokenAmount(userUsdc.address) - usdcBefore, WITHDRAW_AMOUNT);
  });

  it("9. triggers the circuit breaker with an oversized withdrawal window", async () => {
    const tightenRiskInstruction = await (vaultProgram.methods as any)
      .updateRiskLimits(
        bn(BREAKER_RISK_LIMITS.circuitBreakerThreshold),
        bn(BREAKER_RISK_LIMITS.maxSingleTransaction),
        bn(BREAKER_RISK_LIMITS.maxSingleDeposit),
        BREAKER_RISK_LIMITS.maxDailyTransactions,
      )
      .accounts({
        vaultState: vaultStatePda,
        authority: squads.vaultPda,
      })
      .instruction();
    await createApproveExecuteVaultTransaction({
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      instructionLabel: "tighten_risk_limits",
      multisigPda: squads.multisigPda,
      programId: squadsProgramId,
      transactionMessage: new TransactionMessage({
        payerKey: squads.vaultPda,
        recentBlockhash: (await provider.connection.getLatestBlockhash("confirmed")).blockhash,
        instructions: [tightenRiskInstruction],
      }),
      vaultIndex: squads.vaultIndex,
    });

    const triggerBundle = await buildSourceAwareProofBundle(
      user.publicKey,
      BREAKER_WITHDRAW_AMOUNT,
      INITIAL_DEPOSIT - TRANSFER_AMOUNT - WITHDRAW_AMOUNT,
    );
    const proofBufferPda = await storeProof(triggerBundle, user);
    const [breakerRecordPda] = deriveTransferRecordPda(
      vaultProgram.programId,
      triggerBundle.proofHash,
    );

    let breakerError: unknown;
    try {
      await (vaultProgram.methods as any)
        .withdrawWithProof(bn(BREAKER_WITHDRAW_AMOUNT))
        .accounts({
          vaultState: vaultStatePda,
          kycRegistry: registryPda,
          usdcMint,
          shareMint: shareMint.publicKey,
          usdcReserve: usdcReservePda,
          stealthShareAccount: userShares.address,
          userUsdcAccount: userUsdc.address,
          proofBuffer: proofBufferPda,
          transferRecord: breakerRecordPda,
          stealthOwner: user.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .preInstructions([computeBudgetIx])
        .rpc();
      assert.fail("expected the circuit breaker withdrawal to reject");
    } catch (error) {
      breakerError = error;
    }

    assert.include(String(breakerError), "CircuitBreakerTriggered");
  });

  it("10. unpauses the vault via Squads", async () => {
    const instruction = await (vaultProgram.methods as any)
      .unpauseVault()
      .accounts({
        vaultState: vaultStatePda,
        authority: squads.vaultPda,
      })
      .instruction();
    const result = await createApproveExecuteVaultTransaction({
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      instructionLabel: "unpause_vault",
      multisigPda: squads.multisigPda,
      programId: squadsProgramId,
      transactionMessage: new TransactionMessage({
        payerKey: squads.vaultPda,
        recentBlockhash: (await provider.connection.getLatestBlockhash("confirmed")).blockhash,
        instructions: [instruction],
      }),
      vaultIndex: squads.vaultIndex,
    });

    assert.equal(result.proposal.status.__kind, "Executed");
    assert.isFalse((await fetchVaultState()).paused);
  });

  it("11. authorizes decryption via Squads and creates the audit PDA", async () => {
    [decryptionAuthPda] = deriveDecryptionAuthPda(complianceProgram.programId, depositRecordPda);
    const reasonHash = Array.from(bigintToBytes32(4242n));
    const instruction = await (complianceProgram.methods as any)
      .authorizeDecryption(reasonHash)
      .accounts({
        decryptionAuth: decryptionAuthPda,
        vaultState: vaultStatePda,
        transferRecord: depositRecordPda,
        authority: squads.vaultPda,
        vusdVaultProgram: vaultProgram.programId,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const result = await createApproveExecuteVaultTransaction({
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      instructionLabel: "authorize_decryption",
      multisigPda: squads.multisigPda,
      programId: squadsProgramId,
      transactionMessage: new TransactionMessage({
        payerKey: squads.vaultPda,
        recentBlockhash: (await provider.connection.getLatestBlockhash("confirmed")).blockhash,
        instructions: [instruction],
      }),
      vaultIndex: squads.vaultIndex,
    });
    decryptionExecuteSignature = result.executeSignature;

    const record = await (vaultProgram.account as any).transferRecord.fetch(depositRecordPda);
    const auth = await (complianceProgram.account as any).decryptionAuthorization.fetch(
      decryptionAuthPda,
    );
    assert.isTrue(record.decryptionAuthorized);
    assert.equal(auth.transferRecord.toBase58(), depositRecordPda.toBase58());
    assert.equal(auth.authorizedBy.toBase58(), squads.vaultPda.toBase58());
  });

  it("12. preserves full encrypted metadata on the transfer record", async () => {
    const record = await (vaultProgram.account as any).transferRecord.fetch(transferRecordPda);
    assert.isAbove(record.encryptedMetadata.length, 32);
  });

  it("13. accrues yield and increases share price", async () => {
    const before = await fetchVaultState();
    const instruction = await (vaultProgram.methods as any)
      .accrueYield(bn(TEST_YIELD_AMOUNT))
      .accounts({
        vaultState: vaultStatePda,
        authority: squads.vaultPda,
      })
      .instruction();

    await createApproveExecuteVaultTransaction({
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      instructionLabel: "accrue_yield",
      multisigPda: squads.multisigPda,
      programId: squadsProgramId,
      transactionMessage: new TransactionMessage({
        payerKey: squads.vaultPda,
        recentBlockhash: (await provider.connection.getLatestBlockhash("confirmed")).blockhash,
        instructions: [instruction],
      }),
      vaultIndex: squads.vaultIndex,
    });

    const after = await fetchVaultState();
    assert.isTrue(BigInt(after.totalAssets.toString()) > BigInt(before.totalAssets.toString()));
    assert.isTrue(
      BigInt(after.sharePriceNumerator.toString()) >
        BigInt(before.sharePriceNumerator.toString()),
    );
  });

  it("14. rejects non-members on decryption authorization", async () => {
    const [rogueAuthPda] = deriveDecryptionAuthPda(complianceProgram.programId, transferRecordPda);

    await expectReject(
      (complianceProgram.methods as any)
        .authorizeDecryption(Array.from(bigintToBytes32(9999n)))
        .accounts({
          decryptionAuth: rogueAuthPda,
          vaultState: vaultStatePda,
          transferRecord: transferRecordPda,
          authority: nonMember.publicKey,
          vusdVaultProgram: vaultProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .signers([nonMember])
        .rpc(),
    );
  });

  it("15. updates AML thresholds via a Squads-approved compliance-admin transaction", async () => {
    const instruction = await (complianceProgram.methods as any)
      .updateAmlThresholds(bn(usd(20_000)), bn(usd(2_000_000)), bn(u64Max()), bn(usd(2_000)))
      .accounts({
        vaultState: vaultStatePda,
        authority: squads.vaultPda,
        vusdVaultProgram: vaultProgram.programId,
      })
      .instruction();

    await createApproveExecuteVaultTransaction({
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      instructionLabel: "update_aml_thresholds",
      multisigPda: squads.multisigPda,
      programId: squadsProgramId,
      transactionMessage: new TransactionMessage({
        payerKey: squads.vaultPda,
        recentBlockhash: (await provider.connection.getLatestBlockhash("confirmed")).blockhash,
        instructions: [instruction],
      }),
      vaultIndex: squads.vaultIndex,
    });

    const vaultState = await fetchVaultState();
    assert.equal(BigInt(vaultState.amlThresholds[0].toString()), usd(20_000));
    assert.equal(BigInt(vaultState.expiredThreshold.toString()), usd(2_000));
  });

  it("16. updates the regulator key via a Squads-approved compliance-admin transaction", async () => {
    const newX = Array.from(bigintToBytes32(3333n));
    const newY = Array.from(bigintToBytes32(4444n));
    const instruction = await (complianceProgram.methods as any)
      .updateRegulatorKey(newX, newY)
      .accounts({
        vaultState: vaultStatePda,
        authority: squads.vaultPda,
        vusdVaultProgram: vaultProgram.programId,
      })
      .instruction();

    await createApproveExecuteVaultTransaction({
      approver: squads.members[1],
      connection: provider.connection,
      creator: squads.members[0],
      instructionLabel: "update_regulator_key",
      multisigPda: squads.multisigPda,
      programId: squadsProgramId,
      transactionMessage: new TransactionMessage({
        payerKey: squads.vaultPda,
        recentBlockhash: (await provider.connection.getLatestBlockhash("confirmed")).blockhash,
        instructions: [instruction],
      }),
      vaultIndex: squads.vaultIndex,
    });

    const vaultState = await fetchVaultState();
    assert.equal(Buffer.from(vaultState.regulatorPubkeyX).toString("hex"), Buffer.from(newX).toString("hex"));
    assert.equal(Buffer.from(vaultState.regulatorPubkeyY).toString("hex"), Buffer.from(newY).toString("hex"));
  });

  it("17. rejects execution when only one of three members approves", async () => {
    const transactionIndex =
      BigInt(
        (
          await multisig.accounts.Multisig.fromAccountAddress(
            provider.connection,
            squads.multisigPda,
            "confirmed",
          )
        ).transactionIndex.toString(),
      ) + 1n;
    const instruction = await (vaultProgram.methods as any)
      .accrueYield(bn(1))
      .accounts({
        vaultState: vaultStatePda,
        authority: squads.vaultPda,
      })
      .instruction();
    const message = new TransactionMessage({
      payerKey: squads.vaultPda,
      recentBlockhash: (await provider.connection.getLatestBlockhash("confirmed")).blockhash,
      instructions: [instruction],
    });

    await confirmTx(
      await multisig.rpc.vaultTransactionCreate({
        connection: provider.connection,
        feePayer: squads.members[0],
        multisigPda: squads.multisigPda,
        transactionIndex,
        creator: squads.members[0].publicKey,
        rentPayer: squads.members[0].publicKey,
        vaultIndex: squads.vaultIndex,
        ephemeralSigners: 0,
        transactionMessage: message,
        programId: squadsProgramId,
      }),
    );
    await confirmTx(
      await multisig.rpc.proposalCreate({
        connection: provider.connection,
        feePayer: squads.members[0],
        creator: squads.members[0],
        multisigPda: squads.multisigPda,
        transactionIndex,
        programId: squadsProgramId,
      }),
    );

    const [proposalPda] = multisig.getProposalPda({
      multisigPda: squads.multisigPda,
      transactionIndex,
      programId: squadsProgramId,
    });
    if ((await fetchProposalStatus(proposalPda)) === "Draft") {
      await confirmTx(
        await multisig.rpc.proposalActivate({
          connection: provider.connection,
          feePayer: squads.members[0],
          member: squads.members[0],
          multisigPda: squads.multisigPda,
          transactionIndex,
          programId: squadsProgramId,
        }),
      );
    }

    await confirmTx(
      await multisig.rpc.proposalApprove({
        connection: provider.connection,
        feePayer: squads.members[0],
        member: squads.members[0],
        multisigPda: squads.multisigPda,
        transactionIndex,
        programId: squadsProgramId,
      }),
    );

    await expectReject(
      multisig.rpc.vaultTransactionExecute({
        connection: provider.connection,
        feePayer: squads.members[0],
        member: squads.members[0].publicKey,
        multisigPda: squads.multisigPda,
        transactionIndex,
        programId: squadsProgramId,
      }),
    );

    assert.notEqual(await fetchProposalStatus(proposalPda), "Executed");
  });

  it("18. emits the decryption authorization event", async () => {
    const tx = await provider.connection.getTransaction(decryptionExecuteSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    assert.exists(tx?.meta?.logMessages);

    const logs = tx?.meta?.logMessages ?? [];
    const prefix = `Program ${complianceProgram.programId.toBase58()} `;
    let inComplianceProgram = false;
    const events = [];

    for (const log of logs) {
      if (log.startsWith(`${prefix}invoke [`)) {
        inComplianceProgram = true;
        continue;
      }
      if (inComplianceProgram && log === `${prefix}success`) {
        inComplianceProgram = false;
        continue;
      }
      if (!inComplianceProgram || !log.startsWith("Program data: ")) {
        continue;
      }

      const decoded = (complianceProgram.coder.events as any).decode(
        log.slice("Program data: ".length),
      );
      if (decoded) {
        events.push(decoded);
      }
    }

    const event = events.find((entry) => entry.name === "decryptionAuthorized");

    assert.exists(event);
    assert.equal(event?.data.transferRecord.toBase58(), depositRecordPda.toBase58());
  });
});

function u64Max() {
  return BigInt("18446744073709551615");
}
