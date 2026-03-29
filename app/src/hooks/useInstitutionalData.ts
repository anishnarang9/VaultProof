import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultReadClient } from '../lib/readClient';
import {
  type DecryptionAuthorizationWithAddress,
  TransferType,
  type VaultProofReadClient,
  type WhitelistedYieldVenueWithAddress,
} from '../lib/types';
import { useRegistryState } from './useRegistryState';
import { useTransferRecords } from './useTransferRecords';
import { useVaultState } from './useVaultState';

const EMPTY_PUBLIC_KEY = '11111111111111111111111111111111';
const textDecoder = new TextDecoder();

export interface YieldVenueView {
  accountAddress: PublicKey;
  active: boolean;
  allocationCapBps: number;
  connected: boolean;
  currentAllocationUsd: number;
  id: string;
  jurisdiction: string;
  name: string;
  riskRating: 'Low' | 'Moderate' | 'Elevated';
  venueAddress: string;
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
    feature: 'Authority-routed compliance actions',
    requirement: 'Institutional governance',
    status: 'Live',
  },
];

function toNumber(value: BN | number) {
  return value instanceof BN ? Number(value.toString()) : value;
}

function normalizeJurisdiction(bytes: number[]) {
  const trimmed = Uint8Array.from(bytes).filter((byte) => byte !== 0);

  if (trimmed.length === 0) {
    return 'Any';
  }

  const printable = Array.from(trimmed).every((byte) => byte >= 32 && byte <= 126);

  if (!printable) {
    return `0x${Array.from(trimmed)
      .slice(0, 8)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  }

  return textDecoder.decode(trimmed);
}

function normalizeRiskRating(value: number): YieldVenueView['riskRating'] {
  if (value <= 2) {
    return 'Low';
  }

  if (value === 3) {
    return 'Moderate';
  }

  return 'Elevated';
}

function buildYieldVenueView(
  venue: WhitelistedYieldVenueWithAddress,
  totalAssets: number,
): YieldVenueView {
  const estimatedAllocation = (totalAssets * venue.allocationCapBps) / 10_000;

  return {
    accountAddress: venue.address,
    active: venue.active,
    allocationCapBps: venue.allocationCapBps,
    connected: venue.active,
    currentAllocationUsd: venue.active ? estimatedAllocation : 0,
    id: venue.address.toBase58(),
    jurisdiction: normalizeJurisdiction(venue.jurisdictionWhitelist),
    name: venue.name || venue.venueAddress.toBase58(),
    riskRating: normalizeRiskRating(venue.riskRating),
    venueAddress: venue.venueAddress.toBase58(),
  };
}

function buildGovernanceProposal(
  authorization: DecryptionAuthorizationWithAddress,
): GovernanceProposalView {
  const timestamp = Number(authorization.timestamp.toString()) * 1000;

  return {
    description: `Transfer record ${authorization.transferRecord.toBase58()} authorized by ${authorization.authorizedBy.toBase58()}.`,
    eta: new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    id: authorization.address.toBase58(),
    signatures: '1 / 1 authority',
    status: 'Executed',
    title: 'Authorize decryption',
  };
}

export function useInstitutionalData(client: VaultProofReadClient = defaultReadClient) {
  const { publicKey } = useWallet();
  const vaultState = useVaultState(client);
  const registryState = useRegistryState(client);
  const transferState = useTransferRecords(client);
  const [yieldVenuesRaw, setYieldVenuesRaw] = useState<WhitelistedYieldVenueWithAddress[]>([]);
  const [decryptionAuthorizations, setDecryptionAuthorizations] = useState<
    DecryptionAuthorizationWithAddress[]
  >([]);
  const [supplementalError, setSupplementalError] = useState<string | null>(null);
  const [supplementalLoading, setSupplementalLoading] = useState(true);

  const refreshSupplementalData = useCallback(async () => {
    setSupplementalLoading(true);
    setSupplementalError(null);

    try {
      const [nextYieldVenues, nextAuthorizations] = await Promise.all([
        client.fetchYieldVenues(),
        client.fetchDecryptionAuthorizations(),
      ]);
      setYieldVenuesRaw(nextYieldVenues);
      setDecryptionAuthorizations(nextAuthorizations);
    } catch (caughtError) {
      setSupplementalError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to load operator data.',
      );
    } finally {
      setSupplementalLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refreshSupplementalData();
  }, [refreshSupplementalData]);

  const records = transferState.records;
  const totalAssets = toNumber(vaultState.data.totalAssets);

  const yieldVenues = useMemo(
    () => yieldVenuesRaw.map((venue) => buildYieldVenueView(venue, totalAssets)),
    [totalAssets, yieldVenuesRaw],
  );

  const currentVenue = useMemo(() => {
    const yieldSource = vaultState.data.yieldSource.toBase58();
    const sourceVenue = yieldVenues.find((venue) => venue.venueAddress === yieldSource);

    if (sourceVenue) {
      return sourceVenue.name;
    }

    return yieldVenues.find((venue) => venue.active)?.name ?? 'Liquid buffer';
  }, [vaultState.data.yieldSource, yieldVenues]);

  const recordsByTimestamp = useMemo(
    () =>
      [...records].sort(
        (left, right) => Number(left.timestamp.toString()) - Number(right.timestamp.toString()),
      ),
    [records],
  );

  const sharePriceHistory = useMemo(() => {
    if (recordsByTimestamp.length === 0) {
      return [];
    }

    const baseline = vaultState.data.sharePrice > 0 ? vaultState.data.sharePrice : 1;

    return recordsByTimestamp.map((record, index) => {
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
        sharePrice: Number((baseline + directionalDelta * index).toFixed(3)),
      };
    });
  }, [recordsByTimestamp, vaultState.data.sharePrice]);

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

  const proportionalClaimUsd = shareBalance * (vaultState.data.sharePrice || 1);
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
  const governanceMembers =
    vaultState.data.authority.toBase58() === EMPTY_PUBLIC_KEY
      ? []
      : [vaultState.data.authority.toBase58()];
  const governanceProposals = decryptionAuthorizations.map(buildGovernanceProposal);

  const refresh = useCallback(async () => {
    await Promise.all([
      vaultState.refresh(),
      registryState.refresh(),
      transferState.refresh(),
      refreshSupplementalData(),
    ]);
  }, [
    refreshSupplementalData,
    registryState.refresh,
    transferState.refresh,
    vaultState.refresh,
  ]);

  return {
    decryptionAuthorizations,
    depositHistory,
    error:
      supplementalError ?? transferState.error ?? registryState.error ?? vaultState.error,
    governanceMembers,
    governanceProposals,
    isLoading:
      supplementalLoading ||
      transferState.isLoading ||
      registryState.isLoading ||
      vaultState.isLoading,
    portfolio: {
      proportionalClaimUsd,
      shareBalance,
      yieldEarned,
    },
    records,
    refresh,
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
    usingMockRecords: false,
    vaultState,
    yieldMetrics: {
      currentVenue,
      liquidBufferUsd:
        totalAssets * Math.max(0, 1 - vaultState.data.liquidBufferRatio),
      yieldRate:
        totalAssets > 0
          ? (toNumber(vaultState.data.totalYieldEarned) / totalAssets) * 100
          : 0,
      yieldVenues,
    },
  };
}
