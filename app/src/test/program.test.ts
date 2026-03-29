import { BN, BorshAccountsCoder, BorshInstructionCoder, type Idl } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import {
  buildAddCredentialTx,
  buildAddYieldVenueTx,
  buildAccrueYieldTx,
  buildAuthorizeDecryptionTx,
  buildDepositTx,
  deriveRegistryPda,
  deriveStateTreePda,
  deriveUsdcReservePda,
  deriveVaultStatePda,
  buildRemoveYieldVenueTx,
  buildUnpauseVaultTx,
  buildUpdateRiskLimitsTx,
  deriveYieldVenuePda,
  getPrograms,
} from '../lib/program';

const VUSD_VAULT_PROGRAM_ID = new PublicKey('2ZrgfkWWHoverBrKXwZsUnmZMaHUFssGipng31jrnn28');
const KYC_REGISTRY_PROGRAM_ID = new PublicKey('HKAr17WzrUyXudnWb63jxpRtXSEYAFnovv3kVfSKB4ih');
const COMPLIANCE_ADMIN_PROGRAM_ID = new PublicKey('J6Z2xLJajs627cCpQQGBRqkvPEGE6YkXsx22CTwFkCaF');
const VAULT_STATE_PDA = new PublicKey('CvQYwyNyRmxMKSpfesGMjw7qBxzseaUdh2UEE7YrbCDf');
const KYC_REGISTRY_PDA = new PublicKey('DAS2RiFpGVh9enhXq13E9a2ScVCoTi867CSYXCK8gBQ3');
const STATE_TREE_PDA = new PublicKey('B5RQ3bTuoqLdKr4Mi3LMNh4PfQM812ozyRBx1UNnVzzi');
const USDC_RESERVE_PDA = new PublicKey('75qEzEF8dmwjV31cLrh8Q4NqbW8dJimEauEKoLRHAFyz');

const vaultAccountsIdl = {
  version: '0.1.0',
  name: 'vaultAccounts',
  accounts: [
    {
      name: 'vaultState',
      discriminator: [228, 196, 82, 165, 98, 210, 235, 152],
    },
  ],
  types: [
    {
      name: 'vaultState',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'pubkey' },
          { name: 'usdcMint', type: 'pubkey' },
          { name: 'shareMint', type: 'pubkey' },
          { name: 'usdcReserve', type: 'pubkey' },
          { name: 'totalAssets', type: 'u64' },
          { name: 'totalShares', type: 'u64' },
          { name: 'sharePriceNumerator', type: 'u64' },
          { name: 'sharePriceDenominator', type: 'u64' },
          { name: 'yieldSource', type: 'pubkey' },
          { name: 'liquidBufferBps', type: 'u16' },
          { name: 'totalYieldEarned', type: 'u64' },
          { name: 'amlThresholds', type: { array: ['u64', 3] } },
          { name: 'expiredThreshold', type: 'u64' },
          { name: 'emergencyTimelock', type: 'i64' },
          { name: 'regulatorPubkeyX', type: { array: ['u8', 32] } },
          { name: 'regulatorPubkeyY', type: { array: ['u8', 32] } },
          { name: 'bump', type: 'u8' },
          { name: 'reserveBump', type: 'u8' },
        ],
      },
    },
  ],
} as unknown as Idl;

