import { useWallet } from '@solana/wallet-adapter-react';
import { useLocation } from 'react-router-dom';
import { useInstitutionalData } from './useInstitutionalData';
import { useVaultState } from './useVaultState';
import { publicKeyEquals } from '../lib/utils';

export function useAppRole() {
  const { publicKey } = useWallet();
  const { data: vault } = useVaultState();
  const { governanceMembers } = useInstitutionalData();
  const { pathname } = useLocation();

  const isAuthority = publicKeyEquals(publicKey, vault.authority);
  const isSquadsMember = publicKey ? governanceMembers.includes(publicKey.toBase58()) : false;
  const role = !publicKey ? 'guest' : isAuthority || isSquadsMember ? 'operator' : 'investor';

  const console = pathname.startsWith('/institution')
    ? 'institution'
    : pathname.startsWith('/investor')
      ? 'investor'
      : null;

  return {
    console,
    isAuthority,
    isSquadsMember,
    publicKey,
    role,
  };
}
