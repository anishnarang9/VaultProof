export type ClusterEnv = 'localnet' | 'devnet' | 'mainnet-beta';

export interface AppConfig {
  cluster: ClusterEnv;
  commitment: 'processed' | 'confirmed' | 'finalized';
  programIds: {
    complianceAdmin: string;
    kycRegistry: string;
    vusdVault: string;
  };
  rpcUrl: string;
  wsUrl: string;
}

export const PROGRAM_IDS = {
  complianceAdmin:
    import.meta.env.VITE_COMPLIANCE_ADMIN_PROGRAM_ID ??
    'J6Z2xLJajs627cCpQQGBRqkvPEGE6YkXsx22CTwFkCaF',
  kycRegistry:
    import.meta.env.VITE_KYC_REGISTRY_PROGRAM_ID ?? 'HKAr17WzrUyXudnWb63jxpRtXSEYAFnovv3kVfSKB4ih',
  vusdVault:
    import.meta.env.VITE_VUSD_VAULT_PROGRAM_ID ?? '2ZrgfkWWHoverBrKXwZsUnmZMaHUFssGipng31jrnn28',
} as const;

const CONFIGS: Record<ClusterEnv, AppConfig> = {
  localnet: {
    cluster: 'localnet',
    commitment: 'confirmed',
    programIds: PROGRAM_IDS,
    rpcUrl: import.meta.env.VITE_SOLANA_RPC_URL ?? 'http://127.0.0.1:8899',
    wsUrl: import.meta.env.VITE_WS_URL ?? 'ws://127.0.0.1:8900',
  },
  devnet: {
    cluster: 'devnet',
    commitment: 'confirmed',
    programIds: PROGRAM_IDS,
    rpcUrl:
      import.meta.env.VITE_SOLANA_RPC_URL ??
      import.meta.env.VITE_RPC_URL ??
      'https://api.devnet.solana.com',
    wsUrl: import.meta.env.VITE_WS_URL ?? 'wss://api.devnet.solana.com',
  },
  'mainnet-beta': {
    cluster: 'mainnet-beta',
    commitment: 'finalized',
    programIds: PROGRAM_IDS,
    rpcUrl:
      import.meta.env.VITE_SOLANA_RPC_URL ??
      import.meta.env.VITE_RPC_URL ??
      'https://api.mainnet-beta.solana.com',
    wsUrl: import.meta.env.VITE_WS_URL ?? 'wss://api.mainnet-beta.solana.com',
  },
};

function isClusterEnv(value: string | undefined): value is ClusterEnv {
  return value === 'localnet' || value === 'devnet' || value === 'mainnet-beta';
}

export function getConfig(): AppConfig {
  const selected = import.meta.env.VITE_CLUSTER;
  const cluster = isClusterEnv(selected) ? selected : 'localnet';

  return CONFIGS[cluster];
}
