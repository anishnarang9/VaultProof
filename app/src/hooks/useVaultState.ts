import { useCallback, useEffect, useState } from 'react';
import { defaultReadClient } from '../lib/readClient';
import { createEmptyVaultState, type VaultProofReadClient, type VaultStateView } from '../lib/types';

function createVaultView(): VaultStateView {
  const base = createEmptyVaultState();

  return {
    ...base,
    circuitBreakerUsage: 0,
    liquidBufferRatio: base.liquidBufferBps / 10_000,
    sharePrice: 0,
    regulatorKey: {
      x: base.regulatorPubkeyX,
      y: base.regulatorPubkeyY,
    },
    thresholds: {
      retail: base.amlThresholds[0],
      accredited: base.amlThresholds[1],
      institutional: base.amlThresholds[2],
      expired: base.expiredThreshold,
    },
  };
}

function decorateVaultState(next: ReturnType<typeof createEmptyVaultState>): VaultStateView {
  const denominator = next.sharePriceDenominator.toNumber();
  const numerator = next.sharePriceNumerator.toNumber();
  const circuitBreakerThreshold = next.circuitBreakerThreshold.toNumber();

  return {
    ...next,
    circuitBreakerUsage:
      circuitBreakerThreshold > 0 ? next.dailyOutflowTotal.toNumber() / circuitBreakerThreshold : 0,
    liquidBufferRatio: next.liquidBufferBps / 10_000,
    sharePrice: denominator > 0 ? numerator / denominator : 0,
    regulatorKey: {
      x: next.regulatorPubkeyX,
      y: next.regulatorPubkeyY,
    },
    thresholds: {
      retail: next.amlThresholds[0],
      accredited: next.amlThresholds[1],
      institutional: next.amlThresholds[2],
      expired: next.expiredThreshold,
    },
  };
}

export function useVaultState(client: VaultProofReadClient = defaultReadClient) {
  const [data, setData] = useState<VaultStateView>(() => createVaultView());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const next = await client.fetchVaultState();
      setData(decorateVaultState(next));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to load vault state.');
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, isLoading, refresh };
}
