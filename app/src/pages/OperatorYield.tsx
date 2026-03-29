import { BN } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
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
import {
  buildAccrueYieldTx,
  buildAddYieldVenueTx,
  getPrograms,
} from '../lib/program';

const textEncoder = new TextEncoder();

function encodeJurisdictionWhitelist(value: string) {
  const bytes = Array.from(textEncoder.encode(value)).slice(0, 32);

  while (bytes.length < 32) {
    bytes.push(0);
  }

  return bytes;
}

export default function OperatorYield() {
  const { toast } = useToast();
  const { yieldMetrics, refresh } = useInstitutionalData();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const [venueAddress, setVenueAddress] = useState('');
  const [venueName, setVenueName] = useState('');
  const [jurisdiction, setJurisdiction] = useState('United States');
  const [cap, setCap] = useState('1000');
  const [riskRating, setRiskRating] = useState('2');
  const [yieldAmount, setYieldAmount] = useState('5000');
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddVenue = async () => {
    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect wallet to manage vault.');
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const transaction = await buildAddYieldVenueTx({
        allocationCapBps: Number(cap || '0'),
        jurisdictionWhitelist: encodeJurisdictionWhitelist(jurisdiction),
        name: venueName,
        program: vusdVault,
        riskRating: Number(riskRating || '0'),
        signer: publicKey,
        venueAddress: new PublicKey(venueAddress),
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      toast({
        description: signature,
        title: 'Yield venue added',
        variant: 'success',
      });
      setStatus(`Yield venue added: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Unable to add yield venue.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAccrueYield = async () => {
    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect wallet to manage vault.');
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const transaction = await buildAccrueYieldTx({
        program: vusdVault,
        signer: publicKey,
        yieldAmount: new BN(yieldAmount || '0'),
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      toast({
        description: signature,
        title: 'Yield accrued',
        variant: 'success',
      });
      setStatus(`Yield accrued: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Unable to accrue yield.');
    } finally {
      setIsSubmitting(false);
    }
  };

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
              Live venue configuration from the vault allowlist and current share-price posture.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto rounded-[calc(var(--radius)*2)] border border-border px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Venue</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead>Allocation Cap</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {yieldMetrics.yieldVenues.length > 0 ? (
                  yieldMetrics.yieldVenues.map((venue) => (
                    <TableRow key={venue.id}>
                      <TableCell className="text-text-primary">{venue.name}</TableCell>
                      <TableCell className="font-mono text-xs">{venue.venueAddress}</TableCell>
                      <TableCell>{venue.jurisdiction}</TableCell>
                      <TableCell>{(venue.allocationCapBps / 100).toFixed(2)}%</TableCell>
                      <TableCell>{venue.riskRating}</TableCell>
                      <TableCell>
                        <Badge variant={venue.active ? 'success' : 'secondary'}>
                          {venue.active ? 'Active' : 'Paused'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <td className="px-4 py-8 text-center text-sm text-text-secondary" colSpan={6}>
                      No yield venues configured.
                    </td>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="outline">Venue Controls</Badge>
            <CardTitle className="mt-3">Add venue or accrue yield</CardTitle>
            <CardDescription>
              Submit live admin transactions to extend the venue allowlist or move share price
              forward.
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
                title={status.toLowerCase().includes('unable') ? 'Yield action failed' : 'Yield action status'}
                variant={status.toLowerCase().includes('unable') ? 'destructive' : 'default'}
              />
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="venueAddress">Venue address</Label>
              <Input
                disabled={isSubmitting}
                id="venueAddress"
                onChange={(event) => setVenueAddress(event.target.value)}
                value={venueAddress}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="venueName">Venue name</Label>
              <Input
                disabled={isSubmitting}
                id="venueName"
                onChange={(event) => setVenueName(event.target.value)}
                value={venueName}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="jurisdiction">Jurisdiction</Label>
              <Input
                disabled={isSubmitting}
                id="jurisdiction"
                onChange={(event) => setJurisdiction(event.target.value)}
                value={jurisdiction}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cap">Allocation cap (bps)</Label>
              <Input
                disabled={isSubmitting}
                id="cap"
                onChange={(event) => setCap(event.target.value)}
                value={cap}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="riskRating">Risk rating</Label>
              <Select
                disabled={isSubmitting}
                id="riskRating"
                onChange={(event) => setRiskRating(event.target.value)}
                value={riskRating}
              >
                <option value="2">Low</option>
                <option value="3">Moderate</option>
                <option value="4">Elevated</option>
              </Select>
            </div>
            <Button
              disabled={!publicKey || isSubmitting || !venueAddress || !venueName}
              onClick={() => {
                void handleAddVenue();
              }}
              type="button"
            >
              Add Venue
            </Button>

            <div className="grid gap-2 border-t border-border pt-5">
              <Label htmlFor="yieldAmount">Yield amount</Label>
              <Input
                disabled={isSubmitting}
                id="yieldAmount"
                onChange={(event) => setYieldAmount(event.target.value)}
                value={yieldAmount}
              />
            </div>
            <Button
              disabled={!publicKey || isSubmitting || !yieldAmount}
              onClick={() => {
                void handleAccrueYield();
              }}
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
