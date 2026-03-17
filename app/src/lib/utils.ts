import { clsx, type ClassValue } from 'clsx';
import { PublicKey } from '@solana/web3.js';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function publicKeyEquals(
  left?: PublicKey | { toBase58(): string } | null,
  right?: PublicKey | { toBase58(): string } | null,
) {
  if (!left || !right) {
    return false;
  }

  return left.toBase58() === right.toBase58();
}
