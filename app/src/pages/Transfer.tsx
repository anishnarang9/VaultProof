import { BN } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
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
import { useTransferRecords } from '../hooks/useTransferRecords';
import { useVaultState } from '../hooks/useVaultState';
import { buildTransferTx, getPrograms, proofToOnchainFormat } from '../lib/program';

export default function Transfer() {
  const { toast } = useToast();
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
      setStatus('Load or stage a credential before attempting a transfer.');
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
      toast({
        description: signature,
        title: 'Transfer submitted',
        variant: 'success',
      });
      setStatus(`Transfer submitted: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Unable to submit transfer.');
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <Badge variant="secondary">Transfer</Badge>
          <CardTitle className="mt-3">Transfer shares with proof</CardTitle>
          <CardDescription>
            Preserve confidential identity while keeping an auditable TransferRecord and encrypted
            Travel Rule payload for compliance review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="recipient">Recipient Address</Label>
              <Input
                id="recipient"
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="Recipient public key"
                value={recipient}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="amount">Amount (vault shares)</Label>
              <Input
                id="amount"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                value={amount}
              />
            </div>

            {status ? (
              <Alert
                description={status}
                title={status.toLowerCase().includes('unable') ? 'Transfer failed' : 'Transfer status'}
                variant={status.toLowerCase().includes('unable') ? 'destructive' : 'default'}
              />
            ) : null}

            <Button disabled={!credential || !recipient || !amount || !publicKey} type="submit">
              Generate Transfer Proof
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Badge variant="outline">Visibility Model</Badge>
          <CardTitle className="mt-3">What the chain sees</CardTitle>
          <CardDescription>
            Proof hashes and transfer records are public. Identity, accreditation, and source-of-funds
            references remain inside the witness or encrypted payload.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {[
            'TransferRecord existence and proof hash are public.',
            'Balances on the vault-share token accounts remain visible.',
            'Travel Rule metadata stays encrypted until authorized decryption.',
          ].map((item) => (
            <div
              key={item}
              className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4 text-sm leading-6 text-text-secondary"
            >
              {item}
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
        title="Transfer proof generation"
      />
    </div>
  );
}
