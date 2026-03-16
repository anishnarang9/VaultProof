import { BN } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useMemo, useState } from 'react';
import ProofGenerationModal from '../components/proof/ProofGenerationModal';
import PageContainer from '../components/layout/PageContainer';
import { useCredential } from '../hooks/useCredential';
import { useProofGeneration } from '../hooks/useProofGeneration';
import { useVaultState } from '../hooks/useVaultState';
import { formatCurrency } from '../lib/format';
import { buildDepositTx, getPrograms, proofToOnchainFormat } from '../lib/program';

export default function Deposit() {
  const { data: vault, refresh } = useVaultState();
  const { credential } = useCredential();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const [amount, setAmount] = useState('25000');
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const proofGeneration = useProofGeneration();

  const numericAmount = useMemo(() => BigInt(Math.round(Number(amount || '0'))), [amount]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setModalOpen(true);
    setStatus(null);

    if (!credential) {
      setStatus('Stage a credential before attempting a deposit.');
      return;
    }

    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect a wallet before submitting a deposit transaction.');
      return;
    }

    const proofResult = await proofGeneration.generate({
      amount: numericAmount,
      credential,
      recipient: 'vault_reserve',
      thresholds: vault.thresholds,
      regulatorPubkey: vault.regulatorKey,
    });

    if (!proofResult) {
      return;
    }

    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const { proofA, proofB, proofC, publicInputs } = proofToOnchainFormat(
        proofResult.proof,
        proofResult.publicSignals,
      );
      const transaction = await buildDepositTx({
        amount: new BN(numericAmount.toString()),
        encryptedMetadata: proofResult.encryptedMetadata,
        program: vusdVault,
        proofA,
        proofB,
        proofC,
        publicInputs,
        signer: publicKey,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      setStatus(`Deposit submitted: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Unable to submit deposit.');
    }
  };

  return (
    <PageContainer>
      <section className="page-header">
        <div>
          <p className="eyebrow">Deposit flow</p>
          <h1>Deposit into the vault</h1>
          <p>
            Deposits mint vault shares after the browser assembles public inputs, generates the
            proof, and encrypts compliance metadata for authorized review.
          </p>
        </div>
      </section>

      <section className="section-grid section-grid-wide">
        <form className="panel form-panel" onSubmit={handleSubmit}>
          <label className="field">
            <span>Deposit amount (USDC)</span>
            <input
              className="input"
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
              type="text"
              value={amount}
            />
          </label>

          <div className="detail-list">
            <div>
              <dt>Current share price</dt>
              <dd>{vault.sharePrice > 0 ? `$${vault.sharePrice.toFixed(2)}` : 'Awaiting first mint'}</dd>
            </div>
            <div>
              <dt>Retail threshold</dt>
              <dd>{formatCurrency(vault.thresholds.retail)}</dd>
            </div>
            <div>
              <dt>Accredited threshold</dt>
              <dd>{formatCurrency(vault.thresholds.accredited)}</dd>
            </div>
          </div>

          <div className="warning-banner">
            <p>
              {!publicKey
                ? 'Connect a wallet to submit the deposit transaction.'
                : credential
                  ? `Credential loaded for ${credential.fullName} on ${credential.wallet}.`
                  : 'Stage a credential first. Proof generation needs a wallet-bound credential.'}
            </p>
          </div>

          <button className="button" disabled={!credential || !amount || !publicKey} type="submit">
            Generate Proof and Deposit
          </button>

          {proofGeneration.error ? <p className="inline-error">{proofGeneration.error}</p> : null}
          {status ? <p className="inline-note">{status}</p> : null}
        </form>

        <article className="panel panel-stack">
          <div>
            <p className="eyebrow">What happens</p>
            <h2>Execution path</h2>
          </div>
          <ol className="ordered-list">
            <li>Read the current registry root and vault thresholds from Solana.</li>
            <li>Build the circuit witness with the staged credential and deposit amount.</li>
            <li>Run browser-side proving with `snarkjs` when circuit artifacts are available.</li>
            <li>Store the proof buffer and submit `deposit_with_proof` on-chain.</li>
          </ol>
        </article>
      </section>

      <ProofGenerationModal
        error={proofGeneration.error}
        isGenerating={proofGeneration.isGenerating}
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          proofGeneration.reset();
        }}
        proofTime={proofGeneration.proofTime}
        steps={proofGeneration.timeline}
        title="Deposit proof generation"
      />
    </PageContainer>
  );
}
