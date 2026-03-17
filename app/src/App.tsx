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
import Withdraw from './pages/Withdraw';
import { TestWalletAdapter } from './lib/test-wallet-adapter';

const E2E_WALLET_SECRET = import.meta.env.VITE_E2E_WALLET_SECRET as string | undefined;

export function AppShell() {
  return (
    <ToastProvider>
      <div className="relative min-h-screen bg-bg-primary text-text-primary">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.04),_transparent_50%)]" />
        <Routes>
          {/* Landing */}
          <Route path="/" element={<Landing />} />

          {/* Developer Console */}
          <Route path="/developer" element={<DeveloperLayout />}>
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
          </Route>

          {/* Legacy redirects */}
          <Route path="/operator" element={<Navigate replace to="/developer" />} />
          <Route path="/operator/onboard" element={<Navigate replace to="/developer/onboard" />} />
          <Route path="/operator/yield" element={<Navigate replace to="/developer/yield" />} />
          <Route path="/operator/risk" element={<Navigate replace to="/developer/risk" />} />
          <Route path="/operator/governance" element={<Navigate replace to="/developer/governance" />} />
          <Route path="/compliance" element={<Navigate replace to="/developer/compliance" />} />
          <Route path="/compliance/:id" element={<Navigate replace to="/developer/compliance/:id" />} />
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
