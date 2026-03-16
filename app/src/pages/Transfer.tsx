import { BN } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useMemo, useState } from 'react';
import ProofGenerationModal from '../components/proof/ProofGenerationModal';
import PageContainer from '../components/layout/PageContainer';
import { useCredential } from '../hooks/useCredential';
import { useProofGeneration } from '../hooks/useProofGeneration';
import { useTransferRecords } from '../hooks/useTransferRecords';
import { useVaultState } from '../hooks/useVaultState';
import { buildTransferTx, getPrograms, proofToOnchainFormat } from '../lib/program';

export default function Transfer() {
  const { credential } = useCredential();
  const { data: vault } = useVaultState();
  const { refresh } = useTransferRecords();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const proofGeneration = useProofGeneration();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const numericAmount = useMemo(() => BigInt(Math.round(Number(amount || '0'))), [amount]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setModalOpen(true);
    setStatus(null);

    if (!credential) {
      setStatus('Stage a credential before attempting a transfer.');
      return;
    }

    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect a wallet before submitting a transfer transaction.');
      return;
    }

    const proofResult = await proofGeneration.generate({
      amount: numericAmount,
      credential,
      recipient,
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
      const transaction = await buildTransferTx({
        amount: new BN(numericAmount.toString()),
        encryptedMetadata: proofResult.encryptedMetadata,
        program: vusdVault,
        proofA,
        proofB,
        proofC,
        publicInputs,
        recipient: new PublicKey(recipient),
        signer: publicKey,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      setStatus(`Transfer submitted: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Unable to submit transfer.');
    }
  };

  return (
    <PageContainer>
      <section className="page-header">
        <div>
          <p className="eyebrow">Stealth transfer</p>
          <h1>Move vault shares between verified participants</h1>
          <p>
            Transfers keep identity confidential while preserving a public compliance record and
            a regulator-readable encrypted payload.
          </p>
        </div>
      </section>

      <section className="section-grid section-grid-wide">
        <form className="panel form-panel" onSubmit={handleSubmit}>
          <label className="field">
            <span>Recipient stealth address</span>
            <input
              className="input"
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="Stealth recipient public key"
              type="text"
              value={recipient}
            />
          </label>

          <label className="field">
            <span>Amount (vault shares)</span>
            <input
              className="input"
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0"
              type="text"
              value={amount}
            />
          </label>

          <button
            className="button"
            disabled={!credential || !recipient || !amount || !publicKey}
            type="submit"
          >
            Generate transfer proof
          </button>

          {proofGeneration.error ? <p className="inline-error">{proofGeneration.error}</p> : null}
          {status ? <p className="inline-note">{status}</p> : null}
        </form>

        <article className="panel panel-stack">
          <div>
            <p className="eyebrow">Visibility model</p>
            <h2>What the chain exposes</h2>
          </div>
          <ul className="list">
            <li>TransferRecord existence and proof hash remain public.</li>
            <li>Vault share balances on stealth accounts are visible.</li>
            <li>Identity, accreditation, and metadata stay encrypted or off-chain.</li>
          </ul>
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
        title="Transfer proof generation"
      />
    </PageContainer>
  );
}
