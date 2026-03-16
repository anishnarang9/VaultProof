import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { clusterApiUrl } from '@solana/web3.js';
import { useMemo } from 'react';
import { Navbar } from './components/layout/Navbar';
import {
  Compliance,
  Credential,
  Dashboard,
  Deposit,
  Home,
  Transfer,
  Withdraw,
} from './pages';

export function AppShell() {
  return (
    <div className="app-shell">
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/credential" element={<Credential />} />
        <Route path="/deposit" element={<Deposit />} />
        <Route path="/transfer" element={<Transfer />} />
        <Route path="/withdraw" element={<Withdraw />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/compliance" element={<Compliance />} />
      </Routes>
    </div>
  );
}

function App() {
  const endpoint = useMemo(
    () => import.meta.env.VITE_SOLANA_RPC_URL ?? clusterApiUrl('devnet'),
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect={false}>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default App;
