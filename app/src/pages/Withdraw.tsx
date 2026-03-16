import { BN } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useEffect, useMemo, useState } from 'react';
import ProofGenerationModal from '../components/proof/ProofGenerationModal';
import PageContainer from '../components/layout/PageContainer';
import { useCredential } from '../hooks/useCredential';
import { useProofGeneration } from '../hooks/useProofGeneration';
import { useTransferRecords } from '../hooks/useTransferRecords';
import { useVaultState } from '../hooks/useVaultState';
import {
  buildEmergencyWithdrawExecuteTx,
  buildEmergencyWithdrawRequestTx,
  buildWithdrawTx,
  deriveOwnedTokenAddress,
  getPrograms,
  proofToOnchainFormat,
} from '../lib/program';

const EMERGENCY_DELAY_SECONDS = 72 * 60 * 60;

function formatCountdown(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    seconds,
  ).padStart(2, '0')}`;
}

export default function Withdraw() {
  const { credential } = useCredential();
  const { data: vault } = useVaultState();
  const { refresh } = useTransferRecords();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const proofGeneration = useProofGeneration();
  const [amount, setAmount] = useState('');
  const [targetWallet, setTargetWallet] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [emergencyRequestedAt, setEmergencyRequestedAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(EMERGENCY_DELAY_SECONDS);
  const [status, setStatus] = useState<string | null>(null);

  const numericAmount = useMemo(() => BigInt(Math.round(Number(amount || '0'))), [amount]);

  useEffect(() => {
    if (!emergencyRequestedAt) {
      return;
    }

    const interval = window.setInterval(() => {
      const unlockAt = emergencyRequestedAt + EMERGENCY_DELAY_SECONDS * 1000;
      const next = Math.max(0, Math.floor((unlockAt - Date.now()) / 1000));
      setTimeLeft(next);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [emergencyRequestedAt]);

  useEffect(() => {
    if (publicKey && !targetWallet) {
      setTargetWallet(publicKey.toBase58());
    }
  }, [publicKey, targetWallet]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setModalOpen(true);
    setStatus(null);

    if (!credential) {
      setStatus('Stage a credential before attempting a withdrawal.');
      return;
    }

    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect a wallet before submitting a withdrawal transaction.');
      return;
    }

    if (targetWallet && targetWallet !== publicKey.toBase58()) {
      setStatus('The current vault program redeems back to the connected wallet only.');
      return;
    }

    const proofResult = await proofGeneration.generate({
      amount: numericAmount,
      credential,
      recipient: targetWallet,
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
      const transaction = await buildWithdrawTx({
        program: vusdVault,
        proofA,
        proofB,
        proofC,
        publicInputs,
        shares: new BN(numericAmount.toString()),
        signer: publicKey,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      setStatus(`Withdrawal submitted: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Unable to submit withdrawal.');
    }
  };

  const handleEmergencyRequest = async () => {
    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect a wallet before requesting an emergency withdrawal.');
      return;
    }

    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const transaction = await buildEmergencyWithdrawRequestTx({
        program: vusdVault,
        signer: publicKey,
        stealthAccount: deriveOwnedTokenAddress(publicKey, vault.shareMint),
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      setEmergencyRequestedAt(Date.now());
      setTimeLeft(EMERGENCY_DELAY_SECONDS);
      setStatus(`Emergency withdrawal requested: ${signature}`);
    } catch (caughtError) {
      setStatus(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to request emergency withdrawal.',
      );
    }
  };

  const handleEmergencyExecute = async () => {
    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect a wallet before executing an emergency withdrawal.');
      return;
    }

    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const transaction = await buildEmergencyWithdrawExecuteTx({
        program: vusdVault,
        signer: publicKey,
        stealthAccount: deriveOwnedTokenAddress(publicKey, vault.shareMint),
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      setStatus(`Emergency withdrawal executed: ${signature}`);
    } catch (caughtError) {
      setStatus(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to execute emergency withdrawal.',
      );
    }
  };

  return (
    <PageContainer>
      <section className="page-header">
        <div>
          <p className="eyebrow">Withdraw flow</p>
          <h1>Redeem vault shares back to a main wallet</h1>
          <p>
            Standard withdrawals follow the same proof path as deposits and transfers. Emergency
            withdrawals preserve a 72-hour review window everywhere in the product.
          </p>
        </div>
      </section>

      <section className="section-grid section-grid-wide">
        <form className="panel form-panel" onSubmit={handleSubmit}>
          <label className="field">
            <span>Main wallet destination</span>
            <input
              className="input"
              onChange={(event) => setTargetWallet(event.target.value)}
              placeholder="Destination wallet public key"
              type="text"
              value={targetWallet}
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
            disabled={!credential || !targetWallet || !amount || !publicKey}
            type="submit"
          >
            Generate withdrawal proof
          </button>

          {proofGeneration.error ? <p className="inline-error">{proofGeneration.error}</p> : null}
          {status ? <p className="inline-note">{status}</p> : null}
        </form>

        <article className="panel panel-stack">
          <div>
            <p className="eyebrow">Emergency path</p>
            <h2>72-hour operator review</h2>
          </div>
          <p>
            Emergency withdrawals bypass browser proving but keep a 72-hour compliance review
            window. This page reflects the addendum timing change everywhere.
          </p>
          <button
            className="button button-secondary"
            onClick={handleEmergencyRequest}
            type="button"
          >
            Request emergency withdrawal
          </button>
          {emergencyRequestedAt && timeLeft === 0 ? (
            <button className="button" onClick={handleEmergencyExecute} type="button">
              Execute emergency withdrawal
            </button>
          ) : null}
          <div className="detail-list">
            <div>
              <dt>Timelock</dt>
              <dd>{Math.floor(Number(vault.emergencyTimelock.toString()) / 3600)} hours</dd>
            </div>
            <div>
              <dt>Countdown</dt>
              <dd>{emergencyRequestedAt ? formatCountdown(timeLeft) : 'Not requested'}</dd>
            </div>
          </div>
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
        title="Withdrawal proof generation"
      />
    </PageContainer>
  );
}
