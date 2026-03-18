import { BN } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Keypair } from '@solana/web3.js';
import { useMemo, useState } from 'react';
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
import { useVaultState } from '../hooks/useVaultState';
import {
  buildConvertFromConfidentialTx,
  buildConvertToConfidentialTx,
  buildSetupConfidentialVaultTx,
  getPrograms,
} from '../lib/program';

type Mode = 'convert-to' | 'convert-from' | 'setup';

export default function Confidential() {
  const { toast } = useToast();
  const { data: vault, refresh } = useVaultState();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<Mode>('convert-to');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const numericAmount = useMemo(() => BigInt(Math.round(Number(amount || '0'))), [amount]);

  const handleSetup = async () => {
    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect a wallet with vault authority to set up confidential transfers.');
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const confidentialShareMint = Keypair.generate();
      const auditorElgamalPubkey = Array.from(vault.regulatorPubkeyX);

      const transaction = buildSetupConfidentialVaultTx({
        auditorElgamalPubkey,
        confidentialShareMint: confidentialShareMint.publicKey,
        program: vusdVault,
        signer: publicKey,
      });
      transaction.feePayer = publicKey;
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.partialSign(confidentialShareMint);

      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      toast({
        description: `Confidential share mint: ${confidentialShareMint.publicKey.toBase58()}`,
        title: 'Confidential vault configured',
        variant: 'success',
      });
      setStatus(`Confidential vault configured: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Setup failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleConvert = async () => {
    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect your wallet to convert shares.');
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const bnAmount = new BN(numericAmount.toString());

      const transaction =
        mode === 'convert-to'
          ? await buildConvertToConfidentialTx({ amount: bnAmount, program: vusdVault, signer: publicKey })
          : await buildConvertFromConfidentialTx({ amount: bnAmount, program: vusdVault, signer: publicKey });

      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();

      const label = mode === 'convert-to' ? 'Converted to confidential' : 'Converted from confidential';
      toast({ description: signature, title: label, variant: 'success' });
      setStatus(`${label}: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Conversion failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <Badge variant="secondary">Token-2022</Badge>
          <CardTitle className="mt-3">Confidential Transfers</CardTitle>
          <CardDescription>
            Convert vault shares between standard SPL tokens and Token-2022 confidential transfers.
            Confidential balances hide transfer amounts on-chain using ElGamal encryption while
            preserving auditability for the designated compliance auditor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex gap-2">
            {(['convert-to', 'convert-from', 'setup'] as const).map((option) => (
              <button
                key={option}
                className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                  mode === option
                    ? 'bg-elevated text-text-primary'
                    : 'text-text-secondary hover:bg-elevated/60'
                }`}
                onClick={() => {
                  setMode(option);
                  setStatus(null);
                }}
                type="button"
              >
                {option === 'convert-to'
                  ? 'To Confidential'
                  : option === 'convert-from'
                    ? 'From Confidential'
                    : 'Setup Vault'}
              </button>
            ))}
          </div>

          {mode === 'setup' ? (
            <div className="grid gap-5">
              <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                <p className="text-sm leading-6 text-text-secondary">
                  Initialize the confidential vault configuration. This creates a Token-2022 share
                  mint with the ConfidentialTransfer extension enabled and registers the vault&apos;s
                  regulator key as the auditor for encrypted balance decryption.
                </p>
              </div>
              <Button disabled={!publicKey || loading} onClick={handleSetup}>
                {loading ? 'Setting up...' : 'Setup Confidential Vault'}
              </Button>
            </div>
          ) : (
            <div className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="confidentialAmount">
                  Amount ({mode === 'convert-to' ? 'shares to encrypt' : 'shares to decrypt'})
                </Label>
                <Input
                  id="confidentialAmount"
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                  value={amount}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Direction</p>
                  <p className="mt-2 text-sm text-text-primary">
                    {mode === 'convert-to' ? 'SPL Token -> Token-2022 Confidential' : 'Token-2022 Confidential -> SPL Token'}
                  </p>
                </div>
                <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Extension</p>
                  <p className="mt-2 text-sm text-text-primary">ConfidentialTransfer (ElGamal)</p>
                </div>
              </div>

              <Button disabled={!publicKey || !amount || loading} onClick={handleConvert}>
                {loading
                  ? 'Processing...'
                  : mode === 'convert-to'
                    ? 'Convert to Confidential'
                    : 'Convert from Confidential'}
              </Button>
            </div>
          )}

          {status ? (
            <Alert
              className="mt-5"
              description={status}
              title={status.toLowerCase().includes('fail') ? 'Error' : 'Status'}
              variant={status.toLowerCase().includes('fail') ? 'destructive' : 'default'}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Badge variant="outline">How It Works</Badge>
          <CardTitle className="mt-3">Dual-mint architecture</CardTitle>
          <CardDescription>
            VaultProof uses two share mints — a standard SPL token and a Token-2022 confidential
            token — connected by a vault-controlled burn-and-mint bridge.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            'Standard shares use the SPL Token program with visible balances.',
            'Confidential shares use Token-2022 with ElGamal-encrypted balances.',
            'Converting burns one token type and mints the equivalent in the other.',
            'The compliance auditor can decrypt confidential balances with their ElGamal key.',
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
    </div>
  );
}
