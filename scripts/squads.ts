import * as multisig from "@sqds/multisig";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";

export const SQUADS_PROGRAM_ID = new PublicKey(
  "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf",
);

export type SquadsContext = {
  createKey: Keypair;
  members: [Keypair, Keypair, Keypair];
  multisigPda: PublicKey;
  programId: PublicKey;
  threshold: number;
  vaultPda: PublicKey;
  vaultIndex: number;
};

async function confirmSignature(connection: Connection, signature: TransactionSignature) {
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

export async function airdropIfNeeded(
  connection: Connection,
  pubkey: PublicKey,
  minimumLamports = LAMPORTS_PER_SOL,
) {
  const balance = await connection.getBalance(pubkey, "confirmed");
  if (balance >= minimumLamports) {
    return;
  }

  try {
    const signature = await connection.requestAirdrop(pubkey, minimumLamports * 2);
    await confirmSignature(connection, signature);
  } catch {
    console.warn(`Airdrop failed for ${pubkey.toBase58()} (rate limited?), skipping`);
  }
}

export async function transferLamports(
  connection: Connection,
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
  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  const signature = await connection.sendTransaction(tx);
  await connection.confirmTransaction(
    {
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      signature,
    },
    "confirmed",
  );
}

export async function createSquadsMultisig(
  connection: Connection,
  members: [Keypair, Keypair, Keypair],
  threshold = 2,
  programId = SQUADS_PROGRAM_ID,
): Promise<SquadsContext> {
  const createKey = Keypair.generate();
  const [programConfigPda] = multisig.getProgramConfigPda({ programId });
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    programConfigPda,
    "confirmed",
  );
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
    programId,
  });
  const vaultIndex = 0;
  const [vaultPda] = multisig.getVaultPda({
    index: vaultIndex,
    multisigPda,
    programId,
  });

  const signature = await multisig.rpc.multisigCreateV2({
    configAuthority: null,
    connection,
    createKey,
    creator: members[0],
    members: members.map((member) => ({
      key: member.publicKey,
      permissions: multisig.types.Permissions.all(),
    })),
    multisigPda,
    programId,
    rentCollector: null,
    threshold,
    timeLock: 0,
    treasury: programConfig.treasury,
  });
  await confirmSignature(connection, signature);

  return {
    createKey,
    members,
    multisigPda,
    programId,
    threshold,
    vaultIndex,
    vaultPda,
  };
}

export async function nextSquadsTransactionIndex(
  connection: Connection,
  multisigPda: PublicKey,
  programId = SQUADS_PROGRAM_ID,
) {
  const account = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda,
    "confirmed",
    // fromAccountAddress accepts either commitment or config, not a program id.
  );
  return BigInt(account.transactionIndex.toString()) + 1n;
}

export async function createApproveExecuteVaultTransaction(params: {
  additionalSigners?: Keypair[];
  approver: Keypair;
  connection: Connection;
  creator: Keypair;
  executor?: Keypair;
  feePayer?: Keypair;
  instructionLabel: string;
  multisigPda: PublicKey;
  programId?: PublicKey;
  transactionMessage: TransactionMessage;
  vaultIndex?: number;
}) {
  const {
    additionalSigners = [],
    approver,
    connection,
    creator,
    executor = creator,
    feePayer = creator,
    instructionLabel,
    multisigPda,
    programId = SQUADS_PROGRAM_ID,
    transactionMessage,
    vaultIndex = 0,
  } = params;
  const transactionIndex = await nextSquadsTransactionIndex(connection, multisigPda, programId);

  const vaultCreateSignature = await multisig.rpc.vaultTransactionCreate({
    connection,
    creator: creator.publicKey,
    feePayer,
    multisigPda,
    programId,
    rentPayer: creator.publicKey,
    transactionIndex,
    transactionMessage,
    vaultIndex,
    ephemeralSigners: 0,
  });
  await confirmSignature(connection, vaultCreateSignature);

  const proposalCreateSignature = await multisig.rpc.proposalCreate({
    connection,
    creator,
    feePayer: creator,
    multisigPda,
    programId,
    transactionIndex,
  });
  await confirmSignature(connection, proposalCreateSignature);

  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    programId,
    transactionIndex,
  });
  let proposal = await multisig.accounts.Proposal.fromAccountAddress(
    connection,
    proposalPda,
    "confirmed",
  );

  if (proposal.status.__kind === "Draft") {
    const activateSignature = await multisig.rpc.proposalActivate({
      connection,
      feePayer: creator,
      member: creator,
      multisigPda,
      programId,
      transactionIndex,
    });
    await confirmSignature(connection, activateSignature);
    proposal = await multisig.accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda,
      "confirmed",
    );
  }

  const creatorApproved = proposal.approved.some((member) => member.equals(creator.publicKey));
  if (!creatorApproved) {
    const creatorApproveSignature = await multisig.rpc.proposalApprove({
      connection,
      feePayer: creator,
      member: creator,
      multisigPda,
      programId,
      transactionIndex,
    });
    await confirmSignature(connection, creatorApproveSignature);
  }

  proposal = await multisig.accounts.Proposal.fromAccountAddress(
    connection,
    proposalPda,
    "confirmed",
  );
  const approverApproved = proposal.approved.some((member) => member.equals(approver.publicKey));
  if (!approverApproved) {
    const approverSignature = await multisig.rpc.proposalApprove({
      connection,
      feePayer: approver,
      member: approver,
      multisigPda,
      programId,
      transactionIndex,
    });
    await confirmSignature(connection, approverSignature);
  }

  const executeSignature = await multisig.rpc.vaultTransactionExecute({
    connection,
    feePayer: executor,
    member: executor.publicKey,
    multisigPda,
    programId,
    signers: additionalSigners,
    transactionIndex,
  });
  await confirmSignature(connection, executeSignature);

  const executedProposal = await multisig.accounts.Proposal.fromAccountAddress(
    connection,
    proposalPda,
    "confirmed",
  );

  return {
    executeSignature,
    instructionLabel,
    proposal: executedProposal,
    proposalPda,
    transactionIndex,
  };
}
