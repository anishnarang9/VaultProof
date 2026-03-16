import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

function toNumber(value: bigint | number | BN): number {
  if (value instanceof BN) {
    return Number(value.toString());
  }

  return typeof value === 'bigint' ? Number(value) : value;
}

export function formatCurrency(value: bigint | number | BN): string {
  const numeric = toNumber(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: numeric >= 1000 ? 0 : 2,
  }).format(numeric);
}

export function formatCompact(value: bigint | number | BN): string {
  const numeric = toNumber(value);
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(numeric);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(0)}%`;
}

export function formatDateTime(value: bigint | number | BN | string): string {
  if (!value) {
    return 'Pending';
  }

  if (value instanceof BN) {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(Number(value.toString()) * 1000));
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(Number(value) * 1000));
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function shorten(value: number[] | PublicKey | string, start = 4, end = 4): string {
  const normalized = Array.isArray(value)
    ? bytesToHex(value)
    : value instanceof PublicKey
      ? value.toBase58()
      : value;

  if (!normalized || normalized.length <= start + end + 1) {
    return normalized || 'Unavailable';
  }

  return `${normalized.slice(0, start)}...${normalized.slice(-end)}`;
}

export function bytesToHex(value: number[]): string {
  return `0x${value.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function publicKeyToString(value: PublicKey | string): string {
  return value instanceof PublicKey ? value.toBase58() : value;
}
