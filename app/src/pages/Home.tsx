import { ArrowRight, ShieldCheck, Waypoints, WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageContainer from '../components/layout/PageContainer';
import { useRegistryState } from '../hooks/useRegistryState';
import { useTransferRecords } from '../hooks/useTransferRecords';
import { useVaultState } from '../hooks/useVaultState';
import { formatCompact, formatCurrency } from '../lib/format';

const pillars = [
  {
    icon: ShieldCheck,
    title: 'Confidential identity',
    copy: 'KYC facts stay off-chain while the vault verifies compliance against public thresholds.',
  },
  {
    icon: Waypoints,
    title: 'Live on-chain observability',
    copy: 'Vault assets, transfer counts, registry capacity, and timelock policy all come from real account reads.',
  },
  {
    icon: WalletCards,
    title: 'Vault share model',
    copy: 'Users receive vault shares, not a wrapped stablecoin. Yield flows through share price instead of rebasing balances.',
  },
];

export default function Home() {
  const { data: vault } = useVaultState();
  const { data: registry } = useRegistryState();
  const { totalCount, totalVolume } = useTransferRecords();

  return (
    <PageContainer>
      <section className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">VaultProof / B2B2C protocol</p>
          <h1>Compliant stablecoins with confidential identity.</h1>
          <p className="hero-lede">
            VaultProof is confidential compliance infrastructure for institutional vaults. Identity,
            accreditation details, and travel rule payloads remain shielded while the vault itself
            stays auditable.
          </p>
          <div className="action-row">
            <Link className="button" to="/credential">
              Start onboarding
            </Link>
            <Link className="button button-secondary" to="/dashboard">
              View telemetry
            </Link>
          </div>
        </div>

        <div className="hero-panel panel">
          <div className="stat-grid stat-grid-compact">
            <div className="stat-card">
              <span className="stat-label">Total assets</span>
              <strong>{formatCurrency(vault.totalAssets)}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Share price</span>
              <strong>{vault.sharePrice > 0 ? `$${vault.sharePrice.toFixed(2)}` : 'Awaiting first mint'}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Verified transfers</span>
              <strong>{formatCompact(totalCount)}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Transfer volume</span>
              <strong>{formatCurrency(totalVolume)}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Active credentials</span>
              <strong>{formatCompact(registry.activeCredentials)}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Tree depth</span>
              <strong>{registry.stateTree.depth}</strong>
            </div>
          </div>
          <div className="signal-strip">
            <span className="chip">72h emergency timelock</span>
            <span className="chip">Devnet account reads</span>
            <span className="chip">Share-based vaulting</span>
          </div>
        </div>
      </section>

      <section className="section-grid">
        {pillars.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <article key={pillar.title} className="panel feature-card">
              <span className="feature-icon">
                <Icon size={20} />
              </span>
              <h2>{pillar.title}</h2>
              <p>{pillar.copy}</p>
              <Link className="text-link" to="/compliance">
                Inspect model <ArrowRight size={16} />
              </Link>
            </article>
          );
        })}
      </section>
    </PageContainer>
  );
}
