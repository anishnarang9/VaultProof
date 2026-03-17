import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/primitives';
import { useInstitutionalData } from '../hooks/useInstitutionalData';
import { useMonitoring } from '../hooks/useMonitoring';
import { formatCompact, formatCurrency } from '../lib/format';
import { cn } from '../lib/utils';

function circuitBreakerTone(usage: number) {
  if (usage > 0.8) {
    return 'bg-warning';
  }

  if (usage > 0.5) {
    return 'bg-accent';
  }

  return 'bg-success';
}

export default function Dashboard() {
  const {
    registryHealth,
    records,
    sharePriceHistory,
    usingMockRecords,
    vaultState,
    yieldMetrics,
  } = useInstitutionalData();
  const { alerts } = useMonitoring();

  const inflowTotal = records
    .filter((record) => record.transferType === 'Deposit')
    .reduce((sum, record) => sum + Number(record.amount.toString()), 0);
  const outflowTotal = records
    .filter((record) => record.transferType === 'Withdrawal')
    .reduce((sum, record) => sum + Number(record.amount.toString()), 0);
  const usagePercent = Math.min(100, Math.round(vaultState.data.circuitBreakerUsage * 100));

  return (
    <div className="grid gap-6">
      {alerts.length > 0 ? (
        <Alert
          description={alerts.map((alert) => alert.message).join(' • ')}
          title="Monitoring alerts are active"
          variant={alerts.some((alert) => alert.severity === 'critical') ? 'destructive' : 'warning'}
        />
      ) : null}

      <section className="grid gap-4 xl:grid-cols-5">
        {[
          ['TVL', formatCurrency(vaultState.data.totalAssets)],
          ['Share Price', vaultState.data.sharePrice > 0 ? `$${vaultState.data.sharePrice.toFixed(3)}` : 'Awaiting first mint'],
          ['Inflow (30d)', formatCurrency(inflowTotal)],
          ['Outflow (30d)', formatCurrency(outflowTotal)],
          ['Active Credentials', formatCompact(registryHealth.activeCredentials)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-3">
              <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">{label}</p>
              <CardTitle className="text-2xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_380px]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Share Price History</p>
                <CardTitle>Operator overview</CardTitle>
                <CardDescription>
                  Historical pricing and vault activity derived from TransferRecords.
                  {usingMockRecords ? ' Demo fallback data is active until upstream vault records arrive.' : ''}
                </CardDescription>
              </div>
              <Badge variant={usingMockRecords ? 'warning' : 'success'}>
                {usingMockRecords ? 'Demo data' : 'Live reads'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sharePriceHistory}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" stroke="#52535A" tickLine={false} axisLine={false} />
                <YAxis
                  stroke="#52535A"
                  tickFormatter={(value) => `$${Number(value).toFixed(2)}`}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#12131A',
                    border: '1px solid #1E2028',
                    borderRadius: 12,
                  }}
                  formatter={(value) => [`$${Number(value ?? 0).toFixed(3)}`, 'Share price']}
                />
                <Area
                  dataKey="sharePrice"
                  stroke="#3B82F6"
                  fill="url(#sharePriceFill)"
                  strokeWidth={2}
                  type="monotone"
                />
                <defs>
                  <linearGradient id="sharePriceFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Circuit Breaker</p>
            <CardTitle>Daily outflow threshold</CardTitle>
            <CardDescription>
              Visual status of daily outflow against the configured circuit breaker.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[var(--radius)] border border-border bg-bg-primary p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-text-secondary">Usage</span>
                <strong className="text-sm text-text-primary">{usagePercent}%</strong>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-elevated">
                <div
                  aria-label="Circuit breaker usage"
                  className={cn('h-full rounded-full transition-all', circuitBreakerTone(vaultState.data.circuitBreakerUsage))}
                  data-testid="circuit-breaker-bar"
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-3">
                <span className="text-sm text-text-secondary">Daily outflow</span>
                <span className="font-mono text-sm text-text-primary">
                  {formatCurrency(vaultState.data.dailyOutflowTotal)}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-3">
                <span className="text-sm text-text-secondary">Threshold</span>
                <span className="font-mono text-sm text-text-primary">
                  {formatCurrency(vaultState.data.circuitBreakerThreshold)}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-3">
                <span className="text-sm text-text-secondary">Status</span>
                <Badge variant={vaultState.data.paused ? 'destructive' : 'success'}>
                  {vaultState.data.paused ? 'Paused' : 'Operational'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Cash Flows</p>
            <CardTitle>Inflow and outflow by period</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sharePriceHistory}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" stroke="#52535A" tickLine={false} axisLine={false} />
                <YAxis stroke="#52535A" tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#12131A',
                    border: '1px solid #1E2028',
                    borderRadius: 12,
                  }}
                />
                <Bar dataKey="inflow" fill="#3B82F6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="outflow" fill="#F59E0B" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Health Summary</p>
            <CardTitle>Registry and yield posture</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
              <span className="text-sm text-text-secondary">Registry active vs revoked</span>
              <span className="text-sm text-text-primary">
                {registryHealth.activeCredentials} / {registryHealth.revokedCredentials}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
              <span className="text-sm text-text-secondary">Tree capacity</span>
              <span className="text-sm text-text-primary">
                {registryHealth.capacityUtilization.toFixed(2)}% of {formatCompact(registryHealth.treeCapacity)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
              <span className="text-sm text-text-secondary">Current venue</span>
              <span className="text-sm text-text-primary">{yieldMetrics.currentVenue}</span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
              <span className="text-sm text-text-secondary">Yield earned</span>
              <span className="text-sm text-text-primary">
                {formatCurrency(vaultState.data.totalYieldEarned)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
              <span className="text-sm text-text-secondary">Yield rate</span>
              <span className="text-sm text-text-primary">{yieldMetrics.yieldRate.toFixed(2)}%</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
