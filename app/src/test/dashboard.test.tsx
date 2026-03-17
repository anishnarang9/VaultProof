import { render, screen } from '@testing-library/react';
import { BN } from '@coral-xyz/anchor';
import Dashboard from '../pages/Dashboard';
import { createEmptyVaultState } from '../lib/types';

vi.mock('../hooks/useInstitutionalData', () => ({
  useInstitutionalData: () => ({
    records: [],
    registryHealth: {
      activeCredentials: 12,
      capacityUtilization: 1.2,
      revokedCredentials: 1,
      treeCapacity: 1024,
    },
    sharePriceHistory: [
      { amount: 10, inflow: 10, label: 'Jan 1', outflow: 0, sharePrice: 1.01 },
      { amount: 20, inflow: 0, label: 'Jan 2', outflow: 20, sharePrice: 1.03 },
    ],
    usingMockRecords: false,
    vaultState: {
      data: {
        ...createEmptyVaultState({
          circuitBreakerThreshold: new BN(100_000),
          dailyOutflowTotal: new BN(82_000),
          totalAssets: new BN(750_000),
        }),
        circuitBreakerUsage: 0.82,
        liquidBufferRatio: 0.2,
        regulatorKey: { x: [], y: [] },
        sharePrice: 1.03,
        thresholds: {
          accredited: new BN(1),
          expired: new BN(1),
          institutional: new BN(1),
          retail: new BN(1),
        },
      },
    },
    yieldMetrics: {
      currentVenue: 'Kamino',
      liquidBufferUsd: 200000,
      yieldRate: 4.2,
      yieldVenues: [],
    },
  }),
}));

vi.mock('../hooks/useMonitoring', () => ({
  useMonitoring: () => ({
    alerts: [],
  }),
}));

describe('Dashboard', () => {
  it('displays the circuit breaker percentage and warning color', () => {
    render(<Dashboard />);

    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByTestId('circuit-breaker-bar')).toHaveClass('bg-warning');
  });
});
