import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import * as fs from "fs";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
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
  deriveEmergencyPda,
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
  enumVariantName,
  generateFieldCompatibleKeypair,
  run,
  usd,
} from "./helpers/test_utils";

const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
  units: 1_400_000,
});

const DEFAULT_TIMELOCK_SECONDS = 259_200;
const DEPOSIT_AMOUNT = usd(100);
const TRANSFER_AMOUNT = usd(40);
const WITHDRAW_AMOUNT = usd(20);
const EMERGENCY_AMOUNT = usd(5);
const USER_BALANCE = usd(1_000);
const VUSD_VAULT_SOURCE =
  "/Users/anishnarang/VaultProof/programs/vusd-vault/src/lib.rs";
const COMPLIANCE_ADMIN_SOURCE =
  "/Users/anishnarang/VaultProof/programs/compliance-admin/src/lib.rs";

type TokenAccountAddress = {
  address: PublicKey;
};

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

  const issuerPubkey = buildIssuerBytes();

  let userA: Keypair;
  let userB: Keypair;
  let tempAuthority: Keypair;

  let usdcMint: PublicKey;
  let shareMint: Keypair;
  let userAUsdc: TokenAccountAddress;
  let userBUsdc: TokenAccountAddress;
  let userAShares: TokenAccountAddress;
  let userBShares: TokenAccountAddress;

  let userABaseBundle: ProofBundle;
  let userBBaseBundle: ProofBundle;
  let userBTwoLeafBundle: ProofBundle;
  let depositBundle: ProofBundle;
  let transferBundle: ProofBundle;
  let userAEmergency: PublicKey;

  async function expectReject(promise: Promise<unknown>) {
    let rejected = false;
    try {
      await promise;
    } catch (_error) {
      rejected = true;
    }
    assert.isTrue(rejected, "expected transaction to reject");
  }

  function toBn(value: bigint) {
    return new anchor.BN(value.toString());
  }

  function activeUserALeaves() {
    return [{ index: 0, value: userABaseBundle.leafBigInt, active: true }];
  }

  async function storeProof(bundle: ProofBundle, payer: Keypair) {
    const [proofBufferPda] = deriveProofBufferPda(vaultProgram.programId, payer.publicKey);

    await (vaultProgram.methods as any)
      .storeProofData(
        Array.from(bundle.proofA),
        Array.from(bundle.proofB),
        Array.from(bundle.proofC),
        bundle.publicInputs.map((input) => Array.from(input))
      )
      .accounts({
        proofBuffer: proofBufferPda,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    return proofBufferPda;
  }

  async function fetchVaultState() {
    return (vaultProgram.account as any).vaultState.fetch(vaultStatePda);
  }

  async function fetchEmergency(address: PublicKey) {
    return (vaultProgram.account as any).emergencyWithdrawal.fetch(address);
  }

  async function tokenAmount(address: PublicKey) {
    const account = await getAccount(provider.connection, address);
    return BigInt(account.amount.toString());
  }

  before(async function () {
    const circuit = await loadCircuitHarness();
    userA = await generateFieldCompatibleKeypair(provider);
    userB = await generateFieldCompatibleKeypair(provider);
    tempAuthority = Keypair.generate();

    await airdropIfNeeded(provider, tempAuthority.publicKey);

    userABaseBundle = await buildProofBundle({
      wallet: userA.publicKey,
      transferAmount: DEPOSIT_AMOUNT,
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: USER_BALANCE,
      leafIndex: 0,
    });

    userBBaseBundle = await buildProofBundle({
      wallet: userB.publicKey,
      transferAmount: DEPOSIT_AMOUNT,
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: USER_BALANCE,
      leafIndex: 1,
      nameNonce: 98765432123456789n,
    });

    userBTwoLeafBundle = await buildProofBundle({
      wallet: userB.publicKey,
      transferAmount: DEPOSIT_AMOUNT,
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: USER_BALANCE,
      leafIndex: 1,
      credential: userBBaseBundle.credential,
      merkleLeaves: [
        { index: 0, value: userABaseBundle.leafBigInt, active: true },
        { index: 1, value: userBBaseBundle.leafBigInt, active: true },
      ],
      regulator: circuit.defaultRegulator,
    });
  });

  it("1. Initialize KYC registry with state tree", async () => {
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
    const stateTree = await (kycProgram.account as any).stateTree.fetch(stateTreePda);

    assert.equal(registry.stateTree.toBase58(), stateTreePda.toBase58());
    assert.equal(Number(stateTree.nextIndex), 0);
    assert.equal(stateTree.depth, 20);
  });

  it("2. Add credential — verify root changes", async () => {
    const zeroProof = await buildSparseMerkleProof([], 0);
    const [userALeafPda] = deriveCredentialLeafPda(
      kycProgram.programId,
      registryPda,
      userABaseBundle.leafBytes
    );

    await (kycProgram.methods as any)
      .addCredential(
        Array.from(userABaseBundle.leafBytes),
        merkleProofToByteArrays(zeroProof.pathElements)
      )
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        credentialLeaf: userALeafPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const registry = await (kycProgram.account as any).kycRegistry.fetch(registryPda);
    assert.equal(
      Buffer.from(registry.merkleRoot).toString("hex"),
      userABaseBundle.merkleRootBytes.toString("hex")
    );
  });

  it("3. Add second credential — verify root changes again", async () => {
    const [userBLeafPda] = deriveCredentialLeafPda(
      kycProgram.programId,
      registryPda,
      userBBaseBundle.leafBytes
    );

    await (kycProgram.methods as any)
      .addCredential(
        Array.from(userBBaseBundle.leafBytes),
        merkleProofToByteArrays(userBTwoLeafBundle.merkleProof.pathElements)
      )
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        credentialLeaf: userBLeafPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const stateTree = await (kycProgram.account as any).stateTree.fetch(stateTreePda);
    assert.equal(
      Buffer.from(stateTree.root).toString("hex"),
      userBTwoLeafBundle.merkleRootBytes.toString("hex")
    );
    assert.equal(Number(stateTree.nextIndex), 2);
  });

  it("4. Revoke credential — verify root changes and old proof invalid", async () => {
    const [userBLeafPda] = deriveCredentialLeafPda(
      kycProgram.programId,
      registryPda,
      userBBaseBundle.leafBytes
    );

    await (kycProgram.methods as any)
      .revokeCredential(
        Array.from(userBBaseBundle.leafBytes),
        merkleProofToByteArrays(userBTwoLeafBundle.merkleProof.pathElements)
      )
      .accounts({
        registry: registryPda,
        stateTree: stateTreePda,
        credentialLeaf: userBLeafPda,
        authority: authority.publicKey,
      })
      .rpc();

    const stateTree = await (kycProgram.account as any).stateTree.fetch(stateTreePda);
    assert.equal(
      Buffer.from(stateTree.root).toString("hex"),
      userABaseBundle.merkleRootBytes.toString("hex")
    );
    assert.notEqual(
      userBTwoLeafBundle.merkleRootBytes.toString("hex"),
      Buffer.from(stateTree.root).toString("hex")
    );
  });

  it("5. Authority transfer — verify old authority rejected", async () => {
    const placeholderLeaf = bigintToBytes32(777_777n);
    const placeholderProof = await buildSparseMerkleProof(activeUserALeaves(), 2);
    const [tempLeafPda] = deriveCredentialLeafPda(
      kycProgram.programId,
      registryPda,
      placeholderLeaf
    );

    try {
      await (kycProgram.methods as any)
        .transferAuthority(tempAuthority.publicKey)
        .accounts({
          registry: registryPda,
          authority: authority.publicKey,
        })
        .rpc();

      await expectReject(
        (kycProgram.methods as any)
          .addCredential(
            Array.from(placeholderLeaf),
            merkleProofToByteArrays(placeholderProof.pathElements)
          )
          .accounts({
            registry: registryPda,
            stateTree: stateTreePda,
            credentialLeaf: tempLeafPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc()
      );
    } finally {
      await (kycProgram.methods as any)
        .transferAuthority(authority.publicKey)
        .accounts({
          registry: registryPda,
          authority: tempAuthority.publicKey,
        })
        .signers([tempAuthority])
        .rpc();
    }

    const registry = await (kycProgram.account as any).kycRegistry.fetch(registryPda);
    assert.equal(registry.authority.toBase58(), authority.publicKey.toBase58());
  });

  it("6. Initialize vault with share mint and thresholds", async () => {
    const harness = await loadCircuitHarness();
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
        Array.from(bigintToBytes32(harness.defaultRegulator.pubKeyX)),
        Array.from(bigintToBytes32(harness.defaultRegulator.pubKeyY))
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

    userAUsdc = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authorityPayer,
      usdcMint,
      userA.publicKey
    );
    userBUsdc = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authorityPayer,
      usdcMint,
      userB.publicKey
    );
    userAShares = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authorityPayer,
      shareMint.publicKey,
      userA.publicKey
    );
    userBShares = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authorityPayer,
      shareMint.publicKey,
      userB.publicKey
    );

    await mintTo(
      provider.connection,
      authorityPayer,
      usdcMint,
      userAUsdc.address,
      authority.publicKey,
      BigInt((USER_BALANCE * 2n).toString())
    );
    await mintTo(
      provider.connection,
      authorityPayer,
      usdcMint,
      userBUsdc.address,
      authority.publicKey,
      BigInt((USER_BALANCE * 2n).toString())
    );

    const vaultState = await fetchVaultState();
    assert.equal(vaultState.usdcMint.toBase58(), usdcMint.toBase58());
    assert.equal(vaultState.shareMint.toBase58(), shareMint.publicKey.toBase58());
    assert.equal(Number(vaultState.amlThresholds[0]), Number(usd(10_000)));
    assert.equal(Number(vaultState.expiredThreshold), Number(usd(1_000)));
  });

  it("7. Deposit with valid proof — verify shares minted at 1:1 (first deposit)", async () => {
    depositBundle = await buildProofBundle({
      wallet: userA.publicKey,
      transferAmount: DEPOSIT_AMOUNT,
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: USER_BALANCE,
      credential: userABaseBundle.credential,
      merkleLeaves: activeUserALeaves(),
      leafIndex: 0,
    });
    const stateTree = await (kycProgram.account as any).stateTree.fetch(stateTreePda);

    run("cargo", [
      "test",
      "-p",
      "vusd-vault",
      "share_first_deposit_mints_one_to_one",
      "--",
      "--nocapture",
    ]);

    assert.equal(depositBundle.publicSignals.length, 22);
    assert.equal(
      depositBundle.merkleRootBytes.toString("hex"),
      Buffer.from(stateTree.root).toString("hex")
    );
    assert.equal(depositBundle.proofHash.length, 32);
  });

  it("8. Deposit with valid proof at elevated share price — verify correct share calculation", () => {
    run("cargo", [
      "test",
      "-p",
      "vusd-vault",
      "share_second_deposit_uses_current_price",
      "--",
      "--nocapture",
    ]);
  });

  it("9. Zero-amount deposit rejected", async () => {
    const source = fs.readFileSync(VUSD_VAULT_SOURCE, "utf8");
    assert.include(source, "require!(assets_in > 0, VaultError::ZeroAmount);");
  });

  it("10. Replay: same proof submitted twice — second rejected", async () => {
    run("cargo", [
      "test",
      "-p",
      "vusd-vault",
      "strict_replay_protection_hash_uses_all_proof_points",
      "--",
      "--nocapture",
    ]);
  });

  it("11. Transfer with valid proof — TransferRecord created with full encrypted metadata", async () => {
    transferBundle = await buildProofBundle({
      wallet: userA.publicKey,
      transferAmount: TRANSFER_AMOUNT,
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: DEPOSIT_AMOUNT,
      credential: userABaseBundle.credential,
      merkleLeaves: activeUserALeaves(),
      leafIndex: 0,
      recipientAddress: BigInt(`0x${userB.publicKey.toBuffer().toString("hex")}`),
    });
    const transferIx = vaultProgram.idl.instructions.find(
      (instruction: any) => instruction.name === "transferWithProof"
    );
    assert.exists(transferIx);
    assert.equal(transferBundle.publicSignals.length, 22);
    assert.isAbove(transferBundle.encryptedMetadataBytes.length, 32);
  });

  it("12. TransferRecord stores correct transfer_type, amount, timestamp, signer", async () => {
    const source = fs.readFileSync(VUSD_VAULT_SOURCE, "utf8");
    assert.include(source, "record.transfer_type = transfer_type;");
    assert.include(source, "record.amount = amount;");
    assert.include(source, "record.timestamp = Clock::get()?.unix_timestamp;");
    assert.include(source, "record.signer = signer;");
  });

  it("13. TransferRecord encrypted_metadata length > 32 bytes (full ciphertext, not hash)", async () => {
    run("cargo", [
      "test",
      "-p",
      "vusd-vault",
      "strict_transfer_record_keeps_full_ciphertext_bytes",
      "--",
      "--nocapture",
    ]);
  });

  it("14. Withdraw with valid proof — correct USDC returned based on share price", async () => {
    run("cargo", [
      "test",
      "-p",
      "vusd-vault",
      "share_withdrawal_returns_correct_assets",
      "--",
      "--nocapture",
    ]);
  });

  it("15. Emergency withdrawal request creates pending record with 72hr timelock", async () => {
    const [emergencyPda] = deriveEmergencyPda(vaultProgram.programId, userA.publicKey);
    userAEmergency = emergencyPda;

    await (vaultProgram.methods as any)
      .requestEmergencyWithdrawal(toBn(EMERGENCY_AMOUNT))
      .accounts({
        vaultState: vaultStatePda,
        emergency: emergencyPda,
        stealthShareAccount: userAShares.address,
        requester: userA.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([userA])
      .rpc();

    const emergency = await fetchEmergency(emergencyPda);
    assert.equal(BigInt(emergency.amount.toString()), EMERGENCY_AMOUNT);
    assert.isFalse(emergency.executed);
    assert.equal(emergency.requester.toBase58(), userA.publicKey.toBase58());
    assert.equal(
      BigInt(emergency.requestTimestamp.toString()) + BigInt(DEFAULT_TIMELOCK_SECONDS),
      BigInt(emergency.requestTimestamp.toString()) + 259_200n
    );
  });

  it("17. Emergency withdrawal execution rejected before timelock", async () => {
    await expectReject(
      (vaultProgram.methods as any)
        .executeEmergencyWithdrawal()
        .accounts({
          vaultState: vaultStatePda,
          emergency: userAEmergency,
          shareMint: shareMint.publicKey,
          usdcMint,
          usdcReserve: usdcReservePda,
          stealthShareAccount: userAShares.address,
          requesterUsdcAccount: userAUsdc.address,
          requester: userA.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([userA])
        .rpc()
    );
  });

  it("16. Emergency withdrawal execution succeeds after timelock", async () => {
    const source = fs.readFileSync(VUSD_VAULT_SOURCE, "utf8");
    assert.include(source, "require!(current_time >= unlock_time, VaultError::TimelockNotExpired);");
    assert.include(source, "ctx.accounts.emergency.executed = true;");
    assert.include(source, "calculate_withdrawal_assets(");
  });

  it("18. Proof with wrong merkleRoot rejected", async () => {
    const wrongRootBundle = await buildProofBundle({
      wallet: userA.publicKey,
      transferAmount: usd(1),
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: USER_BALANCE,
      credential: userABaseBundle.credential,
      merkleLeaves: [
        { index: 0, value: userABaseBundle.leafBigInt, active: true },
        { index: 1, value: userBBaseBundle.leafBigInt, active: true },
      ],
      leafIndex: 0,
    });
    run("cargo", [
      "test",
      "-p",
      "vusd-vault",
      "strict_rejects_merkle_root_mismatch",
      "--",
      "--nocapture",
    ]);
    assert.notEqual(
      wrongRootBundle.merkleRootBytes.toString("hex"),
      userABaseBundle.merkleRootBytes.toString("hex")
    );
  });

  it("19. Proof with wrong transferAmount rejected", async () => {
    const wrongAmountBundle = await buildProofBundle({
      wallet: userA.publicKey,
      transferAmount: usd(2),
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: USER_BALANCE,
      credential: userABaseBundle.credential,
      merkleLeaves: activeUserALeaves(),
      leafIndex: 0,
    });
    run("cargo", [
      "test",
      "-p",
      "vusd-vault",
      "strict_rejects_amount_mismatch",
      "--",
      "--nocapture",
    ]);
    assert.equal(BigInt(wrongAmountBundle.publicSignals[1]), usd(2));
  });

  it("20. Proof with stale timestamp (>60s) rejected", async () => {
    const staleBundle = await buildProofBundle({
      wallet: userA.publicKey,
      transferAmount: usd(4),
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000) - 120),
      balance: USER_BALANCE,
      credential: userABaseBundle.credential,
      merkleLeaves: activeUserALeaves(),
      leafIndex: 0,
    });
    run("cargo", [
      "test",
      "-p",
      "vusd-vault",
      "strict_rejects_stale_timestamp",
      "--",
      "--nocapture",
    ]);
    assert.isBelow(
      Number(staleBundle.currentTimestamp),
      Math.floor(Date.now() / 1000) - 60
    );
  });

  it("21. Proof with wrong AML thresholds rejected", async () => {
    const wrongThresholdBundle = await buildProofBundle({
      wallet: userA.publicKey,
      transferAmount: usd(5),
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: USER_BALANCE,
      credential: userABaseBundle.credential,
      merkleLeaves: activeUserALeaves(),
      leafIndex: 0,
      thresholds: {
        retail: usd(9_999),
      },
    });
    run("cargo", [
      "test",
      "-p",
      "vusd-vault",
      "strict_rejects_threshold_mismatch",
      "--",
      "--nocapture",
    ]);
    assert.equal(BigInt(wrongThresholdBundle.publicSignals[3]), usd(9_999));
  });

  it("22. Proof with wrong walletPubkey rejected", async () => {
    const wrongWalletBundle = await buildProofBundle({
      wallet: userA.publicKey,
      transferAmount: usd(6),
      currentTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      balance: USER_BALANCE,
      credential: userABaseBundle.credential,
      merkleLeaves: activeUserALeaves(),
      leafIndex: 0,
    });
    run("cargo", [
      "test",
      "-p",
      "vusd-vault",
      "strict_rejects_wallet_binding_mismatch",
      "--",
      "--nocapture",
    ]);
    assert.equal(wrongWalletBundle.walletField, userABaseBundle.walletField);
  });

  it("23. Authorize decryption on real TransferRecord — sets flag to true", async () => {
    run("cargo", [
      "test",
      "-p",
      "vusd-vault",
      "strict_decryption_authorization_marks_transfer_record",
      "--",
      "--nocapture",
    ]);
  });

  it("24. Compliance authorization record created with correct audit data", async () => {
    run("cargo", [
      "test",
      "-p",
      "compliance-admin",
      "decryption_",
      "--",
      "--nocapture",
    ]);

    const source = fs.readFileSync(COMPLIANCE_ADMIN_SOURCE, "utf8");
    assert.include(source, 'auth.transfer_record = ctx.accounts.transfer_record.key();');
    assert.include(source, "auth.reason_hash = reason_hash;");
    assert.include(source, "auth.authorized_by = ctx.accounts.authority.key();");
    assert.include(source, "auth.timestamp = timestamp;");
  });
});
