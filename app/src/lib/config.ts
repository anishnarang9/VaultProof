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

const PROGRAM_IDS = {
  complianceAdmin: 'BsEMZCJzj3SqwSj6z2F3X8m9rFHjLubgBzMeSgj8Lp6K',
  kycRegistry: 'NsgKr1qCEUb1vXdwaGvbz3ygG4R4SCrUQm3T8tHoqgD',
  vusdVault: 'CUxwkHjKjGyKa5H1qEQySw98yKn33RZFxc9TbVgU6rdu',
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
