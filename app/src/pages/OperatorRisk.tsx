import { BN } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '../components/ui/primitives';
import { useToast } from '../components/ui/primitives';
import { useVaultState } from '../hooks/useVaultState';
import { formatCurrency } from '../lib/format';
import { buildUpdateRiskLimitsTx, buildUnpauseVaultTx, getPrograms } from '../lib/program';

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
  const vaultState = useVaultState();
  const { data: vault } = vaultState;
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();

  const [threshold, setThreshold] = useState(vault.circuitBreakerThreshold.toString());
  const [singleTx, setSingleTx] = useState(vault.maxSingleTransaction.toString());
  const [singleDeposit, setSingleDeposit] = useState(vault.maxSingleDeposit.toString());
  const [maxDailyTransactions, setMaxDailyTransactions] = useState(String(vault.maxDailyTransactions));
  const [updatingLimits, setUpdatingLimits] = useState(false);
  const [unpausing, setUnpausing] = useState(false);

  const handleUpdateRiskLimits = async () => {
    if (!anchorWallet || !publicKey || !sendTransaction) {
      toast({
        description: 'Connect an operator wallet to update risk limits.',
        title: 'Wallet not connected',
        variant: 'destructive',
      });
      return;
    }

    setUpdatingLimits(true);
    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const transaction = buildUpdateRiskLimitsTx({
        program: vusdVault,
        circuitBreakerThreshold: new BN(threshold),
        maxSingleTransaction: new BN(singleTx),
        maxSingleDeposit: new BN(singleDeposit),
        maxDailyTransactions: Number(maxDailyTransactions),
        signer: publicKey,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      toast({
        description: signature,
        title: 'Risk limits updated',
        variant: 'success',
      });
      vaultState.refresh();
    } catch (caughtError) {
      toast({
        description:
          caughtError instanceof Error ? caughtError.message : 'Transaction failed.',
        title: 'Risk limits update failed',
        variant: 'destructive',
      });
    } finally {
      setUpdatingLimits(false);
    }
  };

  const handleUnpause = async () => {
    if (!anchorWallet || !publicKey || !sendTransaction) {
      toast({
        description: 'Connect an operator wallet to unpause the vault.',
        title: 'Wallet not connected',
        variant: 'destructive',
      });
      return;
    }

    setUnpausing(true);
    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const transaction = buildUnpauseVaultTx({
        program: vusdVault,
        signer: publicKey,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      toast({
        description: signature,
        title: 'Vault unpaused',
        variant: 'success',
      });
      vaultState.refresh();
    } catch (caughtError) {
      toast({
        description:
          caughtError instanceof Error ? caughtError.message : 'Transaction failed.',
        title: 'Unpause failed',
        variant: 'destructive',
      });
    } finally {
      setUnpausing(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <Badge variant="secondary">Risk Controls</Badge>
          <CardTitle className="mt-3">Circuit breaker and transaction limits</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="threshold">Circuit breaker threshold</Label>
              <Input id="threshold" onChange={(event) => setThreshold(event.target.value)} value={threshold} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="singleTx">Max single transaction</Label>
              <Input id="singleTx" onChange={(event) => setSingleTx(event.target.value)} value={singleTx} />
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="singleDeposit">Max single deposit</Label>
              <Input
                id="singleDeposit"
                onChange={(event) => setSingleDeposit(event.target.value)}
                value={singleDeposit}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="maxDailyTransactions">Max daily transactions</Label>
              <Input
                id="maxDailyTransactions"
                onChange={(event) => setMaxDailyTransactions(event.target.value)}
                value={maxDailyTransactions}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={updatingLimits}
              onClick={handleUpdateRiskLimits}
              type="button"
            >
              {updatingLimits ? 'Submitting...' : 'Update Risk Limits'}
            </Button>
            <Button
              disabled={!vault.paused || unpausing}
              onClick={handleUnpause}
              type="button"
              variant="secondary"
            >
              {unpausing ? 'Unpausing...' : 'Unpause Vault'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Badge variant="outline">Current Status</Badge>
          <CardTitle className="mt-3">Circuit breaker proximity</CardTitle>
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
            description={`Daily outflow: ${formatCurrency(vault.dailyOutflowTotal)} \u2022 Threshold: ${formatCurrency(vault.circuitBreakerThreshold)}`}
            title={vault.paused ? 'Vault paused' : 'Vault operational'}
            variant={vault.paused ? 'destructive' : 'default'}
          />
        </CardContent>
      </Card>
    </div>
  );
}
