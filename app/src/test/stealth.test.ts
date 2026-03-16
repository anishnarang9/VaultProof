import { PublicKey } from '@solana/web3.js';
import {
  deriveStealthAddress,
  generateStealthKeyPair,
  loadStealthKeys,
  saveStealthKeys,
  scanForPayments,
} from '../lib/stealth';

describe('frontend stealth helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generateStealthKeyPair returns all 4 keys', () => {
    const keys = generateStealthKeyPair();

    expect(keys.scanKey).toHaveLength(32);
    expect(keys.spendKey).toHaveLength(32);
    expect(keys.scanPubKey).toHaveLength(32);
    expect(keys.spendPubKey).toHaveLength(32);
  });

  it('deriveStealthAddress returns a valid PublicKey', () => {
    const keys = generateStealthKeyPair();
    const stealthAddress = deriveStealthAddress(keys.scanPubKey, keys.spendPubKey);

    expect(stealthAddress.address).toBeInstanceOf(PublicKey);
    expect(stealthAddress.ephemeralPubKey.length).toBeGreaterThan(0);
  });

  it('saveStealthKeys + loadStealthKeys roundtrips correctly', () => {
    const keys = generateStealthKeyPair();

    saveStealthKeys(keys);

    expect(loadStealthKeys()).toEqual(keys);
  });

  it('scanForPayments finds correct addresses', () => {
    const keys = generateStealthKeyPair();
    const stealthAddress = deriveStealthAddress(keys.scanPubKey, keys.spendPubKey);

    const matches = scanForPayments(keys.scanKey, keys.spendPubKey, [stealthAddress.ephemeralPubKey]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.toBase58()).toBe(stealthAddress.address.toBase58());
  });
});
