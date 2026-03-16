import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { buildCircuitInput } from '../lib/proof';
import { encryptCompliancePayload } from '../lib/elgamal';
import {
  TransferType,
  createEmptyKycRegistry,
  createEmptyStateTree,
  createEmptyTransferRecord,
  createEmptyVaultState,
} from '../lib/types';

describe('frontend lib helpers', () => {
  it('VaultState uses TVS fields from the rebuilt program layout', () => {
    const state = createEmptyVaultState({
      sharePriceDenominator: new BN(8),
      sharePriceNumerator: new BN(10),
      totalAssets: new BN(10),
      totalShares: new BN(8),
    });

    expect(state.totalAssets.toString()).toBe('10');
    expect(state.totalShares.toString()).toBe('8');
    expect(state.sharePriceNumerator.toString()).toBe('10');
    expect(state.sharePriceDenominator.toString()).toBe('8');
  });

  it('VaultState does not expose pre-TVS fields', () => {
    const state = createEmptyVaultState();

    expect('totalDeposited' in state).toBe(false);
    expect('totalVusdSupply' in state).toBe(false);
  });

  it('TransferRecord uses the expanded verifier-facing layout', () => {
    const record = createEmptyTransferRecord({
      amount: new BN(25_000),
      encryptedMetadata: Array.from({ length: 32 }, (_, index) => index),
      signer: new PublicKey('11111111111111111111111111111111'),
      transferType: TransferType.Transfer,
    });

    expect(record.transferType).toBe(TransferType.Transfer);
    expect(record.amount.toString()).toBe('25000');
    expect(record.encryptedMetadata).toHaveLength(32);
    expect(record.decryptionAuthorized).toBe(false);
    expect(record.signer.toBase58()).toBe('11111111111111111111111111111111');
  });

  it('TransferRecord does not expose the old encrypted metadata hash field', () => {
    const record = createEmptyTransferRecord();

    expect('encryptedMetadataHash' in record).toBe(false);
  });

  it('KycRegistry and StateTree expose the Light state tree fields', () => {
    const registry = createEmptyKycRegistry({
      credentialCount: new BN(12),
      revokedCount: new BN(1),
    });
    const stateTree = createEmptyStateTree({
      depth: 20,
      nextIndex: new BN(12),
      root: Array.from({ length: 32 }, () => 7),
    });

    expect(registry.stateTreePubkey).toBeInstanceOf(PublicKey);
    expect(registry.revokedCount.toString()).toBe('1');
    expect(stateTree.root).toHaveLength(32);
    expect(stateTree.depth).toBe(20);
    expect(stateTree.nextIndex.toString()).toBe('12');
  });

  it('buildCircuitInput produces the 22-input circuit witness shape', () => {
    const input = buildCircuitInput({
      accreditationStatus: 1n,
      balance: 50_000n,
      credentialExpiry: 1_802_000_000n,
      currentTimestamp: 1_742_000_000n,
      dateOfBirth: 631_152_000n,
      elgamalRandomness: 4242n,
      encryptedMetadata: Array.from({ length: 12 }, (_, index) => BigInt(index + 1)),
      identitySecret: 9999n,
      institutionalThreshold: 9_223_372_036_854_775_807n,
      issuerSignature: {
        R8: [11n, 12n],
        S: 13n,
      },
      jurisdiction: 756n,
      merklePathElements: Array.from({ length: 20 }, (_, index) => BigInt(index + 100)),
      merklePathIndices: Array.from({ length: 20 }, () => 0),
      merkleRoot: 123456n,
      name: 777n,
      nationality: 756n,
      recipientAddress: 111111n,
      regulatorPubKeyX: 888n,
      regulatorPubKeyY: 999n,
      retailThreshold: 100_000n,
      accreditedThreshold: 1_000_000n,
      expiredThreshold: 10_000n,
      transferAmount: 10_000n,
      walletPubkey: 123n,
    });

    expect(input).toMatchObject({
      merkleRoot: '123456',
      transferAmount: '10000',
      currentTimestamp: '1742000000',
      retailThreshold: '100000',
      accreditedThreshold: '1000000',
      expiredThreshold: '10000',
      walletPubkey: '123',
    });
    expect(input.merklePathElements).toHaveLength(20);
    expect(input.merklePathIndices).toHaveLength(20);
    expect(input.encryptedMetadata).toHaveLength(12);
  });

  it('encryptCompliancePayload returns a buffer-like payload', async () => {
    const encrypted = await encryptCompliancePayload({
      amount: 25_000n,
      jurisdiction: 'CH',
      recipient: 'StealthRecipient1111111111111111111111111111',
      sender: 'StealthSender111111111111111111111111111111111',
    });

    expect(encrypted.byteLength).toBeGreaterThan(32);
  });
});
