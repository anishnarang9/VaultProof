import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRegistryState } from '../hooks/useRegistryState';
import { useCredential } from '../hooks/useCredential';
import { useProofGeneration } from '../hooks/useProofGeneration';
import { useTransferRecords } from '../hooks/useTransferRecords';
import { useVaultState } from '../hooks/useVaultState';
import {
  TransferType,
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
  fetchKycRegistry: async () =>
    createEmptyKycRegistry({
      credentialCount: new BN(12),
      revokedCount: new BN(1),
    }),
  fetchStateTree: async () =>
    createEmptyStateTree({
      depth: 20,
      nextIndex: new BN(12),
      root: Array.from({ length: 32 }, () => 5),
    }),
  fetchTransferRecords: async (): Promise<TransferRecordWithAddress[]> => [
    {
      ...createEmptyTransferRecord({
        amount: new BN(125_000),
        transferType: TransferType.Deposit,
      }),
      address: DEFAULT_KEY,
    },
    {
      ...createEmptyTransferRecord({
        amount: new BN(320_000),
        decryptionAuthorized: true,
        transferType: TransferType.Transfer,
      }),
      address: DEFAULT_KEY,
    },
  ],
  fetchVaultState: async () =>
    createEmptyVaultState({
      amlThresholds: [new BN(100_000), new BN(1_000_000), new BN(9_999_999)],
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
  beforeEach(() => {
    localStorage.clear();
  });

  it('useVaultState returns a typed vault state object', async () => {
    const { result } = renderHook(() => useVaultState(mockClient));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data.totalAssets.toString()).toBe('420000');
    expect(result.current.data.totalShares.toString()).toBe('400000');
    expect(result.current.data.sharePrice).toBe(1.05);
    expect('totalDeposited' in result.current.data).toBe(false);
  });

  it('useCredential stores and retrieves a credential from localStorage', () => {
    const { result } = renderHook(() => useCredential());

    act(() => {
      result.current.saveCredential({
        accreditation: 'accredited',
        countryCode: 'US',
        dateOfBirth: '1990-01-01',
        expiresAt: '2027-03-15T00:00:00.000Z',
        fullName: 'Jane Doe',
        identitySecret: '123456789',
        issuedAt: '2026-03-15T00:00:00.000Z',
        jurisdiction: 'United States',
        leafHash: '0xleaf',
        wallet: 'Wallet111111111111111111111111111111111111',
      });
    });

    expect(result.current.credential?.leafHash).toBe('0xleaf');
    expect(JSON.parse(localStorage.getItem('vaultproof.credential') ?? '{}').leafHash).toBe('0xleaf');
  });

  it('useProofGeneration starts in the idle state', () => {
    const { result } = renderHook(() => useProofGeneration());

    expect(result.current.step).toBe('idle');
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('useTransferRecords returns records with transfer types and can filter them', async () => {
    const { result } = renderHook(() => useTransferRecords(mockClient));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.records[0]?.transferType).toBe(TransferType.Deposit);
    expect(result.current.records[1]?.transferType).toBe(TransferType.Transfer);
    expect(result.current.totalCount).toBe(2);
    expect(result.current.totalVolume.toString()).toBe('445000');
    expect(result.current.filterByType(TransferType.Transfer)).toHaveLength(1);
  });

  it('useRegistryState returns active credentials and a merkle root from StateTree', async () => {
    const { result } = renderHook(() => useRegistryState(mockClient));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data.activeCredentials.toString()).toBe('11');
    expect(result.current.data.merkleRoot).toHaveLength(32);
    expect(result.current.data.stateTree.depth).toBe(20);
  });
});
