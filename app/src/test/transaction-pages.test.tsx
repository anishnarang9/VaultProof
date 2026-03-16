import { BN } from '@coral-xyz/anchor';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Compliance from '../pages/Compliance';
import Credential from '../pages/Credential';
import Deposit from '../pages/Deposit';

const mockState = vi.hoisted(() => {
  const connection = {
    confirmTransaction: vi.fn(async () => ({ value: { err: null } })),
  };

  return {
    buildAddCredentialTx: vi.fn(async () => ({ instructions: [] })),
    buildAuthorizeDecryptionTx: vi.fn(async () => ({ instructions: [] })),
    buildDepositTx: vi.fn(async () => ({ instructions: [] })),
    clearCredential: vi.fn(),
    connection,
    complianceAdminProgramId: 'BsEMZCJzj3SqwSj6z2F3X8m9rFHjLubgBzMeSgj8Lp6K',
    getPrograms: vi.fn(() => ({
      complianceAdmin: { programId: 'placeholder' },
      kycRegistry: { programId: 'placeholder' },
      vusdVault: { programId: 'placeholder' },
    })),
    hashCredentialLeaf: vi.fn(async () => `0x${'11'.repeat(32)}`),
    publicKeyBase58: 'DzGXeLhKHH81BKSLnQ82FWbmxyPezd7FUgLGDvSkzPge',
    proofGenerate: vi.fn(async () => ({
      encryptedMetadata: new Uint8Array(384),
      proof: {
        pi_a: ['1', '2', '1'],
        pi_b: [
          ['3', '4'],
          ['5', '6'],
          ['1', '0'],
        ],
        pi_c: ['7', '8', '1'],
      },
      publicSignals: Array.from({ length: 22 }, (_, index) => String(index + 1)),
    })),
    proofReset: vi.fn(),
    proofToOnchainFormat: vi.fn(() => ({
      proofA: Array.from({ length: 64 }, () => 1),
      proofB: Array.from({ length: 128 }, () => 2),
      proofC: Array.from({ length: 64 }, () => 3),
      publicInputs: Array.from({ length: 22 }, () => Array.from({ length: 32 }, () => 4)),
    })),
    refreshRegistry: vi.fn(async () => {}),
    refreshTransfers: vi.fn(async () => {}),
    refreshVault: vi.fn(async () => {}),
    saveCredential: vi.fn(),
    sendTransaction: vi.fn(async () => '5ignature111111111111111111111111111111111111'),
    shareMintBase58: 'So11111111111111111111111111111111111111112',
    transferRecordAddress: '4vJ9JU1bJJE96FWS7xL4TvT42P4Jd5Zr2Z8m6Rv4X2oK',
  };
});

const {
  buildAddCredentialTx,
  buildAuthorizeDecryptionTx,
  buildDepositTx,
  getPrograms,
  hashCredentialLeaf,
  proofGenerate,
  proofToOnchainFormat,
  sendTransaction,
} = mockState;

vi.mock('@solana/wallet-adapter-react', () => ({
  useAnchorWallet: () => ({
    publicKey: { toBase58: () => mockState.publicKeyBase58 },
    signAllTransactions: vi.fn(async (transactions) => transactions),
    signTransaction: vi.fn(async (transaction) => transaction),
  }),
  useConnection: () => ({ connection: mockState.connection }),
  useWallet: () => ({
    publicKey: { toBase58: () => mockState.publicKeyBase58 },
    sendTransaction: mockState.sendTransaction,
  }),
}));

vi.mock('../hooks/useCredential', () => ({
  useCredential: () => ({
    clearCredential: mockState.clearCredential,
    credential: {
      accreditation: 'accredited',
      countryCode: 'US',
      dateOfBirth: '1990-01-01',
      expiresAt: '2030-01-01T00:00:00.000Z',
      fullName: 'Jane Doe',
      identitySecret: '123456',
      issuedAt: '2026-01-01T00:00:00.000Z',
      jurisdiction: 'United States',
      leafHash: `0x${'22'.repeat(32)}`,
      wallet: mockState.publicKeyBase58,
    },
    saveCredential: mockState.saveCredential,
  }),
}));

vi.mock('../hooks/useRegistryState', () => ({
  useRegistryState: () => ({
    data: {
      activeCredentials: new BN(1),
      merkleRootHex: `0x${'00'.repeat(32)}`,
    },
    refresh: mockState.refreshRegistry,
  }),
}));

