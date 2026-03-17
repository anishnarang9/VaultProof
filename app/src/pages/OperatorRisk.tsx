import { useState } from 'react';
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
  const { data: vault } = useVaultState();
  const [threshold, setThreshold] = useState(vault.circuitBreakerThreshold.toString());
  const [singleTx, setSingleTx] = useState(vault.maxSingleTransaction.toString());
  const [singleDeposit, setSingleDeposit] = useState(vault.maxSingleDeposit.toString());
  const [maxDailyTransactions, setMaxDailyTransactions] = useState(String(vault.maxDailyTransactions));
  const [paused, setPaused] = useState(vault.paused);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <Badge variant="secondary">Risk Controls</Badge>
          <CardTitle className="mt-3">Circuit breaker and transaction limits</CardTitle>
          <CardDescription>
            Vault-level limits and the pause state are presented here. Final write actions land once the new vault IDL is available.
          </CardDescription>
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
              onClick={() =>
                toast({
                  description: 'Risk-limit update queued in demo mode.',
                  title: 'Risk limits updated',
                  variant: 'success',
                })
              }
              type="button"
            >
              Update Risk Limits
            </Button>
            <Button
              onClick={() => {
                setPaused((current) => !current);
                toast({
                  description: paused ? 'Vault unpaused in demo mode.' : 'Vault paused in demo mode.',
                  title: paused ? 'Unpause requested' : 'Pause requested',
                  variant: 'warning',
                });
              }}
              type="button"
              variant="secondary"
            >
              {paused ? 'Unpause Vault' : 'Pause Vault'}
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
            title={paused ? 'Vault paused' : 'Vault operational'}
            variant={paused ? 'destructive' : 'default'}
          />
        </CardContent>
      </Card>
    </div>
  );
}
