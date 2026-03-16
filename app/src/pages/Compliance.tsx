import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useMemo, useState } from 'react';
import PageContainer from '../components/layout/PageContainer';
import { useRegistryState } from '../hooks/useRegistryState';
import { useTransferRecords } from '../hooks/useTransferRecords';
import { useVaultState } from '../hooks/useVaultState';
import { formatCurrency, formatDateTime, shorten } from '../lib/format';
import { buildAuthorizeDecryptionTx, getPrograms } from '../lib/program';

export default function Compliance() {
  const { data: vault } = useVaultState();
  const { data: registry } = useRegistryState();
  const { records, refresh } = useTransferRecords();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const programs = useMemo(
    () => (anchorWallet ? getPrograms(connection, anchorWallet) : null),
    [anchorWallet, connection],
  );
  const [status, setStatus] = useState<string | null>(null);

  const handleAuthorize = async (transferRecord: typeof records[number]['address']) => {
    if (!programs || !publicKey || !sendTransaction) {
      setStatus('Connect the compliance authority wallet to authorize decryption.');
      return;
    }

    try {
      const transaction = await buildAuthorizeDecryptionTx({
        program: programs.complianceAdmin,
        signer: publicKey,
        transferRecord,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      setStatus(`Decryption authorization submitted: ${signature}`);
    } catch (caughtError) {
      setStatus(
        caughtError instanceof Error ? caughtError.message : 'Unable to authorize decryption.',
      );
    }
  };

  return (
    <PageContainer>
      <section className="page-header">
        <div>
          <p className="eyebrow">Compliance view</p>
          <h1>Confidential identity, visible audit trail</h1>
          <p>
            VaultProof keeps identities and credential data off-chain while exposing balances,
            transfer records, thresholds, and review policy to the chain.
          </p>
        </div>
      </section>

      <section className="section-grid">
        <article className="panel panel-stack">
          <div>
            <p className="eyebrow">What is confidential</p>
            <h2>Hidden by design</h2>
          </div>
          <ul className="list">
            <li>Identity and KYC source documents never hit the chain.</li>
            <li>Credential details such as accreditation and jurisdiction stay inside the witness.</li>
            <li>The travel rule payload is encrypted for regulated review.</li>
          </ul>
        </article>

        <article className="panel panel-stack">
          <div>
            <p className="eyebrow">What remains visible</p>
            <h2>Public by necessity</h2>
          </div>
          <ul className="list">
            <li>Vault share balances on stealth accounts remain visible for institutional reporting.</li>
            <li>TransferRecord accounts are public and auditable.</li>
            <li>Emergency withdrawals expose their 72-hour review window.</li>
          </ul>
        </article>
      </section>

      <section className="section-grid section-grid-wide">
        <article className="panel panel-stack">
          <div>
            <p className="eyebrow">Registry and vault posture</p>
            <h2>Current control plane</h2>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Merkle root</dt>
              <dd className="mono-copy">{registry.merkleRootHex || 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Active credentials</dt>
              <dd>{registry.activeCredentials.toString()}</dd>
            </div>
            <div>
              <dt>Emergency timelock</dt>
              <dd>{Math.floor(Number(vault.emergencyTimelock.toString()) / 3600)} hours</dd>
            </div>
            <div>
              <dt>Retail threshold</dt>
              <dd>{formatCurrency(vault.thresholds.retail)}</dd>
            </div>
          </dl>
          {status ? <p className="inline-note">{status}</p> : null}
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Recent public records</p>
              <h2>TransferRecord feed</h2>
            </div>
          </div>

          {records.length === 0 ? (
            <div className="empty-state">
              <p>No transfer records were returned by the connected cluster.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Time</th>
                    <th>Proof hash</th>
                    <th>Authorized</th>
                    <th>Metadata</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, 6).map((record) => (
                    <tr key={record.address.toBase58()}>
                      <td>{record.transferType}</td>
                      <td>{formatDateTime(record.timestamp)}</td>
                      <td>{shorten(record.proofHash, 8, 8)}</td>
                      <td>{record.decryptionAuthorized ? 'Authorized' : 'Restricted'}</td>
                      <td>{shorten(record.encryptedMetadata, 8, 8)}</td>
                      <td>
                        <button
                          className="button button-secondary"
                          disabled={record.decryptionAuthorized || !publicKey}
                          onClick={() => {
                            void handleAuthorize(record.address);
                          }}
                          type="button"
                        >
                          {record.decryptionAuthorized ? 'Authorized' : 'Authorize'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </PageContainer>
  );
}