vi.mock('../hooks/useVaultState', () => ({
  useVaultState: () => ({
    data: {
      emergencyTimelock: new BN(259_200),
      regulatorKey: {
        x: Array.from({ length: 32 }, () => 7),
        y: Array.from({ length: 32 }, () => 8),
      },
      shareMint: { toBase58: () => mockState.shareMintBase58 },
      sharePrice: 1,
      thresholds: {
        retail: new BN(10_000),
        accredited: new BN(100_000),
        institutional: new BN(1_000_000),
        expired: new BN(1_000),
      },
    },
    refresh: mockState.refreshVault,
  }),
}));

vi.mock('../hooks/useTransferRecords', () => ({
  useTransferRecords: () => ({
    records: [
      {
        address: { toBase58: () => mockState.transferRecordAddress },
        amount: new BN(500),
        decryptionAuthorized: false,
        encryptedMetadata: Array.from({ length: 32 }, (_, index) => index),
        proofHash: Array.from({ length: 32 }, (_, index) => index + 1),
        timestamp: new BN(1_742_000_000),
        transferType: 'Transfer',
      },
    ],
    refresh: mockState.refreshTransfers,
  }),
}));

vi.mock('../hooks/useProofGeneration', () => ({
  useProofGeneration: () => ({
    error: null,
    generate: mockState.proofGenerate,
    isGenerating: false,
    proofTime: null,
    reset: mockState.proofReset,
    step: 'ready',
    timeline: [],
  }),
}));

vi.mock('../lib/program', async () => {
  const actual = await vi.importActual<typeof import('../lib/program')>('../lib/program');
  return {
    ...actual,
    buildAddCredentialTx: mockState.buildAddCredentialTx,
    buildAuthorizeDecryptionTx: mockState.buildAuthorizeDecryptionTx,
    buildDepositTx: mockState.buildDepositTx,
    getPrograms: mockState.getPrograms,
    proofToOnchainFormat: mockState.proofToOnchainFormat,
  };
});

vi.mock('../lib/credential', async () => {
  const actual = await vi.importActual<typeof import('../lib/credential')>('../lib/credential');
  return {
    ...actual,
    hashCredentialLeaf: mockState.hashCredentialLeaf,
  };
});

describe('frontend transaction pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPrograms.mockReturnValue({
      complianceAdmin: { programId: 'BsEMZCJzj3SqwSj6z2F3X8m9rFHjLubgBzMeSgj8Lp6K' },
      kycRegistry: { programId: 'NsgKr1qCEUb1vXdwaGvbz3ygG4R4SCrUQm3T8tHoqgD' },
      vusdVault: { programId: 'CUxwkHjKjGyKa5H1qEQySw98yKn33RZFxc9TbVgU6rdu' },
    });
  });

  it('Credential submits add_credential after staging the leaf', async () => {
    const user = userEvent.setup();
    render(<Credential />);

    await user.click(screen.getByRole('button', { name: /issue credential/i }));

    await waitFor(() => expect(hashCredentialLeaf).toHaveBeenCalled());
    await waitFor(() => expect(buildAddCredentialTx).toHaveBeenCalled());
    await waitFor(() => expect(sendTransaction).toHaveBeenCalled());
  });

  it('Deposit builds and submits the deposit transaction after proof generation', async () => {
    const user = userEvent.setup();
    render(<Deposit />);

    await user.click(screen.getByRole('button', { name: /generate proof and deposit/i }));

    await waitFor(() => expect(proofGenerate).toHaveBeenCalled());
    await waitFor(() => expect(proofToOnchainFormat).toHaveBeenCalled());
    await waitFor(() => expect(buildDepositTx).toHaveBeenCalled());
    await waitFor(() => expect(sendTransaction).toHaveBeenCalled());
  });

  it('Compliance authorizes transfer record decryption from the table action', async () => {
    const user = userEvent.setup();
    render(<Compliance />);

    await user.click(screen.getByRole('button', { name: /authorize/i }));

    await waitFor(() => expect(buildAuthorizeDecryptionTx).toHaveBeenCalled());
    await waitFor(() => expect(sendTransaction).toHaveBeenCalled());
  });
});
