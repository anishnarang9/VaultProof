import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PublicKey } from '@solana/web3.js';
import { AppShell } from '../App';
import { createEmptyVaultState } from '../lib/types';

const mockState = vi.hoisted(() => ({
  authorityBytes: Array.from({ length: 32 }, () => 9),
  current: 'guest' as 'authority' | 'guest' | 'investor',
  investorBytes: Array.from({ length: 32 }, () => 7),
}));

function authorityKey() {
  return new PublicKey(Uint8Array.from(mockState.authorityBytes));
}

function currentWalletKey() {
  if (mockState.current === 'guest') {
    return null;
  }

  return new PublicKey(
    Uint8Array.from(mockState.current === 'authority' ? mockState.authorityBytes : mockState.investorBytes),
  );
}

vi.mock('@solana/wallet-adapter-react-ui', () => ({
  WalletModalProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  WalletMultiButton: () => <button type="button">Connect Wallet</button>,
}));

vi.mock('@solana/wallet-adapter-react', () => ({
  useAnchorWallet: () => null,
  useConnection: () => ({ connection: { confirmTransaction: vi.fn() } }),
  useWallet: () => ({
    publicKey: currentWalletKey(),
    sendTransaction: vi.fn(),
  }),
}));

vi.mock('../hooks/useVaultState', () => ({
  useVaultState: () => ({
    data: {
      ...createEmptyVaultState({
        authority: authorityKey(),
      }),
      circuitBreakerUsage: 0.42,
      liquidBufferRatio: 0.2,
      regulatorKey: { x: [], y: [] },
      sharePrice: 1.08,
      thresholds: {
        accredited: { toString: () => '1000000' },
        expired: { toString: () => '10000' },
        institutional: { toString: () => '5000000' },
        retail: { toString: () => '100000' },
      },
    },
    refresh: vi.fn(),
  }),
}));

vi.mock('../hooks/useRegistryState', () => ({
  useRegistryState: () => ({
    data: {
      activeCredentials: 18,
      stateTree: { depth: 20 },
    },
  }),
}));

vi.mock('../hooks/useTransferRecords', () => ({
  useTransferRecords: () => ({
    records: [],
    totalCount: 12,
  }),
}));

vi.mock('../hooks/useInstitutionalData', () => ({
  useInstitutionalData: () => ({
    depositHistory: [],
    governanceMembers: [],
    governanceProposals: [],
    portfolio: {
      proportionalClaimUsd: 0,
      shareBalance: 0,
      yieldEarned: 0,
    },
    records: [],
    registryHealth: {
      activeCredentials: 18,
      capacityUtilization: 0.2,
      revokedCredentials: 1,
      treeCapacity: 1024,
    },
    sharePriceHistory: [
      { amount: 10, inflow: 10, label: 'Jan 1', outflow: 0, sharePrice: 1.02 },
      { amount: 20, inflow: 0, label: 'Jan 2', outflow: 20, sharePrice: 1.04 },
    ],
    trackMapping: [
      {
        feature: 'Proof-gated deposits',
        requirement: 'Automated vault management',
        status: 'Live',
      },
    ],
    usingMockRecords: false,
    vaultState: {
      data: {
        ...createEmptyVaultState({
          authority: authorityKey(),
        }),
        circuitBreakerUsage: 0.42,
        liquidBufferRatio: 0.2,
        sharePrice: 1.08,
      },
    },
    yieldMetrics: {
      currentVenue: 'Kamino',
      liquidBufferUsd: 100000,
      yieldRate: 4.2,
      yieldVenues: [],
    },
  }),
}));

vi.mock('../hooks/useMonitoring', () => ({
  useMonitoring: () => ({
    alerts: [],
    records: [],
    vault: createEmptyVaultState(),
  }),
}));

describe('role routing and landing page', () => {
  it('renders the landing page at root', () => {
    mockState.current = 'guest';

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', {
        name: /compliant infrastructure for institutional digital assets/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /developer console/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /investor portal/i }).length).toBeGreaterThan(0);
  });

  it('renders the developer console at /developer', () => {
    mockState.current = 'authority';

    render(
      <MemoryRouter initialEntries={['/developer']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByText(/developer console/i)).toBeInTheDocument();
    expect(screen.getByText(/daily outflow threshold/i)).toBeInTheDocument();
  });

  it('renders the investor portal at /investor', () => {
    mockState.current = 'investor';

    render(
      <MemoryRouter initialEntries={['/investor']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByText(/investor portal/i)).toBeInTheDocument();
    expect(screen.getByText(/your shares/i)).toBeInTheDocument();
  });
});
