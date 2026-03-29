import { BN } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useEffect, useState } from 'react';
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
import { formatCurrency } from '../lib/format';
import {
  buildUnpauseVaultTx,
  buildUpdateRiskLimitsTx,
  getPrograms,
} from '../lib/program';

function usageColor(usage: number) {
  if (usage > 0.8) {
    return 'bg-warning';
  }

  if (usage > 0.5) {
    return 'bg-accent';
  }

  return 'bg-success';
}

export default function OperatorRisk() {
  const { toast } = useToast();
  const { data: vault, refresh } = useVaultState();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const [threshold, setThreshold] = useState(vault.circuitBreakerThreshold.toString());
  const [singleTx, setSingleTx] = useState(vault.maxSingleTransaction.toString());
  const [singleDeposit, setSingleDeposit] = useState(vault.maxSingleDeposit.toString());
  const [maxDailyTransactions, setMaxDailyTransactions] = useState(
    String(vault.maxDailyTransactions),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setThreshold(vault.circuitBreakerThreshold.toString());
    setSingleTx(vault.maxSingleTransaction.toString());
    setSingleDeposit(vault.maxSingleDeposit.toString());
    setMaxDailyTransactions(String(vault.maxDailyTransactions));
  }, [
    vault.circuitBreakerThreshold,
    vault.maxDailyTransactions,
    vault.maxSingleDeposit,
    vault.maxSingleTransaction,
  ]);

  const handleUpdateRiskLimits = async () => {
    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect wallet to manage vault.');
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const transaction = await buildUpdateRiskLimitsTx({
        circuitBreaker: new BN(threshold || '0'),
        maxDailyTxns: Number(maxDailyTransactions || '0'),
        maxSingleDeposit: new BN(singleDeposit || '0'),
        maxSingleTx: new BN(singleTx || '0'),
        program: vusdVault,
        signer: publicKey,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      toast({
        description: signature,
        title: 'Risk limits updated',
        variant: 'success',
      });
      setStatus(`Risk limits updated: ${signature}`);
    } catch (caughtError) {
      setStatus(
        caughtError instanceof Error ? caughtError.message : 'Unable to update risk limits.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnpauseVault = async () => {
    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect wallet to manage vault.');
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const transaction = await buildUnpauseVaultTx({
        program: vusdVault,
        signer: publicKey,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      toast({
        description: signature,
        title: 'Vault unpaused',
        variant: 'success',
      });
      setStatus(`Vault unpaused: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Unable to unpause vault.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <Badge variant="secondary">Risk Controls</Badge>
          <CardTitle className="mt-3">Circuit breaker and transaction limits</CardTitle>
          <CardDescription>
            Update live vault limits and clear the pause state once operator conditions are back in
            bounds.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {!publicKey ? (
            <Alert
              description="Connect wallet to manage vault."
              title="Connect wallet to manage vault"
              variant="default"
            />
          ) : null}

          {status ? (
            <Alert
              description={status}
              title={status.toLowerCase().includes('unable') ? 'Risk action failed' : 'Risk action status'}
              variant={status.toLowerCase().includes('unable') ? 'destructive' : 'default'}
            />
          ) : null}

          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="threshold">Circuit breaker threshold</Label>
              <Input
                disabled={isSubmitting}
                id="threshold"
                onChange={(event) => setThreshold(event.target.value)}
                value={threshold}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="singleTx">Max single transaction</Label>
              <Input
                disabled={isSubmitting}
                id="singleTx"
                onChange={(event) => setSingleTx(event.target.value)}
                value={singleTx}
              />
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="singleDeposit">Max single deposit</Label>
              <Input
                disabled={isSubmitting}
                id="singleDeposit"
                onChange={(event) => setSingleDeposit(event.target.value)}
                value={singleDeposit}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="maxDailyTransactions">Max daily transactions</Label>
              <Input
                disabled={isSubmitting}
                id="maxDailyTransactions"
                onChange={(event) => setMaxDailyTransactions(event.target.value)}
                value={maxDailyTransactions}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={!publicKey || isSubmitting}
              onClick={() => {
                void handleUpdateRiskLimits();
              }}
              type="button"
            >
              Update Risk Limits
            </Button>
            <Button
              disabled={!publicKey || isSubmitting || !vault.paused}
              onClick={() => {
                void handleUnpauseVault();
              }}
              type="button"
              variant="secondary"
            >
              Unpause Vault
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Badge variant="outline">Current Status</Badge>
          <CardTitle className="mt-3">Circuit breaker proximity</CardTitle>
          <CardDescription>
            Daily outflow total, window start, and current proximity to trigger.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="rounded-[var(--radius)] border border-border bg-bg-primary p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-text-secondary">Usage</span>
              <span className="text-sm text-text-primary">
                {(vault.circuitBreakerUsage * 100).toFixed(0)}%
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-elevated">
              <div
                className={`${usageColor(vault.circuitBreakerUsage)} h-full rounded-full`}
                style={{ width: `${Math.min(100, vault.circuitBreakerUsage * 100)}%` }}
              />
            </div>
          </div>

          <Alert
            description={`Daily outflow: ${formatCurrency(vault.dailyOutflowTotal)} • Threshold: ${formatCurrency(vault.circuitBreakerThreshold)}`}
            title={vault.paused ? 'Vault paused' : 'Vault operational'}
            variant={vault.paused ? 'destructive' : 'default'}
          />
        </CardContent>
      </Card>
    </div>
  );
}
