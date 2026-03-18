import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import type { Adapter } from '@solana/wallet-adapter-base';
import { CoinbaseWalletAdapter, PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { useMemo } from 'react';
import DeveloperLayout from './components/layout/DeveloperLayout';
import InvestorLayout from './components/layout/InvestorLayout';
import { ToastProvider } from './components/ui/primitives';
import Compliance from './pages/Compliance';
import ComplianceDetail from './pages/ComplianceDetail';
import Credential from './pages/Credential';
import Dashboard from './pages/Dashboard';
import Deposit from './pages/Deposit';
import Landing from './pages/Landing';
import OperatorGovernance from './pages/OperatorGovernance';
import OperatorRisk from './pages/OperatorRisk';
import OperatorYield from './pages/OperatorYield';
import Portfolio from './pages/Portfolio';
import Transfer from './pages/Transfer';
import Confidential from './pages/Confidential';
import Withdraw from './pages/Withdraw';
import { TestWalletAdapter } from './lib/test-wallet-adapter';

const E2E_WALLET_SECRET = import.meta.env.VITE_E2E_WALLET_SECRET as string | undefined;

export function AppShell() {
  return (
    <ToastProvider>
      <div className="relative min-h-screen bg-bg-primary text-text-primary">
        <Routes>
          {/* Landing */}
          <Route path="/" element={<Landing />} />

          {/* Institution Console */}
          <Route path="/institution" element={<DeveloperLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="onboard" element={<Credential />} />
            <Route path="yield" element={<OperatorYield />} />
            <Route path="risk" element={<OperatorRisk />} />
            <Route path="governance" element={<OperatorGovernance />} />
            <Route path="compliance" element={<Compliance />} />
            <Route path="compliance/:id" element={<ComplianceDetail />} />
          </Route>

          {/* Investor Portal */}
          <Route path="/investor" element={<InvestorLayout />}>
            <Route index element={<Portfolio />} />
            <Route path="deposit" element={<Deposit />} />
            <Route path="transfer" element={<Transfer />} />
            <Route path="withdraw" element={<Withdraw />} />
            <Route path="confidential" element={<Confidential />} />
          </Route>

          {/* Legacy redirects — developer → institution */}
          <Route path="/developer" element={<Navigate replace to="/institution" />} />
          <Route path="/developer/onboard" element={<Navigate replace to="/institution/onboard" />} />
          <Route path="/developer/yield" element={<Navigate replace to="/institution/yield" />} />
          <Route path="/developer/risk" element={<Navigate replace to="/institution/risk" />} />
          <Route path="/developer/governance" element={<Navigate replace to="/institution/governance" />} />
          <Route path="/developer/compliance" element={<Navigate replace to="/institution/compliance" />} />
          <Route path="/developer/compliance/:id" element={<Navigate replace to="/institution/compliance/:id" />} />

          {/* Legacy redirects — operator → institution */}
          <Route path="/operator" element={<Navigate replace to="/institution" />} />
          <Route path="/operator/onboard" element={<Navigate replace to="/institution/onboard" />} />
          <Route path="/operator/yield" element={<Navigate replace to="/institution/yield" />} />
          <Route path="/operator/risk" element={<Navigate replace to="/institution/risk" />} />
          <Route path="/operator/governance" element={<Navigate replace to="/institution/governance" />} />
          <Route path="/compliance" element={<Navigate replace to="/institution/compliance" />} />
          <Route path="/compliance/:id" element={<Navigate replace to="/institution/compliance/:id" />} />
          <Route path="/portfolio" element={<Navigate replace to="/investor" />} />
          <Route path="/deposit" element={<Navigate replace to="/investor/deposit" />} />
          <Route path="/transfer" element={<Navigate replace to="/investor/transfer" />} />
          <Route path="/withdraw" element={<Navigate replace to="/investor/withdraw" />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </div>
    </ToastProvider>
  );
}

function App() {
  const endpoint = useMemo(
    () => import.meta.env.VITE_SOLANA_RPC_URL ?? clusterApiUrl('devnet'),
    [],
  );

  const wallets: Adapter[] = useMemo(() => {
    const nextWallets: Adapter[] = [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
    ];

    if (E2E_WALLET_SECRET) {
      nextWallets.unshift(new TestWalletAdapter(E2E_WALLET_SECRET));
    }

    return nextWallets;
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider autoConnect={!!E2E_WALLET_SECRET} wallets={wallets}>
        <WalletModalProvider>
          <BrowserRouter>
            <AppShell />
          </BrowserRouter>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default App;
