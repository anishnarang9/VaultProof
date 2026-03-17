import { BN } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useMemo, useState } from 'react';
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
import { useVaultState } from '../hooks/useVaultState';
import { formatCurrency } from '../lib/format';
import { buildDepositTx, getPrograms, proofToOnchainFormat } from '../lib/program';
import type { StoredCredential } from '../lib/types';

async function readCredentialFile(file: File): Promise<StoredCredential> {
  const text = await file.text();
  return JSON.parse(text) as StoredCredential;
}

export default function Deposit() {
  const { toast } = useToast();
  const { data: vault, refresh } = useVaultState();
  const { credential, saveCredential } = useCredential();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const [amount, setAmount] = useState('25000');
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const proofGeneration = useProofGeneration();

  const numericAmount = useMemo(() => BigInt(Math.round(Number(amount || '0'))), [amount]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const nextCredential = await readCredentialFile(file);
      saveCredential(nextCredential);
      toast({
        description: file.name,
        title: 'Credential file loaded',
        variant: 'success',
      });
    } catch (caughtError) {
      setStatus(
        caughtError instanceof Error ? caughtError.message : 'Unable to load credential file.',
      );
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setModalOpen(true);
    setStatus(null);

    if (!credential) {
      setStatus('Load a credential file or use the staged local credential before depositing.');
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
      toast({
        description: signature,
        title: 'Deposit submitted',
        variant: 'success',
      });
      setStatus(`Deposit submitted: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Unable to submit deposit.');
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_360px]">
      <Card>
        <CardHeader>
          <Badge variant="secondary">Deposit</Badge>
          <CardTitle className="mt-3">Deposit USDC with proof</CardTitle>
          <CardDescription>
            Generate a Groth16 proof with credential version and source-of-funds hash in the witness,
            then submit the deposit transaction to mint vault shares.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="amount">Amount (USDC)</Label>
              <Input
                id="amount"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                value={amount}
              />
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="credentialUpload">Credential File</Label>
                <Input id="credentialUpload" onChange={handleUpload} type="file" />
              </div>
              <div className="grid gap-2">
                <Label>Loaded Credential</Label>
                <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-3 text-sm text-text-secondary">
                  {credential ? credential.fullName : 'Using local storage if available'}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Share Price</p>
                <p className="mt-2 text-sm text-text-primary">
                  {vault.sharePrice > 0 ? `$${vault.sharePrice.toFixed(3)}` : 'Awaiting first mint'}
                </p>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Retail Threshold</p>
                <p className="mt-2 text-sm text-text-primary">{formatCurrency(vault.thresholds.retail)}</p>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Accredited Threshold</p>
                <p className="mt-2 text-sm text-text-primary">{formatCurrency(vault.thresholds.accredited)}</p>
              </div>
            </div>

            {status ? (
              <Alert
                description={status}
                title={status.toLowerCase().includes('unable') ? 'Deposit failed' : 'Deposit status'}
                variant={status.toLowerCase().includes('unable') ? 'destructive' : 'default'}
              />
            ) : null}

            <Button disabled={!credential || !amount || !publicKey} type="submit">
              Generate Proof and Deposit
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Badge variant="outline">Proof Flow</Badge>
          <CardTitle className="mt-3">Execution path</CardTitle>
          <CardDescription>
            A restrained progress modal tracks proof generation with context reads, witness
            assembly, metadata encryption, and transaction submission.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            'Fetch the current registry root and vault thresholds from Solana.',
            'Build the witness with credential version and source-of-funds hash.',
            'Generate the proof and encrypted Travel Rule metadata in-browser.',
            'Submit deposit_with_proof and confirm the share mint.',
          ].map((step, index) => (
            <div
              key={step}
              className="flex gap-3 rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4"
            >
              <span className="font-mono text-xs text-text-tertiary">0{index + 1}</span>
              <p className="text-sm leading-6 text-text-secondary">{step}</p>
            </div>
          ))}
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
        title="Deposit proof generation"
      />
    </div>
  );
}
