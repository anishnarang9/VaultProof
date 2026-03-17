import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/primitives';
import { useToast } from '../components/ui/primitives';
import { useInstitutionalData } from '../hooks/useInstitutionalData';
import { formatCurrency } from '../lib/format';

export default function OperatorYield() {
  const { toast } = useToast();
  const { yieldMetrics } = useInstitutionalData();
  const [venueName, setVenueName] = useState('');
  const [jurisdiction, setJurisdiction] = useState('Switzerland');
  const [cap, setCap] = useState('1000');

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 xl:grid-cols-3">
        {[
          ['Current venue', yieldMetrics.currentVenue],
          ['Liquid buffer', formatCurrency(yieldMetrics.liquidBufferUsd)],
          ['Yield rate', `${yieldMetrics.yieldRate.toFixed(2)}%`],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-3">
              <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">{label}</p>
              <CardTitle className="text-2xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <Badge variant="secondary">Whitelisted Yield Venues</Badge>
            <CardTitle className="mt-3">Venue registry</CardTitle>
            <CardDescription>
              Mocked UI shell until the final vault IDL exposes venue management instructions.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto rounded-[calc(var(--radius)*2)] border border-border px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Venue</TableHead>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead>Allocation Cap</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {yieldMetrics.yieldVenues.map((venue) => (
                  <TableRow key={venue.id}>
                    <TableCell className="text-text-primary">{venue.name}</TableCell>
                    <TableCell>{venue.jurisdiction}</TableCell>
                    <TableCell>{(venue.allocationCapBps / 100).toFixed(2)}%</TableCell>
                    <TableCell>{venue.riskRating}</TableCell>
                    <TableCell>
                      <Badge variant={venue.active ? 'success' : 'secondary'}>
                        {venue.active ? 'Active' : 'Paused'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="outline">Venue Controls</Badge>
            <CardTitle className="mt-3">Add or remove venue</CardTitle>
            <CardDescription>
              Until Agent 3 delivers the admin instructions, these controls operate in demo mode.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="venueName">Venue name</Label>
              <Input id="venueName" onChange={(event) => setVenueName(event.target.value)} value={venueName} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="jurisdiction">Jurisdiction</Label>
              <Input id="jurisdiction" onChange={(event) => setJurisdiction(event.target.value)} value={jurisdiction} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cap">Allocation cap (bps)</Label>
              <Input id="cap" onChange={(event) => setCap(event.target.value)} value={cap} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mode">Kamino status</Label>
              <Select id="mode" defaultValue="connected">
                <option value="connected">Connected</option>
                <option value="demo">Demo mode</option>
              </Select>
            </div>
            <Button
              onClick={() =>
                toast({
                  description: `${venueName || 'New venue'} queued for governance review.`,
                  title: 'Venue action staged',
                  variant: 'success',
                })
              }
              type="button"
            >
              Add Venue
            </Button>
            <Button
              onClick={() =>
                toast({
                  description: 'Manual accrue_yield demo action staged.',
                  title: 'Yield accrual requested',
                  variant: 'warning',
                })
              }
              type="button"
              variant="secondary"
            >
              Accrue Yield
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
