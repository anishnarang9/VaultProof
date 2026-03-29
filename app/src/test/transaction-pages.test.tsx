import { BN } from '@coral-xyz/anchor';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PublicKey } from '@solana/web3.js';
import ComplianceDetail from '../pages/ComplianceDetail';
import Credential from '../pages/Credential';
import Deposit from '../pages/Deposit';
import OperatorGovernance from '../pages/OperatorGovernance';
import OperatorRisk from '../pages/OperatorRisk';
import OperatorYield from '../pages/OperatorYield';
import { createEmptyVaultState } from '../lib/types';

const mockState = vi.hoisted(() => ({
  authorityBytes: Array.from({ length: 32 }, () => 6),
  buildAddCredentialTx: vi.fn(async () => ({ instructions: [] })),
  buildAddYieldVenueTx: vi.fn(async () => ({ instructions: [] })),
  buildAccrueYieldTx: vi.fn(async () => ({ instructions: [] })),
  buildAuthorizeDecryptionTx: vi.fn(async () => ({ instructions: [] })),
  buildDepositTx: vi.fn(async () => ({ instructions: [] })),
  buildUnpauseVaultTx: vi.fn(async () => ({ instructions: [] })),
  buildUpdateRiskLimitsTx: vi.fn(async () => ({ instructions: [] })),
  clearCredential: vi.fn(),
  connection: {
    confirmTransaction: vi.fn(async () => ({ value: { err: null } })),
  },
  credential: null as Record<string, unknown> | null,
  getPrograms: vi.fn(() => ({
    complianceAdmin: { programId: 'placeholder' },
    kycRegistry: { programId: 'placeholder' },
    vusdVault: { programId: 'placeholder' },
  })),
  hashCredentialLeaf: vi.fn(async () => `0x${'11'.repeat(32)}`),
  prepareStoredCredential: vi.fn(async () => ({
    issuerSignature: {
      R8: [1n, 2n],
      S: 3n,
    },
  })),
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
  refreshInstitutionalData: vi.fn(async () => {}),
  saveCredential: vi.fn(),
  sendTransaction: vi.fn(async () => '5ignature111111111111111111111111111111111111'),
  walletConnected: true,
}));

function authorityKey() {
  return new PublicKey(Uint8Array.from(mockState.authorityBytes));
}

function baseCredential() {
  return {
    accreditation: 'institutional' as const,
    countryCode: 'US',
    credentialVersion: 1,
    dateOfBirth: '1990-01-01',
    expiresAt: '2030-01-01T00:00:00.000Z',
    fullName: 'Jane Doe',
    identitySecret: '123456',
    issuedAt: '2026-01-01T00:00:00.000Z',
    jurisdiction: 'United States',
    leafHash: `0x${'22'.repeat(32)}`,
    sourceOfFundsHash: `0x${'11'.repeat(32)}`,
    sourceOfFundsReference: 'Wire transfer from UBS, verified 2026-03-01',
    wallet: authorityKey().toBase58(),
  };
}

vi.mock('@solana/wallet-adapter-react', () => ({
  useAnchorWallet: () =>
    mockState.walletConnected
      ? {
          publicKey: authorityKey(),
          signAllTransactions: vi.fn(async (transactions) => transactions),
          signTransaction: vi.fn(async (transaction) => transaction),
        }
      : null,
  useConnection: () => ({ connection: mockState.connection }),
  useWallet: () => ({
    publicKey: mockState.walletConnected ? authorityKey() : null,
    sendTransaction: mockState.walletConnected ? mockState.sendTransaction : undefined,
  }),
}));

vi.mock('../hooks/useCredential', () => ({
  useCredential: () => ({
    clearCredential: mockState.clearCredential,
    credential: mockState.credential,
    saveCredential: mockState.saveCredential,
  }),
}));

vi.mock('../hooks/useRegistryState', () => ({
  useRegistryState: () => ({
    refresh: mockState.refreshRegistry,
  }),
}));

