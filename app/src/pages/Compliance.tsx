import { startTransition, useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/primitives';
import { useInstitutionalData } from '../hooks/useInstitutionalData';
import { useMonitoring } from '../hooks/useMonitoring';
import { formatCurrency, formatDateTime, shorten } from '../lib/format';

type SortKey = 'amount' | 'timestamp' | 'type';

export default function Compliance() {
  const navigate = useNavigate();
  const { records, usingMockRecords } = useInstitutionalData();
  const { alerts } = useMonitoring();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('timestamp');
  const [typeFilter, setTypeFilter] = useState<'All' | 'Deposit' | 'Transfer' | 'Withdrawal'>('All');
  const deferredQuery = useDeferredValue(query);

  const filteredRecords = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    const nextRecords = records
      .filter((record) => (typeFilter === 'All' ? true : record.transferType === typeFilter))
      .filter((record) => {
        if (!normalizedQuery) {
          return true;
        }

        return [
          record.transferType,
          record.signer.toBase58(),
          shorten(record.proofHash, 10, 8),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      });

    return nextRecords.sort((left, right) => {
      if (sortKey === 'amount') {
        return Number(right.amount.toString()) - Number(left.amount.toString());
      }

      if (sortKey === 'type') {
        return left.transferType.localeCompare(right.transferType);
      }

      return Number(right.timestamp.toString()) - Number(left.timestamp.toString());
    });
  }, [deferredQuery, records, sortKey, typeFilter]);

  return (
    <div className="grid gap-6">
      {alerts.length > 0 ? (
        <Alert
          description={alerts.map((alert) => alert.message).join(' • ')}
          title="Monitoring alerts are active"
          variant={alerts.some((alert) => alert.severity === 'critical') ? 'destructive' : 'warning'}
        />
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Badge variant="secondary">Compliance Monitoring</Badge>
              <CardTitle className="mt-3">Transfer record explorer</CardTitle>
              <CardDescription>
                Sortable investigation queue with proof hashes, signer identities, and decryption status.
              </CardDescription>
            </div>
            <Badge variant={usingMockRecords ? 'warning' : 'success'}>
              {usingMockRecords ? 'Demo fallback records' : 'Live transfer records'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
            <Input
              onChange={(event) => {
                startTransition(() => setQuery(event.target.value));
              }}
              placeholder="Search signer, proof hash, or type"
              value={query}
            />
            <Select onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} value={typeFilter}>
              <option value="All">All types</option>
              <option value="Deposit">Deposit</option>
              <option value="Transfer">Transfer</option>
              <option value="Withdrawal">Withdrawal</option>
            </Select>
            <Select onChange={(event) => setSortKey(event.target.value as SortKey)} value={sortKey}>
              <option value="timestamp">Newest first</option>
              <option value="amount">Largest amount</option>
              <option value="type">Type</option>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-[calc(var(--radius)*2)] border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Signer</TableHead>
                  <TableHead>Proof Hash</TableHead>
                  <TableHead>Decryption</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => (
                  <TableRow
                    key={record.address.toBase58()}
                    className="cursor-pointer"
                    onClick={() => navigate(`/developer/compliance/${record.address.toBase58()}`)}
                  >
                    <TableCell className="text-text-primary">{record.transferType}</TableCell>
                    <TableCell>{formatCurrency(record.amount)}</TableCell>
                    <TableCell>{formatDateTime(record.timestamp)}</TableCell>
                    <TableCell className="font-mono text-xs">{shorten(record.signer)}</TableCell>
                    <TableCell className="font-mono text-xs">{shorten(record.proofHash, 10, 8)}</TableCell>
                    <TableCell>
                      <Badge variant={record.decryptionAuthorized ? 'success' : 'warning'}>
                        {record.decryptionAuthorized ? 'Authorized' : 'Pending'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
