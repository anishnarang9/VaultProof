import { useCallback, useState } from 'react';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  Badge,
  Button,
  Card,
  CardContent,
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
  getPrograms,
  buildAddYieldVenueTx,
  buildRemoveYieldVenueTx,
  buildAccrueYieldTx,
} from '../lib/program';

type Venue = {
  address: string;
  name: string;
  jurisdiction: string;
  allocationCapBps: number;
  riskRating: number;
  active: boolean;
};

const RISK_LABELS: Record<number, string> = { 1: 'Low', 2: 'Moderate', 3: 'Elevated' };

export default function OperatorYield() {
  const { toast } = useToast();
  const { yieldMetrics } = useInstitutionalData();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();

  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [jurisdiction, setJurisdiction] = useState('Switzerland');
  const [cap, setCap] = useState('1000');
  const [riskRating, setRiskRating] = useState('1');
  const [yieldAmount, setYieldAmount] = useState('');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [addingVenue, setAddingVenue] = useState(false);
  const [accruingYield, setAccruingYield] = useState(false);

  const handleAddVenue = useCallback(async () => {
    if (!anchorWallet || !publicKey) {
      toast({ title: 'Wallet not connected', description: 'Connect your wallet to submit transactions.', variant: 'destructive' });
      return;
    }

    if (!venueName.trim()) {
      toast({ title: 'Missing venue name', description: 'Enter a name for the venue.', variant: 'destructive' });
      return;
    }

    let venueKey: PublicKey;
    try {
      venueKey = new PublicKey(venueAddress);
    } catch {
      toast({ title: 'Invalid venue address', description: 'Enter a valid Solana public key.', variant: 'destructive' });
      return;
    }

    const capBps = parseInt(cap, 10);
    if (isNaN(capBps) || capBps <= 0 || capBps > 10000) {
      toast({ title: 'Invalid allocation cap', description: 'Cap must be between 1 and 10000 bps.', variant: 'destructive' });
      return;
    }

    const risk = parseInt(riskRating, 10);

    // Build a 32-byte jurisdiction whitelist from the jurisdiction string
    const jurisdictionBytes = Array.from(new TextEncoder().encode(jurisdiction));
    const jurisdictionWhitelist = new Array(32).fill(0);
    for (let i = 0; i < Math.min(jurisdictionBytes.length, 32); i++) {
      jurisdictionWhitelist[i] = jurisdictionBytes[i];
    }

    setAddingVenue(true);
    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const tx = buildAddYieldVenueTx({
        program: vusdVault,
        venueAddress: venueKey,
        name: venueName,
        jurisdictionWhitelist,
        allocationCapBps: capBps,
        riskRating: risk,
        signer: publicKey,
      });

      const signature = await sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, 'confirmed');

      setVenues((prev) => [
        ...prev,
        {
          address: venueKey.toBase58(),
          name: venueName,
          jurisdiction,
          allocationCapBps: capBps,
          riskRating: risk,
          active: true,
        },
      ]);

      toast({ title: 'Venue added', description: `${venueName} registered on-chain. Tx: ${signature.slice(0, 8)}...`, variant: 'success' });
      setVenueName('');
      setVenueAddress('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      toast({ title: 'Add venue failed', description: message, variant: 'destructive' });
    } finally {
      setAddingVenue(false);
    }
  }, [anchorWallet, publicKey, venueName, venueAddress, jurisdiction, cap, riskRating, connection, sendTransaction, toast]);

  const handleAccrueYield = useCallback(async () => {
    if (!anchorWallet || !publicKey) {
      toast({ title: 'Wallet not connected', description: 'Connect your wallet to submit transactions.', variant: 'destructive' });
      return;
    }

    const amount = parseFloat(yieldAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Invalid yield amount', description: 'Enter a positive number.', variant: 'destructive' });
      return;
    }

    setAccruingYield(true);
    try {
      const { vusdVault } = getPrograms(connection, anchorWallet);
      const tx = buildAccrueYieldTx({
        program: vusdVault,
        yieldAmount: new BN(Math.round(amount * 1e6)), // assume 6 decimal places (USDC)
        signer: publicKey,
      });

      const signature = await sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, 'confirmed');

      toast({ title: 'Yield accrued', description: `${amount} USDC yield recorded. Tx: ${signature.slice(0, 8)}...`, variant: 'success' });
      setYieldAmount('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      toast({ title: 'Accrue yield failed', description: message, variant: 'destructive' });
    } finally {
      setAccruingYield(false);
    }
  }, [anchorWallet, publicKey, yieldAmount, connection, sendTransaction, toast]);

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
                {venues.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-text-tertiary">
                      No venues configured. Add a venue to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  venues.map((venue) => (
                    <TableRow key={venue.address}>
                      <TableCell className="text-text-primary">{venue.name}</TableCell>
                      <TableCell className="font-mono text-xs">{venue.address.slice(0, 4)}...{venue.address.slice(-4)}</TableCell>
                      <TableCell>{venue.jurisdiction}</TableCell>
                      <TableCell>{(venue.allocationCapBps / 100).toFixed(2)}%</TableCell>
                      <TableCell>{RISK_LABELS[venue.riskRating] ?? venue.riskRating}</TableCell>
                      <TableCell>
                        <Badge variant={venue.active ? 'success' : 'secondary'}>
                          {venue.active ? 'Active' : 'Paused'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge variant="outline">Venue Controls</Badge>
            <CardTitle className="mt-3">Add venue or accrue yield</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="venueName">Venue name</Label>
              <Input id="venueName" onChange={(event) => setVenueName(event.target.value)} value={venueName} placeholder="e.g. Kamino USDC Vault" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="venueAddress">Venue address (Solana pubkey)</Label>
              <Input id="venueAddress" onChange={(event) => setVenueAddress(event.target.value)} value={venueAddress} placeholder="e.g. 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" className="font-mono text-xs" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="jurisdiction">Jurisdiction</Label>
              <Input id="jurisdiction" onChange={(event) => setJurisdiction(event.target.value)} value={jurisdiction} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cap">Allocation cap (bps)</Label>
              <Input id="cap" type="number" min="1" max="10000" onChange={(event) => setCap(event.target.value)} value={cap} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="riskRating">Risk rating</Label>
              <Select id="riskRating" value={riskRating} onChange={(event) => setRiskRating(event.target.value)}>
                <option value="1">Low</option>
                <option value="2">Moderate</option>
                <option value="3">Elevated</option>
              </Select>
            </div>
            <Button onClick={handleAddVenue} type="button" disabled={addingVenue}>
              {addingVenue ? 'Submitting...' : 'Add Venue'}
            </Button>

            <hr className="border-border" />

            <div className="grid gap-2">
              <Label htmlFor="yieldAmount">Yield amount (USDC)</Label>
              <Input id="yieldAmount" type="number" min="0" step="0.01" onChange={(event) => setYieldAmount(event.target.value)} value={yieldAmount} placeholder="e.g. 1000.00" />
            </div>
            <Button onClick={handleAccrueYield} type="button" variant="secondary" disabled={accruingYield}>
              {accruingYield ? 'Submitting...' : 'Accrue Yield'}
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
