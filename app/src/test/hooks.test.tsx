import { BN } from '@coral-xyz/anchor';
import { renderHook, waitFor } from '@testing-library/react';
import { PublicKey } from '@solana/web3.js';
import { useVaultState } from '../hooks/useVaultState';
import {
  createEmptyKycRegistry,
  createEmptyStateTree,
  createEmptyTransferRecord,
  createEmptyVaultState,
  type TransferRecordWithAddress,
  type VaultProofReadClient,
} from '../lib/types';

const DEFAULT_KEY = new PublicKey('11111111111111111111111111111111');

const mockClient: VaultProofReadClient = {
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
});
