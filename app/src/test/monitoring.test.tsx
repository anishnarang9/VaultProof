import { BN } from '@coral-xyz/anchor';
import { renderHook } from '@testing-library/react';
import { PublicKey } from '@solana/web3.js';
import { useMonitoring } from '../hooks/useMonitoring';
import { TransferType, createEmptyTransferRecord, createEmptyVaultState } from '../lib/types';

const mockState = vi.hoisted(() => ({
  amount: 150_000,
  circuitBreakerThreshold: 100_000,
  dailyOutflowTotal: 90_000,
  timestamp: Math.floor(Date.now() / 1000) - 3600,
  totalAssets: 500_000,
}));

vi.mock('../hooks/useVaultState', () => ({
  useVaultState: () => ({
    data: {
      ...createEmptyVaultState({
        circuitBreakerThreshold: new BN(mockState.circuitBreakerThreshold),
        dailyOutflowTotal: new BN(mockState.dailyOutflowTotal),
        maxDailyTransactions: 1,
        totalAssets: new BN(mockState.totalAssets),
      }),
      circuitBreakerUsage: 0.9,
      liquidBufferRatio: 0.2,
      paused: false,
      regulatorKey: { x: [], y: [] },
      sharePrice: 1.01,
      thresholds: {
        accredited: new BN(1),
        expired: new BN(1),
        institutional: new BN(1),
        retail: new BN(1),
      },
    },
  }),
}));

vi.mock('../hooks/useTransferRecords', () => ({
  useTransferRecords: () => ({
    records: [
      {
        ...createEmptyTransferRecord({
          amount: new BN(mockState.amount),
          timestamp: new BN(mockState.timestamp),
          transferType: TransferType.Withdrawal,
        }),
        address: new PublicKey('11111111111111111111111111111111'),
      },
    ],
  }),
}));

describe('useMonitoring', () => {
  it('computes circuit-breaker and large-transaction alerts', () => {
    const { result } = renderHook(() => useMonitoring());

    expect(result.current.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/circuit breaker at 90% capacity/i),
          severity: 'warning',
        }),
        expect.objectContaining({
          message: expect.stringMatching(/large transaction detected/i),
          severity: 'warning',
        }),
      ]),
    );
  });
});
