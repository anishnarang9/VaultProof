import { useState } from 'react';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import PageContainer from '../components/layout/PageContainer';
import { useCredential } from '../hooks/useCredential';
import { useRegistryState } from '../hooks/useRegistryState';
import { hashCredentialLeaf } from '../lib/credential';
import { buildAddCredentialTx, getPrograms } from '../lib/program';
import type { AccreditationTier } from '../lib/types';

const accreditationOptions: Array<{ label: string; value: AccreditationTier }> = [
  { label: 'Retail', value: 'retail' },
  { label: 'Accredited', value: 'accredited' },
  { label: 'Institutional', value: 'institutional' },
];

export default function Credential() {
  const { credential, clearCredential, saveCredential } = useCredential();
  const { refresh } = useRegistryState();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const [fullName, setFullName] = useState(credential?.fullName ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(credential?.dateOfBirth ?? '1990-01-01');
  const [wallet, setWallet] = useState(credential?.wallet ?? '');
  const [jurisdiction, setJurisdiction] = useState(credential?.jurisdiction ?? '');
  const [countryCode, setCountryCode] = useState(credential?.countryCode ?? 'US');
  const [identitySecret, setIdentitySecret] = useState(
    credential?.identitySecret ?? `${Date.now()}${Math.floor(Math.random() * 10_000)}`,
  );
  const [accreditation, setAccreditation] = useState<AccreditationTier>(
    credential?.accreditation ?? 'accredited',
  );
  const [expiresAt, setExpiresAt] = useState(
    credential?.expiresAt ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function hexToBytes(value: string) {
    const normalized = value.replace(/^0x/, '').padStart(64, '0');
    return Array.from(
      { length: normalized.length / 2 },
      (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16),
    );
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setStatus(null);

    try {
      const expiresAtIso = new Date(expiresAt).toISOString();
      const issuedAt = new Date().toISOString();
      const leafHash = await hashCredentialLeaf({
        fullName,
        dateOfBirth,
        wallet,
        jurisdiction,
        countryCode,
        accreditation,
        expiresAt: expiresAtIso,
        identitySecret,
      });

      saveCredential({
        fullName,
        dateOfBirth,
        wallet,
        jurisdiction,
        countryCode,
        accreditation,
        issuedAt,
        expiresAt: expiresAtIso,
        leafHash,
        identitySecret,
        note: 'Browser-staged credential. Production flow moves issuance to the operator console and secure storage.',
      });

      if (!anchorWallet || !publicKey || !sendTransaction) {
        setStatus(
          'Credential leaf staged locally. Connect the registry authority wallet to submit add_credential on-chain.',
        );
        return;
      }

      const { kycRegistry } = getPrograms(connection, anchorWallet);
      const transaction = await buildAddCredentialTx({
        leafHash: hexToBytes(leafHash),
        program: kycRegistry,
        signer: publicKey,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      setStatus(`Credential leaf staged locally and submitted on-chain: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Unable to stage credential.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageContainer>
      <section className="page-header">
        <div>
          <p className="eyebrow">Credential staging</p>
          <h1>Prepare a wallet-bound compliance credential</h1>
          <p>
            The leaf hash binds jurisdiction, accreditation tier, expiry, and wallet into a single
            browser-generated artifact. Production issuance moves to the registry operator.
          </p>
        </div>
      </section>

      <section className="section-grid section-grid-wide">
        <form className="panel form-panel" onSubmit={handleSubmit}>
          <label className="field">
            <span>Full legal name</span>
            <input
              className="input"
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Jane Doe"
              type="text"
              value={fullName}
            />
          </label>

          <label className="field">
            <span>Date of birth</span>
            <input
              className="input"
              onChange={(event) => setDateOfBirth(event.target.value)}
              type="date"
              value={dateOfBirth}
            />
          </label>

          <label className="field">
            <span>Wallet public key</span>
            <input
              className="input"
              onChange={(event) => setWallet(event.target.value)}
              placeholder="Main wallet public key"
              type="text"
              value={wallet}
            />
          </label>

          <label className="field">
            <span>Jurisdiction</span>
            <input
              className="input"
              onChange={(event) => setJurisdiction(event.target.value)}
              placeholder="United States"
              type="text"
              value={jurisdiction}
            />
          </label>

          <div className="form-row">
            <label className="field">
              <span>Country code</span>
              <input
                className="input"
                maxLength={2}
                onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
                placeholder="CH"
                type="text"
                value={countryCode}
              />
            </label>

            <label className="field">
              <span>Accreditation tier</span>
              <select
                className="input"
                onChange={(event) => setAccreditation(event.target.value as AccreditationTier)}
                value={accreditation}
              >
                {accreditationOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Expires on</span>
            <input
              className="input"
              onChange={(event) => setExpiresAt(event.target.value)}
              type="date"
              value={expiresAt}
            />
          </label>

          <label className="field">
            <span>Identity secret</span>
            <input
              className="input"
              onChange={(event) => setIdentitySecret(event.target.value.replace(/[^\d]/g, ''))}
              type="text"
              value={identitySecret}
            />
          </label>

          <div className="action-row">
            <button
              className="button"
              disabled={isSaving || !fullName || !wallet || !jurisdiction}
              type="submit"
            >
              {isSaving ? 'Submitting...' : 'Issue credential'}
            </button>
            <button className="button button-secondary" onClick={clearCredential} type="button">
              Clear local copy
            </button>
          </div>

          {status ? <p className="inline-note">{status}</p> : null}
        </form>

        <article className="panel panel-stack">
          <div>
            <p className="eyebrow">Current staged credential</p>
            <h2>Local-only hackathon storage</h2>
          </div>
          <p className="inline-note">
            {publicKey
              ? `Registry authority connected: ${publicKey.toBase58()}`
              : 'Connect the registry authority wallet to submit add_credential on-chain.'}
          </p>

          {credential ? (
            <dl className="detail-list">
              <div>
                <dt>Name</dt>
                <dd>{credential.fullName}</dd>
              </div>
              <div>
                <dt>Wallet</dt>
                <dd>{credential.wallet}</dd>
              </div>
              <div>
                <dt>Date of birth</dt>
                <dd>{new Date(credential.dateOfBirth).toLocaleDateString('en-US')}</dd>
              </div>
              <div>
                <dt>Jurisdiction</dt>
                <dd>{credential.jurisdiction}</dd>
              </div>
              <div>
                <dt>Accreditation</dt>
                <dd>{credential.accreditation}</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>{new Date(credential.expiresAt).toLocaleDateString('en-US')}</dd>
              </div>
              <div>
                <dt>Leaf hash</dt>
                <dd className="mono-copy">{credential.leafHash}</dd>
              </div>
            </dl>
          ) : (
            <div className="empty-state">
              <p>No credential has been staged in this browser yet.</p>
            </div>
          )}
        </article>
      </section>
    </PageContainer>
  );
}
