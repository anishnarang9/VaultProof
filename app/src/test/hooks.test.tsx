import { BN } from '@coral-xyz/anchor';
import { renderHook, waitFor } from '@testing-library/react';
import { PublicKey } from '@solana/web3.js';
import { useInstitutionalData } from '../hooks/useInstitutionalData';
import { useVaultState } from '../hooks/useVaultState';
import {
  createEmptyDecryptionAuthorization,
  createEmptyKycRegistry,
  createEmptyStateTree,
  createEmptyTransferRecord,
  createEmptyVaultState,
  createEmptyWhitelistedYieldVenue,
  type TransferRecordWithAddress,
  type VaultProofReadClient,
} from '../lib/types';

const DEFAULT_KEY = new PublicKey('11111111111111111111111111111111');
const AUTHORITY_KEY = new PublicKey('DzGXeLhKHH81BKSLnQ82FWbmxyPezd7FUgLGDvSkzPge');
const VENUE_KEY = new PublicKey('9xQeWvG816bUx9EPfEZELDq8Pjyo4LQm4iAfDdcQa1r1');
const YIELD_VENUE_ACCOUNT = new PublicKey('6czJ9VfK2vNhbbX6YsJhBKt3vnDnNQfXDSBxPTsCkXbk');

vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => ({
    publicKey: null,
  }),
}));

const mockClient: VaultProofReadClient = {
  fetchDecryptionAuthorizations: async () => [],
  fetchCredentialLeaves: async () => [],
  fetchKycRegistry: async () => createEmptyKycRegistry(),
  fetchStateTree: async () => createEmptyStateTree(),
  fetchTransferRecords: async (): Promise<TransferRecordWithAddress[]> => [
    {
      ...createEmptyTransferRecord({
        amount: new BN(125_000),
      }),
      address: DEFAULT_KEY,
    },
  ],
  fetchYieldVenues: async () => [],
  fetchVaultState: async () =>
    createEmptyVaultState({
      amlThresholds: [new BN(100_000), new BN(1_000_000), new BN(9_999_999)],
      authority: DEFAULT_KEY,
      circuitBreakerThreshold: new BN(500_000),
      dailyOutflowTotal: new BN(210_000),
      maxDailyTransactions: 40,
      regulatorPubkeyX: Array.from({ length: 32 }, () => 1),
      regulatorPubkeyY: Array.from({ length: 32 }, () => 2),
      sharePriceDenominator: new BN(400_000),
      sharePriceNumerator: new BN(420_000),
      shareMint: DEFAULT_KEY,
      totalAssets: new BN(420_000),
      totalShares: new BN(400_000),
    }),
};

function createClient(overrides: Partial<VaultProofReadClient> = {}): VaultProofReadClient {
  return {
    ...mockClient,
    ...overrides,
  };
}

describe('frontend hooks', () => {
  it('useVaultState returns the institutional data structure', async () => {
    const { result } = renderHook(() => useVaultState(mockClient));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data.totalAssets.toString()).toBe('420000');
    expect(result.current.data.totalShares.toString()).toBe('400000');
    expect(result.current.data.sharePrice).toBe(1.05);
    expect(result.current.data.circuitBreakerUsage).toBe(0.42);
    expect(result.current.data.thresholds.retail.toString()).toBe('100000');
  });

  it('useInstitutionalData keeps empty record sets empty and surfaces live yield venues', async () => {
    const client = createClient({
      fetchDecryptionAuthorizations: async () => [
        createEmptyDecryptionAuthorization({
          address: new PublicKey('5hT5fQ8s2raekkUQun7qY5T2r8j6YfGLmRoTSesFiNUU'),
          authorizedBy: AUTHORITY_KEY,
          timestamp: new BN(1_742_000_000),
          transferRecord: DEFAULT_KEY,
        }),
      ],
      fetchTransferRecords: async () => [],
      fetchVaultState: async () =>
        createEmptyVaultState({
          authority: AUTHORITY_KEY,
          sharePriceDenominator: new BN(100),
          sharePriceNumerator: new BN(105),
          totalAssets: new BN(1_000_000),
          totalYieldEarned: new BN(50_000),
          yieldSource: VENUE_KEY,
        }),
      fetchYieldVenues: async () => [
        createEmptyWhitelistedYieldVenue({
          active: true,
          address: YIELD_VENUE_ACCOUNT,
          allocationCapBps: 2_500,
          jurisdictionWhitelist: Array.from(
            new TextEncoder().encode('United States'.padEnd(32, '\0')),
          ),
          name: 'Kamino Prime',
          riskRating: 2,
          venueAddress: VENUE_KEY,
        }),
      ],
    });

    const { result } = renderHook(() => useInstitutionalData(client));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.records).toEqual([]);
    expect(result.current.sharePriceHistory).toEqual([]);
    expect(result.current.usingMockRecords).toBe(false);
    expect(result.current.governanceMembers).toEqual([AUTHORITY_KEY.toBase58()]);
    expect(result.current.yieldMetrics.currentVenue).toBe('Kamino Prime');
    expect(result.current.yieldMetrics.yieldVenues).toEqual([
      expect.objectContaining({
        allocationCapBps: 2_500,
        id: YIELD_VENUE_ACCOUNT.toBase58(),
        name: 'Kamino Prime',
        riskRating: 'Low',
        venueAddress: VENUE_KEY.toBase58(),
      }),
    ]);
  });
});