vi.mock('../hooks/useVaultState', () => ({
  useVaultState: () => ({
    data: {
      ...createEmptyVaultState({
        authority: authorityKey(),
        shareMint: authorityKey(),
      }),
      circuitBreakerUsage: 0.42,
      liquidBufferRatio: 0.2,
      regulatorKey: {
        x: Array.from({ length: 32 }, () => 7),
        y: Array.from({ length: 32 }, () => 8),
      },
      sharePrice: 1.15,
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

vi.mock('../hooks/useInstitutionalData', () => ({
  useInstitutionalData: () => ({
    decryptionAuthorizations: [
      {
        address: new PublicKey(new Uint8Array(32).fill(21)),
        authorizedBy: authorityKey(),
        bump: 1,
        reasonHash: Array.from({ length: 32 }, (_, index) => index + 2),
        timestamp: new BN(1_742_000_100),
        transferRecord: new PublicKey(new Uint8Array(32).fill(13)),
      },
    ],
    governanceMembers: [authorityKey().toBase58()],
    governanceProposals: [],
    isLoading: false,
    records: [
      {
        address: new PublicKey(new Uint8Array(32).fill(13)),
        amount: new BN(500),
        decryptionAuthorized: false,
        encryptedMetadata: Array.from({ length: 32 }, (_, index) => index),
        merkleRootSnapshot: Array.from({ length: 32 }, () => 5),
        proofHash: Array.from({ length: 32 }, (_, index) => index + 1),
        signer: authorityKey(),
        timestamp: new BN(1_742_000_000),
        transferType: 'Transfer',
      },
    ],
    refresh: mockState.refreshInstitutionalData,
    usingMockRecords: false,
    vaultState: {
      data: {
        ...createEmptyVaultState({
          authority: authorityKey(),
          paused: true,
          shareMint: authorityKey(),
          totalAssets: new BN(500_000),
          totalYieldEarned: new BN(25_000),
          yieldSource: new PublicKey(new Uint8Array(32).fill(17)),
        }),
        circuitBreakerUsage: 0.42,
        liquidBufferRatio: 0.2,
        regulatorKey: {
          x: Array.from({ length: 32 }, () => 7),
          y: Array.from({ length: 32 }, () => 8),
        },
        sharePrice: 1.15,
        thresholds: {
          retail: new BN(10_000),
          accredited: new BN(100_000),
          institutional: new BN(1_000_000),
          expired: new BN(1_000),
        },
      },
      refresh: mockState.refreshVault,
    },
    yieldMetrics: {
      currentVenue: 'Kamino Prime',
      liquidBufferUsd: 400000,
      yieldRate: 5,
      yieldVenues: [
        {
          accountAddress: new PublicKey(new Uint8Array(32).fill(16)),
          active: true,
          allocationCapBps: 2500,
          connected: true,
          currentAllocationUsd: 125000,
          id: new PublicKey(new Uint8Array(32).fill(16)).toBase58(),
          jurisdiction: 'United States',
          name: 'Kamino Prime',
          riskRating: 'Low',
          venueAddress: new PublicKey(new Uint8Array(32).fill(17)).toBase58(),
        },
      ],
    },
  }),
}));

vi.mock('../lib/program', async () => {
  const actual = await vi.importActual<typeof import('../lib/program')>('../lib/program');
  return {
    ...actual,
    buildAddCredentialTx: mockState.buildAddCredentialTx,
    buildAddYieldVenueTx: mockState.buildAddYieldVenueTx,
    buildAccrueYieldTx: mockState.buildAccrueYieldTx,
    buildAuthorizeDecryptionTx: mockState.buildAuthorizeDecryptionTx,
    buildDepositTx: mockState.buildDepositTx,
    buildUnpauseVaultTx: mockState.buildUnpauseVaultTx,
    buildUpdateRiskLimitsTx: mockState.buildUpdateRiskLimitsTx,
    getPrograms: mockState.getPrograms,
    proofToOnchainFormat: mockState.proofToOnchainFormat,
  };
});

vi.mock('../lib/credential', async () => {
  const actual = await vi.importActual<typeof import('../lib/credential')>('../lib/credential');
  return {
    ...actual,
    hashCredentialLeaf: mockState.hashCredentialLeaf,
    prepareStoredCredential: mockState.prepareStoredCredential,
  };
});

describe('frontend transaction pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.credential = baseCredential();
    mockState.walletConnected = true;
  });

  it('credential issuance validates source of funds as a required field', async () => {
    mockState.credential = null;
    const user = userEvent.setup();
    render(<Credential />);

    await user.type(screen.getByLabelText(/full name/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'United States');
    await user.type(screen.getByLabelText(/investor wallet address/i), authorityKey().toBase58());
    await user.click(screen.getByRole('button', { name: /issue credential/i }));

    expect(await screen.findByText(/source of funds are required/i)).toBeInTheDocument();
    expect(mockState.hashCredentialLeaf).not.toHaveBeenCalled();
  });

  it('deposit builds and submits the deposit transaction after proof generation', async () => {
    const user = userEvent.setup();
    render(<Deposit />);

    await user.click(screen.getByRole('button', { name: /generate proof and deposit/i }));

    await waitFor(() => expect(mockState.proofGenerate).toHaveBeenCalled());
    await waitFor(() => expect(mockState.proofToOnchainFormat).toHaveBeenCalled());
    await waitFor(() => expect(mockState.buildDepositTx).toHaveBeenCalled());
    await waitFor(() => expect(mockState.sendTransaction).toHaveBeenCalled());
  });

  it('compliance detail requests transfer record decryption', async () => {
    const user = userEvent.setup();
    const record = new PublicKey(new Uint8Array(32).fill(13)).toBase58();

    render(
      <MemoryRouter initialEntries={[`/developer/compliance/${record}`]}>
        <Routes>
          <Route path="/developer/compliance/:id" element={<ComplianceDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /request decryption/i }));

    await waitFor(() => expect(mockState.buildAuthorizeDecryptionTx).toHaveBeenCalled());
    await waitFor(() => expect(mockState.sendTransaction).toHaveBeenCalled());
  });

  it('operator risk submits a live risk-limit update', async () => {
    const user = userEvent.setup();
    render(<OperatorRisk />);

    await user.clear(screen.getByLabelText(/circuit breaker threshold/i));
    await user.type(screen.getByLabelText(/circuit breaker threshold/i), '600000');
    await user.click(screen.getByRole('button', { name: /update risk limits/i }));

    await waitFor(() => expect(mockState.buildUpdateRiskLimitsTx).toHaveBeenCalled());
    await waitFor(() => expect(mockState.sendTransaction).toHaveBeenCalled());
    expect(mockState.refreshVault).toHaveBeenCalled();
  });

  it('operator yield submits venue creation and yield accrual transactions', async () => {
    const user = userEvent.setup();
    render(<OperatorYield />);

    await user.type(screen.getByLabelText(/venue address/i), new PublicKey(new Uint8Array(32).fill(18)).toBase58());
    await user.type(screen.getByLabelText(/venue name/i), 'Maple Prime');
    await user.type(screen.getByLabelText(/jurisdiction/i), 'United States');
    await user.clear(screen.getByLabelText(/allocation cap/i));
    await user.type(screen.getByLabelText(/allocation cap/i), '1800');
    await user.click(screen.getByRole('button', { name: /add venue/i }));

    await waitFor(() => expect(mockState.buildAddYieldVenueTx).toHaveBeenCalled());
    await waitFor(() => expect(mockState.sendTransaction).toHaveBeenCalled());

    await user.clear(screen.getByLabelText(/yield amount/i));
    await user.type(screen.getByLabelText(/yield amount/i), '5000');
    await user.click(screen.getByRole('button', { name: /accrue yield/i }));

    await waitFor(() => expect(mockState.buildAccrueYieldTx).toHaveBeenCalled());
    expect(mockState.refreshInstitutionalData).toHaveBeenCalled();
  });

  it('operator governance authorizes transfer-record decryption', async () => {
    const user = userEvent.setup();
    render(<OperatorGovernance />);

    await user.click(screen.getByRole('button', { name: /authorize decryption/i }));

    await waitFor(() => expect(mockState.buildAuthorizeDecryptionTx).toHaveBeenCalled());
    await waitFor(() => expect(mockState.sendTransaction).toHaveBeenCalled());
    expect(mockState.refreshInstitutionalData).toHaveBeenCalled();
  });

  it('operator pages block actions until a wallet is connected', async () => {
    mockState.walletConnected = false;
    render(<OperatorRisk />);

    expect(screen.getAllByText(/connect wallet to manage vault/i)).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: /update risk limits/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /unpause vault/i })).toBeDisabled();
  });
});