const registryAccountsIdl = {
  version: '0.1.0',
  name: 'registryAccounts',
  accounts: [
    {
      name: 'stateTree',
      discriminator: [93, 3, 106, 105, 49, 120, 84, 187],
    },
    {
      name: 'credentialLeaf',
      discriminator: [244, 122, 140, 233, 134, 83, 144, 113],
    },
  ],
  types: [
    {
      name: 'stateTree',
      type: {
        kind: 'struct',
        fields: [
          { name: 'registry', type: 'pubkey' },
          { name: 'root', type: { array: ['u8', 32] } },
          { name: 'depth', type: 'u8' },
          { name: 'nextIndex', type: 'u32' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'credentialLeaf',
      type: {
        kind: 'struct',
        fields: [
          { name: 'registry', type: 'pubkey' },
          { name: 'stateTree', type: 'pubkey' },
          { name: 'leafHash', type: { array: ['u8', 32] } },
          { name: 'leafIndex', type: 'u32' },
          { name: 'active', type: 'bool' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
} as unknown as Idl;

const vaultAccountsCoder = new BorshAccountsCoder(vaultAccountsIdl);
const registryAccountsCoder = new BorshAccountsCoder(registryAccountsIdl);

async function encodeAccount(
  coder: BorshAccountsCoder,
  accountName: string,
  account: Record<string, unknown>,
) {
  return Buffer.from(await coder.encode(accountName, account));
}

function bigintToBytes32(value: bigint) {
  const hex = value.toString(16).padStart(64, '0');
  return Array.from(Buffer.from(hex, 'hex'));
}

function createMockConnection() {
  const accounts = new Map<string, { data: Buffer } | null>();
  const programAccounts = new Map<string, Array<{ pubkey: PublicKey; account: { data: Buffer } }>>();

  return {
    accounts,
    programAccounts,
    connection: {
      getAccountInfo: vi.fn(async (address: PublicKey) => accounts.get(address.toBase58()) ?? null),
      getProgramAccounts: vi.fn(
        async (programId: PublicKey) => programAccounts.get(programId.toBase58()) ?? [],
      ),
    },
  };
}

describe('frontend program client', () => {
  const wallet = {
    publicKey: new PublicKey('DzGXeLhKHH81BKSLnQ82FWbmxyPezd7FUgLGDvSkzPge'),
    signAllTransactions: vi.fn(async (transactions) => transactions),
    signTransaction: vi.fn(async (transaction) => transaction),
  };

  it('getPrograms returns three program clients with expected program IDs', () => {
    const { connection } = createMockConnection();
    const programs = getPrograms(connection as never, wallet as never);

    expect(programs.vusdVault.programId.toBase58()).toBe(VUSD_VAULT_PROGRAM_ID.toBase58());
    expect(programs.kycRegistry.programId.toBase58()).toBe(KYC_REGISTRY_PROGRAM_ID.toBase58());
    expect(programs.complianceAdmin.programId.toBase58()).toBe(
      COMPLIANCE_ADMIN_PROGRAM_ID.toBase58(),
    );
  });

  it('derives the rotated static PDAs in test mode', () => {
    expect(deriveVaultStatePda().toBase58()).toBe(VAULT_STATE_PDA.toBase58());
    expect(deriveUsdcReservePda().toBase58()).toBe(USDC_RESERVE_PDA.toBase58());
    expect(deriveRegistryPda().toBase58()).toBe(KYC_REGISTRY_PDA.toBase58());
    expect(deriveStateTreePda(KYC_REGISTRY_PDA).toBase58()).toBe(STATE_TREE_PDA.toBase58());
  });

  it('buildDepositTx produces a Transaction with correct instruction data', async () => {
    const mock = createMockConnection();
    const programs = getPrograms(mock.connection as never, wallet as never);
    const usdcMint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    const shareMint = new PublicKey('So11111111111111111111111111111111111111112');

    mock.accounts.set(
      VAULT_STATE_PDA.toBase58(),
      {
        data: await encodeAccount(vaultAccountsCoder, 'vaultState', {
          authority: wallet.publicKey,
          usdcMint,
          shareMint,
          usdcReserve: USDC_RESERVE_PDA,
          totalAssets: new BN(1_000_000),
          totalShares: new BN(1_000_000),
          sharePriceNumerator: new BN(1),
          sharePriceDenominator: new BN(1),
          yieldSource: SystemProgram.programId,
          liquidBufferBps: 0,
          totalYieldEarned: new BN(0),
          amlThresholds: [new BN(1), new BN(2), new BN(3)],
          expiredThreshold: new BN(4),
          emergencyTimelock: new BN(259_200),
          regulatorPubkeyX: Array.from({ length: 32 }, () => 5),
          regulatorPubkeyY: Array.from({ length: 32 }, () => 6),
          bump: 254,
          reserveBump: 253,
        }),
      },
    );

    const tx = await buildDepositTx({
      amount: new BN(25_000),
      encryptedMetadata: Buffer.alloc(384, 7),
      program: programs.vusdVault,
      proofA: Array.from({ length: 64 }, (_, index) => index),
      proofB: Array.from({ length: 128 }, (_, index) => (index + 1) & 0xff),
      proofC: Array.from({ length: 64 }, (_, index) => (index + 2) & 0xff),
      publicInputs: Array.from({ length: 22 }, (_, index) => bigintToBytes32(BigInt(index + 1))),
      signer: wallet.publicKey,
    });

    const vaultInstructions = tx.instructions.filter((instruction) =>
      instruction.programId.equals(programs.vusdVault.programId),
    );
    const coder = new BorshInstructionCoder(programs.vusdVault.idl as Idl);
    const decoded = vaultInstructions.map((instruction) => coder.decode(instruction.data));

    expect(decoded.map((instruction) => instruction?.name)).toEqual([
      'storeProofData',
      'depositWithProof',
    ]);
    expect((decoded[1]?.data as { amount: BN }).amount.toString()).toBe('25000');
  });

  it('buildAddCredentialTx produces a Transaction with correct accounts', async () => {
    const mock = createMockConnection();
    const programs = getPrograms(mock.connection as never, wallet as never);
    const leafHash = bigintToBytes32(1234n);

    mock.accounts.set(
      STATE_TREE_PDA.toBase58(),
      {
        data: await encodeAccount(registryAccountsCoder, 'stateTree', {
          registry: KYC_REGISTRY_PDA,
          root: Array.from({ length: 32 }, () => 0),
          depth: 20,
          nextIndex: 0,
          bump: 200,
        }),
      },
    );
    mock.programAccounts.set(KYC_REGISTRY_PROGRAM_ID.toBase58(), []);

    const tx = await buildAddCredentialTx({
      leafHash,
      program: programs.kycRegistry,
      signer: wallet.publicKey,
    });

    const kycInstruction = tx.instructions.find((instruction) =>
      instruction.programId.equals(programs.kycRegistry.programId),
    );
    const coder = new BorshInstructionCoder(programs.kycRegistry.idl as Idl);
    const decoded = coder.decode(kycInstruction?.data ?? Buffer.alloc(0));

    expect(decoded?.name).toBe('addCredential');
    expect(kycInstruction?.keys[0]?.pubkey.toBase58()).toBe(KYC_REGISTRY_PDA.toBase58());
    expect(kycInstruction?.keys[1]?.pubkey.toBase58()).toBe(STATE_TREE_PDA.toBase58());
  });

  it('buildAuthorizeDecryptionTx produces a Transaction', async () => {
    const { connection } = createMockConnection();
    const programs = getPrograms(connection as never, wallet as never);
    const transferRecord = SystemProgram.programId;

    const tx = await buildAuthorizeDecryptionTx({
      program: programs.complianceAdmin,
      signer: wallet.publicKey,
      transferRecord,
    });

    const instruction = tx.instructions.find((candidate) =>
      candidate.programId.equals(programs.complianceAdmin.programId),
    );
    const coder = new BorshInstructionCoder(programs.complianceAdmin.idl as Idl);
    const decoded = coder.decode(instruction?.data ?? Buffer.alloc(0));

    expect(decoded?.name).toBe('authorizeDecryption');
    expect(instruction?.keys.some((meta) => meta.pubkey.equals(transferRecord))).toBe(true);
  });

  it('buildUpdateRiskLimitsTx encodes admin risk-limit updates', async () => {
    const { connection } = createMockConnection();
    const programs = getPrograms(connection as never, wallet as never);

    const tx = await buildUpdateRiskLimitsTx({
      circuitBreaker: new BN(100_000),
      maxDailyTxns: 120,
      maxSingleDeposit: new BN(50_000),
      maxSingleTx: new BN(25_000),
      program: programs.vusdVault,
      signer: wallet.publicKey,
    });

    const instruction = tx.instructions.find((candidate) =>
      candidate.programId.equals(programs.vusdVault.programId),
    );
    const coder = new BorshInstructionCoder(programs.vusdVault.idl as Idl);
    const decoded = coder.decode(instruction?.data ?? Buffer.alloc(0));

    expect(decoded?.name).toBe('updateRiskLimits');
    expect((decoded?.data as { circuitBreakerThreshold: BN }).circuitBreakerThreshold.toString()).toBe('100000');
    expect((decoded?.data as { maxSingleTransaction: BN }).maxSingleTransaction.toString()).toBe('25000');
    expect((decoded?.data as { maxSingleDeposit: BN }).maxSingleDeposit.toString()).toBe('50000');
    expect((decoded?.data as { maxDailyTransactions: number }).maxDailyTransactions).toBe(120);
    expect(instruction?.keys[0]?.pubkey.toBase58()).toBe(VAULT_STATE_PDA.toBase58());
    expect(instruction?.keys[1]?.pubkey.toBase58()).toBe(wallet.publicKey.toBase58());
  });

  it('buildUnpauseVaultTx encodes the unpause instruction', async () => {
    const { connection } = createMockConnection();
    const programs = getPrograms(connection as never, wallet as never);

    const tx = await buildUnpauseVaultTx({
      program: programs.vusdVault,
      signer: wallet.publicKey,
    });

    const instruction = tx.instructions.find((candidate) =>
      candidate.programId.equals(programs.vusdVault.programId),
    );
    const coder = new BorshInstructionCoder(programs.vusdVault.idl as Idl);
    const decoded = coder.decode(instruction?.data ?? Buffer.alloc(0));

    expect(decoded?.name).toBe('unpauseVault');
    expect(instruction?.keys[0]?.pubkey.toBase58()).toBe(VAULT_STATE_PDA.toBase58());
    expect(instruction?.keys[1]?.pubkey.toBase58()).toBe(wallet.publicKey.toBase58());
  });

  it('buildAddYieldVenueTx creates a yield-venue account instruction', async () => {
    const { connection } = createMockConnection();
    const programs = getPrograms(connection as never, wallet as never);
    const venueAddress = new PublicKey('9xQeWvG816bUx9EPfEZELDq8Pjyo4LQm4iAfDdcQa1r1');

    const tx = await buildAddYieldVenueTx({
      allocationCapBps: 2_500,
      jurisdictionWhitelist: Array.from({ length: 32 }, (_, index) => index + 1),
      name: 'Kamino Prime',
      program: programs.vusdVault,
      riskRating: 3,
      signer: wallet.publicKey,
      venueAddress,
    });

    const instruction = tx.instructions.find((candidate) =>
      candidate.programId.equals(programs.vusdVault.programId),
    );
    const coder = new BorshInstructionCoder(programs.vusdVault.idl as Idl);
    const decoded = coder.decode(instruction?.data ?? Buffer.alloc(0));
    const expectedYieldVenue = deriveYieldVenuePda(venueAddress);

    expect(decoded?.name).toBe('addYieldVenue');
    expect((decoded?.data as { venueAddress: PublicKey }).venueAddress.toBase58()).toBe(
      venueAddress.toBase58(),
    );
    expect((decoded?.data as { name: string }).name).toBe('Kamino Prime');
    expect((decoded?.data as { allocationCapBps: number }).allocationCapBps).toBe(2_500);
    expect((decoded?.data as { riskRating: number }).riskRating).toBe(3);
    expect(instruction?.keys[0]?.pubkey.toBase58()).toBe(VAULT_STATE_PDA.toBase58());
    expect(instruction?.keys[1]?.pubkey.toBase58()).toBe(expectedYieldVenue.toBase58());
    expect(instruction?.keys[2]?.pubkey.toBase58()).toBe(wallet.publicKey.toBase58());
    expect(instruction?.keys[3]?.pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
  });

  it('buildAccrueYieldTx encodes yield accrual amount', async () => {
    const { connection } = createMockConnection();
    const programs = getPrograms(connection as never, wallet as never);

    const tx = await buildAccrueYieldTx({
      program: programs.vusdVault,
      signer: wallet.publicKey,
      yieldAmount: new BN(9_999),
    });

    const instruction = tx.instructions.find((candidate) =>
      candidate.programId.equals(programs.vusdVault.programId),
    );
    const coder = new BorshInstructionCoder(programs.vusdVault.idl as Idl);
    const decoded = coder.decode(instruction?.data ?? Buffer.alloc(0));

    expect(decoded?.name).toBe('accrueYield');
    expect((decoded?.data as { yieldAmount: BN }).yieldAmount.toString()).toBe('9999');
    expect(instruction?.keys[0]?.pubkey.toBase58()).toBe(VAULT_STATE_PDA.toBase58());
    expect(instruction?.keys[1]?.pubkey.toBase58()).toBe(wallet.publicKey.toBase58());
  });

  it('buildRemoveYieldVenueTx targets the derived yield-venue PDA', async () => {
    const { connection } = createMockConnection();
    const programs = getPrograms(connection as never, wallet as never);
    const venueAddress = new PublicKey('J2uR6L3gAFy5zM7gc3KJ2YMBX1AHzrc4c3SBbGdv8wZ');

    const tx = await buildRemoveYieldVenueTx({
      program: programs.vusdVault,
      signer: wallet.publicKey,
      venueAddress,
    });

    const instruction = tx.instructions.find((candidate) =>
      candidate.programId.equals(programs.vusdVault.programId),
    );
    const coder = new BorshInstructionCoder(programs.vusdVault.idl as Idl);
    const decoded = coder.decode(instruction?.data ?? Buffer.alloc(0));
    const expectedYieldVenue = deriveYieldVenuePda(venueAddress);

    expect(decoded?.name).toBe('removeYieldVenue');
    expect(instruction?.keys[0]?.pubkey.toBase58()).toBe(VAULT_STATE_PDA.toBase58());
    expect(instruction?.keys[1]?.pubkey.toBase58()).toBe(expectedYieldVenue.toBase58());
    expect(instruction?.keys[2]?.pubkey.toBase58()).toBe(wallet.publicKey.toBase58());
  });
});
