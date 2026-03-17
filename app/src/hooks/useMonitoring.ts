import { useMemo } from 'react';
import { useTransferRecords } from './useTransferRecords';
import { useVaultState } from './useVaultState';
import type { MonitoringAlert } from '../lib/types';

function toNumber(value: { toString(): string } | number | bigint) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  return Number(value.toString());
}

export function useMonitoring() {
  const { data: vault } = useVaultState();
  const { records } = useTransferRecords();

  const alerts = useMemo<MonitoringAlert[]>(() => {
    const nextAlerts: MonitoringAlert[] = [];
    const circuitBreakerThreshold = toNumber(vault.circuitBreakerThreshold);
    const dailyOutflowTotal = toNumber(vault.dailyOutflowTotal);

    if (circuitBreakerThreshold > 0) {
      const cbUsage = dailyOutflowTotal / circuitBreakerThreshold;

      if (cbUsage > 0.95) {
        nextAlerts.push({
          severity: 'critical',
          message: `Circuit breaker at ${(cbUsage * 100).toFixed(0)}% capacity`,
        });
      } else if (cbUsage > 0.8) {
        nextAlerts.push({
          severity: 'warning',
          message: `Circuit breaker at ${(cbUsage * 100).toFixed(0)}% capacity`,
        });
      }
    }

    const recentRecords = records.filter(
      (record) => Date.now() / 1000 - Number(record.timestamp.toString()) < 86_400,
    );
    const totalAssets = toNumber(vault.totalAssets);
    const maxTransaction = recentRecords.reduce(
      (current, record) => Math.max(current, toNumber(record.amount)),
      0,
    );

    if (totalAssets > 0 && maxTransaction > totalAssets * 0.1) {
      nextAlerts.push({
        severity: 'warning',
        message: `Large transaction detected: $${Math.round(maxTransaction).toLocaleString('en-US')}`,
      });
    }

    if (
      vault.maxDailyTransactions > 0 &&
      recentRecords.length > Math.max(1, vault.maxDailyTransactions * 0.8)
    ) {
      nextAlerts.push({
        severity: 'info',
        message: 'High transaction velocity across the last 24 hours',
      });
    }

    if (vault.paused) {
      nextAlerts.push({
        severity: 'critical',
        message: 'Vault is currently paused pending operator review',
      });
    }

    return nextAlerts;
  }, [records, vault]);

  return { vault, records, alerts };
}
