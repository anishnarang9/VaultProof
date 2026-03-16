import { Keypair, PublicKey } from '@solana/web3.js';

const STEALTH_STORAGE_KEY = 'vaultproof.stealth-keys';

export interface StealthKeyPair {
  scanKey: Uint8Array;
  spendKey: Uint8Array;
  scanPubKey: Uint8Array;
  spendPubKey: Uint8Array;
}

export interface StealthAddress {
  address: PublicKey;
  ephemeralPubKey: Uint8Array;
}

function requireCrypto() {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for stealth address utilities.');
  }

  return globalThis.crypto;
}

async function sha256(...parts: Uint8Array[]) {
  const crypto = requireCrypto();
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;

  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }

  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function randomBytes(length = 32) {
  const bytes = new Uint8Array(length);
  requireCrypto().getRandomValues(bytes);
  return bytes;
}

function derivePubKey(seed: Uint8Array) {
  return Keypair.fromSeed(seed.slice(0, 32)).publicKey.toBytes();
}

function getStorage() {
  return globalThis.localStorage;
}

export function generateStealthKeyPair(): StealthKeyPair {
  const scanKey = randomBytes(32);
  const spendKey = randomBytes(32);

  return {
    scanKey,
    spendKey,
    scanPubKey: derivePubKey(scanKey),
    spendPubKey: derivePubKey(spendKey),
  };
}

export function deriveStealthAddress(
  recipientScanPubKey: Uint8Array,
  recipientSpendPubKey: Uint8Array,
): StealthAddress {
  const ephemeralKey = Keypair.generate();
  const seed = Buffer.from(ephemeralKey.publicKey.toBytes());

  const addressSeed = Buffer.alloc(32);
  addressSeed.set(seed.subarray(0, 32));

  for (let index = 0; index < 32; index += 1) {
    addressSeed[index] =
      addressSeed[index] ^
      (recipientScanPubKey[index % recipientScanPubKey.length] ?? 0) ^
      (recipientSpendPubKey[index % recipientSpendPubKey.length] ?? 0);
  }

  return {
    address: Keypair.fromSeed(Uint8Array.from(addressSeed)).publicKey,
    ephemeralPubKey: ephemeralKey.publicKey.toBytes(),
  };
}

export function scanForPayments(
  scanKey: Uint8Array,
  spendPubKey: Uint8Array,
  ephemeralPubKeys: Uint8Array[],
) {
  const scanPubKey = derivePubKey(scanKey);

  return ephemeralPubKeys.map((ephemeralPubKey) => {
    const addressSeed = Buffer.from(ephemeralPubKey.slice(0, 32));

    for (let index = 0; index < 32; index += 1) {
      addressSeed[index] =
        addressSeed[index] ^
        (scanPubKey[index % scanPubKey.length] ?? 0) ^
        (spendPubKey[index % spendPubKey.length] ?? 0);
    }

    return Keypair.fromSeed(Uint8Array.from(addressSeed)).publicKey;
  });
}

function encodeKeys(keys: StealthKeyPair) {
  return JSON.stringify({
    scanKey: Array.from(keys.scanKey),
    spendKey: Array.from(keys.spendKey),
    scanPubKey: Array.from(keys.scanPubKey),
    spendPubKey: Array.from(keys.spendPubKey),
  });
}

function decodeKeys(serialized: string): StealthKeyPair | null {
  try {
    const parsed = JSON.parse(serialized) as Record<string, number[]>;

    return {
      scanKey: Uint8Array.from(parsed.scanKey ?? []),
      spendKey: Uint8Array.from(parsed.spendKey ?? []),
      scanPubKey: Uint8Array.from(parsed.scanPubKey ?? []),
      spendPubKey: Uint8Array.from(parsed.spendPubKey ?? []),
    };
  } catch {
    return null;
  }
}

export function saveStealthKeys(keys: StealthKeyPair) {
  getStorage().setItem(STEALTH_STORAGE_KEY, encodeKeys(keys));
}

export function loadStealthKeys() {
  const serialized = getStorage().getItem(STEALTH_STORAGE_KEY);
  return serialized ? decodeKeys(serialized) : null;
}

export async function deriveDeterministicStealthAddress(
  recipientScanPubKey: Uint8Array,
  recipientSpendPubKey: Uint8Array,
  ephemeralPubKey: Uint8Array,
) {
  const addressSeed = await sha256(ephemeralPubKey, recipientScanPubKey, recipientSpendPubKey);
  return Keypair.fromSeed(addressSeed.slice(0, 32)).publicKey;
}
