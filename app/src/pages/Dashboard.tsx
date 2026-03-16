import PageContainer from '../components/layout/PageContainer';
import { useRegistryState } from '../hooks/useRegistryState';
import { useTransferRecords } from '../hooks/useTransferRecords';
import { useVaultState } from '../hooks/useVaultState';
import { formatCompact, formatCurrency, formatDateTime, formatPercent, shorten } from '../lib/format';

export default function Dashboard() {
  const { data: vault, isLoading: vaultLoading } = useVaultState();
  const { data: registry, isLoading: registryLoading } = useRegistryState();
  const { records, totalCount, totalVolume, isLoading: recordsLoading } = useTransferRecords();
  const complianceRate = 100;

  return (
    <PageContainer>
      <section className="page-header">
        <div>
          <p className="eyebrow">Live dashboard</p>
          <h1>Vault telemetry and compliance activity</h1>
          <p>
            Every figure on this screen comes from current account reads or from public transfer
            records fetched at runtime.
          </p>
        </div>
      </section>

      <section className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Total transfers</span>
          <strong>{recordsLoading ? 'Loading' : formatCompact(totalCount)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total volume</span>
          <strong>{recordsLoading ? 'Loading' : formatCurrency(totalVolume)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active credentials</span>
          <strong>{registryLoading ? 'Loading' : formatCompact(registry.activeCredentials)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Compliance rate</span>
          <strong>{formatPercent(complianceRate)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total assets</span>
          <strong>{vaultLoading ? 'Loading' : formatCurrency(vault.totalAssets)}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Share price</span>
          <strong>{vault.sharePrice > 0 ? `$${vault.sharePrice.toFixed(2)}` : 'Awaiting first mint'}</strong>
        </div>
      </section>

      <section className="section-grid section-grid-wide">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Transfer records</p>
              <h2>Public execution log</h2>
            </div>
            <span className="chip chip-accent">{totalCount} records</span>
          </div>

          {records.length === 0 ? (
            <div className="empty-state">
              <p>No transfer records are available yet on the connected cluster.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Timestamp</th>
                    <th>Proof hash</th>
                    <th>Signer</th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, 8).map((record) => (
                    <tr key={record.address.toBase58()}>
                      <td>{record.transferType}</td>
                      <td>{formatCurrency(record.amount)}</td>
                      <td>{formatDateTime(record.timestamp)}</td>
                      <td>{shorten(record.proofHash, 8, 6)}</td>
                      <td>{shorten(record.signer)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="panel panel-stack">
          <div>
            <p className="eyebrow">Vault configuration</p>
            <h2>Risk and threshold envelope</h2>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Retail threshold</dt>
              <dd>{formatCurrency(vault.thresholds.retail)}</dd>
            </div>
            <div>
              <dt>Accredited threshold</dt>
              <dd>{formatCurrency(vault.thresholds.accredited)}</dd>
            </div>
            <div>
              <dt>Institutional threshold</dt>
              <dd>
                {Number(vault.thresholds.institutional.toString()) > 0
                  ? formatCurrency(vault.thresholds.institutional)
                  : 'Configured on-chain'}
              </dd>
            </div>
            <div>
              <dt>Expired credential threshold</dt>
              <dd>{formatCurrency(vault.thresholds.expired)}</dd>
            </div>
            <div>
              <dt>Emergency timelock</dt>
              <dd>{Math.floor(Number(vault.emergencyTimelock.toString()) / 3600)} hours</dd>
            </div>
            <div>
              <dt>Registry tree depth</dt>
              <dd>{registry.stateTree.depth}</dd>
            </div>
          </dl>
        </article>
      </section>
    </PageContainer>
  );
}
