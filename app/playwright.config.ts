import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const port = 4173;
const baseURL = `http://127.0.0.1:${port}`;

// Load test wallet secret from saved state (written by global setup)
let walletSecret = process.env.VITE_E2E_WALLET_SECRET ?? '';
const stateFile = resolve(__dirname, 'e2e', '.localnet-state.json');
if (!walletSecret && existsSync(stateFile)) {
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    walletSecret = state.walletSecretBase58 ?? '';
  } catch {
    // Ignore — will run without auto-signing wallet
  }
}

// Build env vars for the Vite dev server
const viteEnv = {
  VITE_SOLANA_RPC_URL: process.env.VITE_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  VITE_CLUSTER: process.env.VITE_CLUSTER ?? 'devnet',
  ...(walletSecret ? { VITE_E2E_WALLET_SECRET: walletSecret } : {}),
};

const envPrefix = Object.entries(viteEnv)
  .map(([key, value]) => `${key}=${value}`)
  .join(' ');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false, // Sequential — deposit test depends on credential test state
  retries: process.env.CI ? 2 : 0,
  timeout: 180_000, // 3 min for proof generation tests
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `${envPrefix} npm run dev -- --host 127.0.0.1 --port ${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: baseURL,
  },
});
