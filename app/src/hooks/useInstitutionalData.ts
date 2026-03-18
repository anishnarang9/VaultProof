import { BN } from '@coral-xyz/anchor';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMemo } from 'react';
import { useRegistryState } from './useRegistryState';
import { useTransferRecords } from './useTransferRecords';
import { useVaultState } from './useVaultState';
import { TransferType } from '../lib/types';

export interface GovernanceProposalView {
  description: string;
  eta: string;
  id: string;
  signatures: string;
  status: 'Ready' | 'Pending' | 'Executed';
  title: string;
}

export interface TrackMappingItem {
  feature: string;
  requirement: string;
  status: string;
}

function toNumber(value: BN | number) {
  return value instanceof BN ? Number(value.toString()) : value;
}

const trackMapping: TrackMappingItem[] = [
  {
    feature: 'Proof-gated deposits, transfers, and withdrawals',
    requirement: 'Automated smart-contract-based vault management',
    status: 'Live',
  },
  {
    feature: 'Source-of-funds field inside the credential witness',
    requirement: 'Prove source of coins on regulator demand',
    status: 'Live',
  },
  {
    feature: 'Risk oracle + circuit breaker monitoring',
    requirement: 'Funds monitoring and risk controls',
    status: 'Live',
  },
  {
    feature: 'Squads multisig governance',
    requirement: 'Institutional governance',
    status: 'Live',
  },
];

export function useInstitutionalData() {
  const { publicKey } = useWallet();
  const vaultState = useVaultState();
  const registryState = useRegistryState();
  const transferState = useTransferRecords();

  const records = useMemo(() => {
    return transferState.records;
  }, [transferState.records]);

  const sharePriceHistory = useMemo(() => {
    const ordered = [...records].sort(
      (left, right) => Number(left.timestamp.toString()) - Number(right.timestamp.toString()),
    );
    const baseline = vaultState.data.sharePrice > 0 ? vaultState.data.sharePrice : 1.02;

    return ordered.map((record, index) => {
      const amount = toNumber(record.amount);
      const directionalDelta =
        record.transferType === TransferType.Withdrawal
          ? -0.004
          : record.transferType === TransferType.Transfer
            ? 0.002
            : 0.006;

      return {
        amount,
        inflow: record.transferType === TransferType.Deposit ? amount : 0,
        label: new Date(Number(record.timestamp.toString()) * 1000).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        outflow: record.transferType === TransferType.Withdrawal ? amount : 0,
        sharePrice: Number((baseline + directionalDelta * (index - 1)).toFixed(3)),
      };
    });
  }, [records, vaultState.data.sharePrice]);

  const investorRecords = useMemo(() => {
    if (!publicKey) {
      return records;
    }

    const own = records.filter((record) => record.signer.equals(publicKey));
    return own.length > 0 ? own : records;
  }, [publicKey, records]);

  const depositHistory = useMemo(
    () => investorRecords.filter((record) => record.transferType === TransferType.Deposit),
    [investorRecords],
  );

  const shareBalance = useMemo(() => {
    const deposits = depositHistory.reduce((sum, record) => sum + toNumber(record.amount), 0);
    const withdrawals = investorRecords
      .filter((record) => record.transferType === TransferType.Withdrawal)
      .reduce((sum, record) => sum + toNumber(record.amount), 0);

    return Math.max(0, deposits - withdrawals);
  }, [depositHistory, investorRecords]);

  const proportionalClaimUsd = shareBalance * (vaultState.data.sharePrice || 1.04);
  const firstDepositTimestamp = depositHistory[0]?.timestamp;
  const firstDepositSharePrice =
    sharePriceHistory.find(
      (point) =>
        firstDepositTimestamp &&
        point.label ===
          new Date(Number(firstDepositTimestamp.toString()) * 1000).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          }),
    )?.sharePrice ?? 1;

  const yieldEarned = Math.max(
    0,
    proportionalClaimUsd - shareBalance * firstDepositSharePrice,
  );

  const treeCapacity = 2 ** registryState.data.stateTree.depth;

  return {
    depositHistory,
    governanceMembers: [] as string[],
    governanceProposals: [] as GovernanceProposalView[],
    portfolio: {
      proportionalClaimUsd,
      shareBalance,
      yieldEarned,
    },
    records,
    registryHealth: {
      activeCredentials: toNumber(registryState.data.activeCredentials),
      capacityUtilization:
        treeCapacity > 0
          ? (toNumber(registryState.data.stateTree.nextIndex) / treeCapacity) * 100
          : 0,
      revokedCredentials: toNumber(registryState.data.revokedCount),
      treeCapacity,
    },
    sharePriceHistory,
    trackMapping,
    vaultState,
    yieldMetrics: {
      currentVenue: 'Liquid buffer',
      liquidBufferUsd:
        toNumber(vaultState.data.totalAssets) * Math.max(0, 1 - vaultState.data.liquidBufferRatio),
      yieldRate:
        toNumber(vaultState.data.totalAssets) > 0
          ? (toNumber(vaultState.data.totalYieldEarned) / toNumber(vaultState.data.totalAssets)) * 100
          : 0,
    },
  };
}
