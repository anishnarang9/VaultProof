import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMemo } from 'react';
import { useRegistryState } from './useRegistryState';
import { useTransferRecords } from './useTransferRecords';
import { useVaultState } from './useVaultState';
import { TransferType, createEmptyTransferRecord, type TransferRecordWithAddress } from '../lib/types';

export interface YieldVenueView {
  active: boolean;
  allocationCapBps: number;
  connected: boolean;
  currentAllocationUsd: number;
  id: string;
  jurisdiction: string;
  name: string;
  riskRating: 'Low' | 'Moderate' | 'Elevated';
}

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

function createKey(seed: number) {
  const bytes = new Uint8Array(32).fill(seed);
  bytes[0] = seed || 1;
  return new PublicKey(bytes);
}

function toNumber(value: BN | number) {
  return value instanceof BN ? Number(value.toString()) : value;
}

function createMockRecords(investor?: PublicKey): TransferRecordWithAddress[] {
  const investorKey = investor ?? createKey(24);
  const now = Math.floor(Date.now() / 1000);
  const entries = [
    {
      address: createKey(40),
      amount: new BN(180_000),
      decryptionAuthorized: true,
      encryptedMetadata: Array.from({ length: 16 }, (_, index) => index + 1),
      proofHash: Array.from({ length: 32 }, (_, index) => (index * 3) % 255),
      signer: investorKey,
      timestamp: new BN(now - 86_400 * 12),
      transferType: TransferType.Deposit,
    },
    {
      address: createKey(41),
      amount: new BN(45_000),
      decryptionAuthorized: false,
      encryptedMetadata: Array.from({ length: 16 }, (_, index) => (index * 5) % 255),
      proofHash: Array.from({ length: 32 }, (_, index) => (index * 7) % 255),
      signer: investorKey,
      timestamp: new BN(now - 86_400 * 8),
      transferType: TransferType.Transfer,
    },
    {
      address: createKey(42),
      amount: new BN(28_000),
      decryptionAuthorized: false,
      encryptedMetadata: Array.from({ length: 16 }, (_, index) => (index * 9) % 255),
      proofHash: Array.from({ length: 32 }, (_, index) => (index * 11) % 255),
      signer: investorKey,
      timestamp: new BN(now - 86_400 * 3),
      transferType: TransferType.Withdrawal,
    },
  ];

  return entries.map((entry) => ({
    ...createEmptyTransferRecord(entry),
    address: entry.address,
  }));
}

const defaultGovernanceMembers = [createKey(9), createKey(10), createKey(11)].map((key) =>
  key.toBase58(),
);

const defaultYieldVenues: YieldVenueView[] = [
  {
    active: true,
    allocationCapBps: 3_500,
    connected: true,
    currentAllocationUsd: 540_000,
    id: 'kamino-main',
    jurisdiction: 'Switzerland, Singapore',
    name: 'Kamino Treasury Reserve',
    riskRating: 'Low',
  },
  {
    active: true,
    allocationCapBps: 1_800,
    connected: false,
    currentAllocationUsd: 190_000,
    id: 'cash-ladder',
    jurisdiction: 'United States',
    name: 'Treasury Bill Ladder',
    riskRating: 'Low',
  },
  {
    active: false,
    allocationCapBps: 1_200,
    connected: false,
    currentAllocationUsd: 0,
    id: 'stable-repo',
    jurisdiction: 'EU',
    name: 'Stable Repo Sleeve',
    riskRating: 'Moderate',
  },
];

const defaultProposals: GovernanceProposalView[] = [
  {
    description: 'Increase circuit breaker threshold for quarter-end settlement activity.',
    eta: 'Ready for execution',
    id: 'SQD-101',
    signatures: '2 / 3 signers',
    status: 'Ready',
    title: 'Adjust daily outflow threshold',
  },
  {
    description: 'Add Kamino venue to the approved venue registry with 35% cap.',
    eta: 'Awaiting final signer',
    id: 'SQD-102',
    signatures: '1 / 3 signers',
    status: 'Pending',
    title: 'Approve Kamino allocation',
  },
  {
    description: 'Authorize transfer metadata decryption for FINMA information request.',
    eta: 'Executed 2 hours ago',
    id: 'SQD-099',
    signatures: '3 / 3 signers',
    status: 'Executed',
    title: 'Release Travel Rule payload',
  },
];

const trackMapping: TrackMappingItem[] = [
  {
    feature: 'Proof-gated deposits, transfers, and withdrawals',
    requirement: 'Automated smart-contract-based vault management',
    status: 'Live',
  },
  {
    feature: 'Source-of-funds field inside the credential witness',
    requirement: 'Prove source of coins on regulator demand',
    status: 'Ready',
  },
  {
    feature: 'Client-side alerts and circuit breaker monitoring',
    requirement: 'Funds monitoring and risk controls',
    status: 'Ready',
  },
  {
    feature: 'Squads-style approval surface',
    requirement: 'Institutional governance',
    status: 'Mocked pending Agent 4',
  },
];

export function useInstitutionalData() {
  const { publicKey } = useWallet();
  const vaultState = useVaultState();
  const registryState = useRegistryState();
  const transferState = useTransferRecords();

  const records = useMemo(() => {
    if (transferState.records.length > 0) {
      return transferState.records;
    }

    return createMockRecords(publicKey ?? undefined);
  }, [publicKey, transferState.records]);

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
    governanceMembers: defaultGovernanceMembers,
    governanceProposals: defaultProposals,
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
    usingMockRecords: transferState.records.length === 0,
    vaultState,
    yieldMetrics: {
      currentVenue: defaultYieldVenues.find((venue) => venue.active)?.name ?? 'Liquid buffer',
      liquidBufferUsd:
        toNumber(vaultState.data.totalAssets) * Math.max(0, 1 - vaultState.data.liquidBufferRatio),
      yieldRate:
        toNumber(vaultState.data.totalAssets) > 0
          ? (toNumber(vaultState.data.totalYieldEarned) / toNumber(vaultState.data.totalAssets)) * 100
          : 4.2,
      yieldVenues: defaultYieldVenues,
    },
  };
}
