import { PublicKey } from '@solana/web3.js';
import type { AccreditationTier } from './types';

export const BN254_FIELD = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
);
export const TREE_DEPTH = 20;
export const NUM_METADATA_FIELDS = 5;
export const DEFAULT_ISSUER_PRIVATE_KEY_HEX =
  '0001020304050607080900010203040506070809000102030405060708090001';
export const DEFAULT_REGULATOR_PRIVATE_KEY = 123456789n;

const COUNTRY_NUMERIC_CODES: Record<string, number> = {
  AE: 784,
  BR: 76,
  CA: 124,
  CH: 756,
  DE: 276,
  FR: 250,
  GB: 826,
  HK: 344,
  JP: 392,
  SG: 702,
  US: 840,
};

function getCrypto() {
  if (typeof globalThis.crypto !== 'undefined') {
    return globalThis.crypto;
  }

  throw new Error('Web Crypto is required for proof generation.');
}

export function bytesToBigInt(value: number[] | Uint8Array): bigint {
  const bytes = value instanceof Uint8Array ? value : Uint8Array.from(value);
  let result = 0n;

  for (const byte of bytes) {
    result = (result << 8n) + BigInt(byte);
  }

  return result;
}

export function bigintToBytes(value: bigint, width = 32): Uint8Array {
  let normalized = value;

  if (normalized < 0n) {
    normalized = ((normalized % BN254_FIELD) + BN254_FIELD) % BN254_FIELD;
  }

  const bytes = new Uint8Array(width);

  for (let index = width - 1; index >= 0; index -= 1) {
    bytes[index] = Number(normalized & 0xffn);
    normalized >>= 8n;
  }

  return bytes;
}

export function bigintToHex(value: bigint, width = 32): string {
  return `0x${Array.from(bigintToBytes(value, width), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}

export function textToField(text: string): bigint {
  const bytes = new TextEncoder().encode(text.trim());
  let acc = 0n;

  for (const byte of bytes) {
    acc = (acc * 257n + BigInt(byte)) % BN254_FIELD;
  }

  return acc;
}

export function dateStringToUnixTimestamp(value: string): bigint {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return BigInt(Math.floor(timestamp / 1000));
}

export function countryCodeToNumeric(value: string): bigint {
  const code = value.trim().slice(0, 2).toUpperCase();
  const numeric = COUNTRY_NUMERIC_CODES[code];

  return typeof numeric === 'number' ? BigInt(numeric) : textToField(code || value);
}

export function accreditationToStatus(value: AccreditationTier): bigint {
  switch (value) {
    case 'retail':
      return 0n;
    case 'institutional':
      return 2n;
    case 'expired':
      return 0n;
    case 'accredited':
    default:
      return 1n;
  }
}

export function walletBytesToField(value: string | Uint8Array): bigint {
  try {
    const bytes =
      value instanceof Uint8Array ? value : new PublicKey(value).toBytes();
    return bytesToBigInt(bytes) % BN254_FIELD;
  } catch {
    return textToField(typeof value === 'string' ? value : Array.from(value).join(','));
  }
}

export function randomFieldElement() {
  const bytes = new Uint8Array(32);
  getCrypto().getRandomValues(bytes);
  const candidate = bytesToBigInt(bytes) % BN254_FIELD;
  return candidate === 0n ? 1n : candidate;
}

// ElGamal randomness must fit in 253 bits (circuit uses Num2Bits(253))
const MAX_253 = (1n << 253n) - 1n;

export function randomElgamalScalar() {
  const bytes = new Uint8Array(32);
  getCrypto().getRandomValues(bytes);
  const candidate = bytesToBigInt(bytes) & MAX_253;
  return candidate === 0n ? 1n : candidate;
}
