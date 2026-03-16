import { startTransition, useState } from 'react';
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

function readCredential(): StoredCredential | null {
  const stored = getStorage().getItem(STORAGE_KEY);

  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<StoredCredential>;

    if (
      typeof parsed.fullName !== 'string' ||
      typeof parsed.dateOfBirth !== 'string' ||
      typeof parsed.identitySecret !== 'string'
    ) {
      return null;
    }

    return parsed as StoredCredential;
  } catch {
    return null;
  }
}

export function useCredential() {
  const [credential, setCredential] = useState<StoredCredential | null>(() => readCredential());

  const saveCredential = (next: StoredCredential) => {
    getStorage().setItem(STORAGE_KEY, JSON.stringify(next));
    startTransition(() => setCredential(next));
  };

  const clearCredential = () => {
    getStorage().removeItem(STORAGE_KEY);
    startTransition(() => setCredential(null));
  };

  return { credential, clearCredential, saveCredential };
}
