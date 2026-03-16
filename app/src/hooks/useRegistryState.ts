import { useCallback, useEffect, useState } from 'react';
import { BN } from '@coral-xyz/anchor';
import { defaultReadClient } from '../lib/readClient';
import {
  createEmptyKycRegistry,
  createEmptyStateTree,
  type RegistryStateView,
  type VaultProofReadClient,
} from '../lib/types';
import { bytesToHex } from '../lib/format';

function createRegistryView(): RegistryStateView {
  return {
    registry: createEmptyKycRegistry(),
    stateTree: createEmptyStateTree(),
    credentialCount: new BN(0),
    revokedCount: new BN(0),
    activeCredentials: new BN(0),
    merkleRoot: Array.from({ length: 32 }, () => 0),
    merkleRootHex: '0x',
  };
}

function decorateRegistryState(
  registry: ReturnType<typeof createEmptyKycRegistry>,
  stateTree: ReturnType<typeof createEmptyStateTree>,
): RegistryStateView {
  const activeCredentials = registry.credentialCount.sub(registry.revokedCount);

  return {
    registry,
    stateTree,
    credentialCount: registry.credentialCount,
    revokedCount: registry.revokedCount,
    activeCredentials: activeCredentials.isNeg() ? new BN(0) : activeCredentials,
    merkleRoot: stateTree.root,
    merkleRootHex: bytesToHex(stateTree.root),
  };
}

export function useRegistryState(client: VaultProofReadClient = defaultReadClient) {
  const [data, setData] = useState<RegistryStateView>(() => createRegistryView());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [registry, stateTree] = await Promise.all([
        client.fetchKycRegistry(),
        client.fetchStateTree(),
      ]);
      setData(decorateRegistryState(registry, stateTree));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to load registry state.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, isLoading, refresh };
}
