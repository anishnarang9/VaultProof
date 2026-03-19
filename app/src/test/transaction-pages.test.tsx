import { BN } from '@coral-xyz/anchor';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PublicKey } from '@solana/web3.js';
import ComplianceDetail from '../pages/ComplianceDetail';
import Credential from '../pages/Credential';
import Deposit from '../pages/Deposit';
import { createEmptyVaultState } from '../lib/types';

const mockState = vi.hoisted(() => ({
  authorityBytes: Array.from({ length: 32 }, () => 6),
  buildAddCredentialTx: vi.fn(async () => ({ instructions: [] })),
  buildAuthorizeDecryptionTx: vi.fn(async () => ({ instructions: [] })),
  buildDepositTx: vi.fn(async () => ({ storeProofTx: { instructions: [] }, depositTx: { instructions: [] } })),
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
  saveCredential: vi.fn(),
  sendTransaction: vi.fn(async () => '5ignature111111111111111111111111111111111111'),
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
  useAnchorWallet: () => ({
    publicKey: authorityKey(),
    signAllTransactions: vi.fn(async (transactions) => transactions),
    signTransaction: vi.fn(async (transaction) => transaction),
  }),
  useConnection: () => ({ connection: mockState.connection }),
  useWallet: () => ({
    connected: true,
    disconnect: vi.fn(),
    publicKey: authorityKey(),
    sendTransaction: mockState.sendTransaction,
    wallet: { adapter: { name: 'Phantom', icon: 'https://phantom.app/icon.png' } },
  }),
}));

vi.mock('@solana/wallet-adapter-react-ui', () => ({
  useWalletModal: () => ({ setVisible: vi.fn() }),
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
    prepareStoredCredential: mockState.prepareStoredCredential,
  };
});

vi.mock('circomlibjs', () => {
  const mockPoseidon = Object.assign(
    (inputs: bigint[]) => inputs.reduce((a, b) => a ^ b, 0n),
    { F: { toString: (v: bigint) => String(v) } },
  );
  return {
    buildPoseidon: vi.fn(async () => mockPoseidon),
  };
});

describe('frontend transaction pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.credential = baseCredential();
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

  it('deposit wizard navigates through all steps and submits', async () => {
    const user = userEvent.setup();
    render(<Deposit />);

    // Step 1: Full Name
    expect(screen.getByRole('heading', { name: /full legal name/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/full legal name/i), 'Jane Doe');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2: Date of Birth (fireEvent for type=date in jsdom)
    expect(screen.getByRole('heading', { name: /date of birth/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '1990-01-01' } });
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 3: Country
    expect(screen.getByRole('heading', { name: /country of residence/i })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/country of residence/i), 'US');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 4: Identity Number (US → Last 4 SSN)
    expect(screen.getByRole('heading', { name: /identity verification/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/last 4 digits of ssn/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/last 4 digits of ssn/i), '1234');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 5: Document Upload (optional, skip)
    expect(screen.getByRole('heading', { name: /document upload/i })).toBeInTheDocument();
    expect(screen.getByText(/ai verification coming soon/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 6: Accreditation
    expect(screen.getByRole('heading', { name: /investor accreditation/i })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/investor accreditation tier/i), 'institutional');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 7: Source of Funds
    expect(screen.getByRole('heading', { name: /source of funds/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/source of funds reference/i), 'Wire transfer from UBS');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 8: Amount
    expect(screen.getByRole('heading', { name: /deposit amount/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/deposit amount/i), '25000');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 9: Connect Wallet
    expect(screen.getByRole('heading', { name: /connect wallet/i })).toBeInTheDocument();
    expect(screen.getByText(/wallet connected/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 10: Review
    expect(screen.getByRole('heading', { name: /review & confirm/i })).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText(/25,000 USDC/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /proceed to proof/i }));

    // Step 11: Proof & Submit
    expect(screen.getByRole('heading', { name: /generate proof & submit/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /generate proof & deposit/i }));

    await waitFor(() => expect(mockState.proofGenerate).toHaveBeenCalled());
    await waitFor(() => expect(mockState.proofToOnchainFormat).toHaveBeenCalled());
    await waitFor(() => expect(mockState.buildDepositTx).toHaveBeenCalled());
    await waitFor(() => expect(mockState.sendTransaction).toHaveBeenCalled());
  });

  it('deposit wizard shows country-conditional ID labels', async () => {
    const user = userEvent.setup();
    render(<Deposit />);

    // Fill name and DOB to get to country step
    await user.type(screen.getByLabelText(/full legal name/i), 'Test User');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '1995-06-15' } });
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Select UK
    await user.selectOptions(screen.getByLabelText(/country of residence/i), 'GB');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Should show NIN label
    expect(screen.getByLabelText(/national insurance number/i)).toBeInTheDocument();

    // Go back and switch to Germany
    await user.click(screen.getByRole('button', { name: /back/i }));
    await user.selectOptions(screen.getByLabelText(/country of residence/i), 'DE');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Should show National ID label
    expect(screen.getByLabelText(/national id number/i)).toBeInTheDocument();
  });

  it('deposit wizard back button preserves entered data', async () => {
    const user = userEvent.setup();
    render(<Deposit />);

    // Fill name
    await user.type(screen.getByLabelText(/full legal name/i), 'Jane Doe');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Go to DOB step then back
    await user.click(screen.getByRole('button', { name: /back/i }));

    // Name should still be there
    expect(screen.getByLabelText(/full legal name/i)).toHaveValue('Jane Doe');
  });

  it('compliance detail requests transfer record decryption', async () => {
    const user = userEvent.setup();
    const record = new PublicKey(new Uint8Array(32).fill(13)).toBase58();

    render(
      <MemoryRouter initialEntries={[`/institution/compliance/${record}`]}>
        <Routes>
          <Route path="/institution/compliance/:id" element={<ComplianceDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /request decryption/i }));

    await waitFor(() => expect(mockState.buildAuthorizeDecryptionTx).toHaveBeenCalled());
    await waitFor(() => expect(mockState.sendTransaction).toHaveBeenCalled());
  });
});
