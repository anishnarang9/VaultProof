import { startTransition, useState } from 'react';
import { bigintToHex, textToField } from '../lib/crypto';
import type { StoredCredential } from '../lib/types';

const STORAGE_KEY = 'vaultproof.credential';
const memoryStorage = new Map<string, string>();

function getStorage() {
  if (
    typeof globalThis.localStorage !== 'undefined' &&
    typeof globalThis.localStorage.getItem === 'function' &&
    typeof globalThis.localStorage.setItem === 'function' &&
    typeof globalThis.localStorage.removeItem === 'function'
  ) {
    return globalThis.localStorage;
  }

  return {
    getItem(key: string) {
      return memoryStorage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memoryStorage.set(key, value);
    },
    removeItem(key: string) {
      memoryStorage.delete(key);
    },
  };
}

function normalizeCredential(parsed: Partial<StoredCredential>): StoredCredential | null {
  if (
    typeof parsed.fullName !== 'string' ||
    typeof parsed.dateOfBirth !== 'string' ||
    typeof parsed.identitySecret !== 'string' ||
    typeof parsed.wallet !== 'string'
  ) {
    return null;
  }

  return {
    accreditation: parsed.accreditation ?? 'accredited',
    countryCode: parsed.countryCode ?? 'US',
    credentialVersion: typeof parsed.credentialVersion === 'number' ? parsed.credentialVersion : 1,
    dateOfBirth: parsed.dateOfBirth,
    expiresAt:
      typeof parsed.expiresAt === 'string'
        ? parsed.expiresAt
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    fullName: parsed.fullName,
    identitySecret: parsed.identitySecret,
    issuedAt: typeof parsed.issuedAt === 'string' ? parsed.issuedAt : new Date().toISOString(),
    jurisdiction: parsed.jurisdiction ?? 'United States',
    leafHash: parsed.leafHash ?? '',
    note: parsed.note,
    sourceOfFundsHash:
      typeof parsed.sourceOfFundsHash === 'string'
        ? parsed.sourceOfFundsHash
        : bigintToHex(textToField(parsed.sourceOfFundsReference ?? parsed.note ?? '')),
    sourceOfFundsReference: parsed.sourceOfFundsReference,
    wallet: parsed.wallet,
  };
}

function readCredential(): StoredCredential | null {
  const stored = getStorage().getItem(STORAGE_KEY);

  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<StoredCredential>;
    return normalizeCredential(parsed);
  } catch {
    return null;
  }
}

export function useCredential() {
  const [credential, setCredential] = useState<StoredCredential | null>(() => readCredential());

  const saveCredential = (next: StoredCredential) => {
    const normalized = normalizeCredential(next);

    if (!normalized) {
      return;
    }

    getStorage().setItem(STORAGE_KEY, JSON.stringify(normalized));
    startTransition(() => setCredential(normalized));
  };

  const clearCredential = () => {
    getStorage().removeItem(STORAGE_KEY);
    startTransition(() => setCredential(null));
  };

  return { credential, clearCredential, saveCredential };
}
