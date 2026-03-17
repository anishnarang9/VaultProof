import { buildCircuitInput } from '../lib/proof';
import { createEmptyVaultState } from '../lib/types';

describe('frontend lib helpers', () => {
  it('createEmptyVaultState exposes the new risk-control defaults', () => {
    const state = createEmptyVaultState();

    expect(state.circuitBreakerThreshold.toString()).toBe('500000');
    expect(state.maxSingleTransaction.toString()).toBe('250000');
    expect(state.maxSingleDeposit.toString()).toBe('1000000');
    expect(state.maxDailyTransactions).toBe(40);
  });

  it('proof generation includes sourceOfFundsHash and credentialVersion in circuit input', () => {
    const input = buildCircuitInput({
      accreditationStatus: 1n,
      balance: 50_000n,
      credentialExpiry: 1_802_000_000n,
      credentialVersion: 1n,
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
      sourceOfFundsHash: 4444n,
      transferAmount: 10_000n,
      walletPubkey: 123n,
    });

    expect(input.sourceOfFundsHash).toBe('4444');
    expect(input.credentialVersion).toBe('1');
    expect(input.merklePathElements).toHaveLength(20);
    expect(input.encryptedMetadata).toHaveLength(12);
  });
});
