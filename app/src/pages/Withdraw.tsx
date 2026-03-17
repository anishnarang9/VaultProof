import { BN } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useEffect, useMemo, useState } from 'react';
import ProofGenerationModal from '../components/proof/ProofGenerationModal';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '../components/ui/primitives';
import { useToast } from '../components/ui/primitives';
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
  const { toast } = useToast();
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
  const expectedUsdcOutput = useMemo(
    () => (Number.isFinite(vault.sharePrice) ? Number(amount || 0) * vault.sharePrice : 0),
    [amount, vault.sharePrice],
  );

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
      setStatus('Load or stage a credential before attempting a withdrawal.');
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
      toast({
        description: signature,
        title: 'Withdrawal submitted',
        variant: 'success',
      });
      setStatus(`Withdrawal submitted: ${signature}`);
    } catch (caughtError) {
      setStatus(
        caughtError instanceof Error ? caughtError.message : 'Unable to submit withdrawal.',
      );
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
      toast({
        description: signature,
        title: 'Emergency withdrawal requested',
        variant: 'warning',
      });
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
      toast({
        description: signature,
        title: 'Emergency withdrawal executed',
        variant: 'success',
      });
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
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader>
          <Badge variant="secondary">Withdraw</Badge>
          <CardTitle className="mt-3">Withdraw with proof or emergency hatch</CardTitle>
          <CardDescription>
            Standard withdrawals follow the proof path. Emergency withdrawals keep a 72-hour review
            window before execution.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="wallet">Destination Wallet</Label>
              <Input
                id="wallet"
                onChange={(event) => setTargetWallet(event.target.value)}
                value={targetWallet}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="amount">Shares to Burn</Label>
              <Input
                id="amount"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                value={amount}
              />
            </div>

            <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Expected USDC Output</p>
              <p className="mt-2 text-sm text-text-primary">${expectedUsdcOutput.toFixed(2)}</p>
            </div>

            {status ? (
              <Alert
                description={status}
                title={status.toLowerCase().includes('unable') ? 'Withdrawal failed' : 'Withdrawal status'}
                variant={status.toLowerCase().includes('unable') ? 'destructive' : 'default'}
              />
            ) : null}

            <Button disabled={!credential || !targetWallet || !amount || !publicKey} type="submit">
              Generate Withdrawal Proof
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Badge variant="outline">Emergency Path</Badge>
          <CardTitle className="mt-3">72-hour timelock</CardTitle>
          <CardDescription>
            Request the emergency path when proof generation is unavailable, then execute after the
            mandated review window.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Timelock</p>
            <p className="mt-2 text-sm text-text-primary">
              {Math.floor(Number(vault.emergencyTimelock.toString()) / 3600)} hours
            </p>
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Countdown</p>
            <p className="mt-2 font-mono text-sm text-text-primary">
              {emergencyRequestedAt ? formatCountdown(timeLeft) : 'Not requested'}
            </p>
          </div>
          <Button onClick={handleEmergencyRequest} type="button" variant="secondary">
            Request Emergency Withdrawal
          </Button>
          {emergencyRequestedAt && timeLeft === 0 ? (
            <Button onClick={handleEmergencyExecute} type="button">
              Execute Emergency Withdrawal
            </Button>
          ) : null}
        </CardContent>
      </Card>

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
    </div>
  );
}
