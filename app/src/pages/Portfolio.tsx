import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/primitives';
import { useInstitutionalData } from '../hooks/useInstitutionalData';
import { formatCurrency, formatDateTime } from '../lib/format';
import { cn } from '../lib/utils';

export default function Portfolio() {
  const { depositHistory, portfolio, sharePriceHistory } = useInstitutionalData();
  const actions = [
    { accent: true, label: 'Deposit USDC', to: '/investor/deposit' },
    { accent: false, label: 'Transfer shares', to: '/investor/transfer' },
    { accent: false, label: 'Withdraw shares', to: '/investor/withdraw' },
  ];

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 xl:grid-cols-3">
        {[
          ['Your shares', portfolio.shareBalance.toLocaleString('en-US')],
          ['Proportional USDC claim', formatCurrency(portfolio.proportionalClaimUsd)],
          ['Yield earned', formatCurrency(portfolio.yieldEarned)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-3">
              <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">{label}</p>
              <CardTitle className="text-2xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <Badge variant="secondary">Performance</Badge>
            <CardTitle className="mt-3">Share price appreciation</CardTitle>
            <CardDescription>
              Portfolio growth is derived from vault share-price movement since your first deposit.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sharePriceHistory}>
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
                <Area
                  dataKey="sharePrice"
                  fill="url(#portfolioFill)"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  type="monotone"
                />
                <defs>
                  <linearGradient id="portfolioFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="outline">Actions</Badge>
            <CardTitle className="mt-3">Investor flows</CardTitle>
            <CardDescription>
              Use the proof-gated transaction flows to move between deposit, transfer, and withdrawal paths.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {actions.map((action) => (
              <Link
                key={action.to}
                className={cn(
                  'inline-flex h-11 items-center justify-center rounded-full border px-5 text-sm transition-colors',
                  action.accent
                    ? 'border-transparent bg-accent text-white hover:bg-accent-hover'
                    : 'border-border bg-surface text-text-primary hover:bg-elevated',
                )}
                to={action.to}
              >
                {action.label}
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <Badge variant="secondary">Deposit History</Badge>
          <CardTitle className="mt-3">Verified inflows</CardTitle>
          <CardDescription>Your deposit history filtered by signer and transfer type.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto rounded-[calc(var(--radius)*2)] border border-border px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {depositHistory.map((record) => (
                <TableRow key={record.address.toBase58()}>
                  <TableCell className="text-text-primary">{record.transferType}</TableCell>
                  <TableCell>{formatCurrency(record.amount)}</TableCell>
                  <TableCell>{formatDateTime(record.timestamp)}</TableCell>
                  <TableCell>
                    <Badge variant={record.decryptionAuthorized ? 'success' : 'secondary'}>
                      {record.decryptionAuthorized ? 'Audited' : 'Recorded'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
