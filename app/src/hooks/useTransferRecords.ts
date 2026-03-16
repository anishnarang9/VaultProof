import { BN } from '@coral-xyz/anchor';
import { useCallback, useEffect, useState } from 'react';
import { defaultReadClient } from '../lib/readClient';
import { TransferType, type TransferRecordWithAddress, type VaultProofReadClient } from '../lib/types';

export function useTransferRecords(client: VaultProofReadClient = defaultReadClient) {
  const [records, setRecords] = useState<TransferRecordWithAddress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const next = await client.fetchTransferRecords();
      setRecords(next);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to load transfer records.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totalVolume = records.reduce((sum, record) => sum.add(record.amount), new BN(0));
  const filterByType = (type: TransferType) =>
    records.filter((record) => record.transferType === type);

  return {
    records,
    totalCount: records.length,
    totalVolume,
    filterByType,
    error,
    isLoading,
    refresh,
  };
}
