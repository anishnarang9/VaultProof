import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui/primitives';
import { useToast } from '../components/ui/primitives';
import { deriveVaultStatePda } from '../lib/program';

const SQUADS_PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

interface MultisigMember {
  key: string;
  permissions: number;
}

interface MultisigInfo {
  threshold: number;
  members: MultisigMember[];
  transactionIndex: number;
  createKey: string;
}

function deriveMultisigPda(createKey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('multisig'), createKey.toBuffer()],
    SQUADS_PROGRAM_ID,
  )[0];
}

export default function OperatorGovernance() {
  const { toast } = useToast();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [multisigAddress, setMultisigAddress] = useState('');
  const [multisigInfo, setMultisigInfo] = useState<MultisigInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [looked, setLooked] = useState(false);

  const vaultAuthority = deriveVaultStatePda();

  const fetchMultisig = useCallback(async (address: string) => {
    if (!address.trim()) return;

    setLoading(true);
    try {
      const pubkey = new PublicKey(address);
      const info = await connection.getAccountInfo(pubkey);

      if (!info || !info.owner.equals(SQUADS_PROGRAM_ID)) {
        toast({ title: 'Not a Squads multisig', description: 'This address is not owned by the Squads program.', variant: 'destructive' });
        setMultisigInfo(null);
        setLooked(true);
        return;
      }

      // Parse Squads v4 multisig account data
      // Layout: discriminator(8) + create_key(32) + config_authority(33) + threshold(2) + time_lock(4) + transaction_index(8) + stale_transaction_index(8) + rent_collector(33) + bump(1) + members(vec)
      const data = info.data;
      const createKey = new PublicKey(data.subarray(8, 40));
      const threshold = data.readUInt16LE(73);
      const transactionIndex = Number(data.readBigUInt64LE(79));

      // Members are at the end as a vec: length(4) + members(key(32) + permissions(4))
      const membersOffset = 129;
      const memberCount = data.readUInt32LE(membersOffset);
      const members: MultisigMember[] = [];

      for (let i = 0; i < memberCount && i < 20; i++) {
        const offset = membersOffset + 4 + i * 36;
        const key = new PublicKey(data.subarray(offset, offset + 32));
        const permissions = data.readUInt32LE(offset + 32);
        members.push({ key: key.toBase58(), permissions });
      }

      setMultisigInfo({
        threshold,
        members,
        transactionIndex,
        createKey: createKey.toBase58(),
      });
      setLooked(true);
    } catch (err) {
      toast({ title: 'Failed to fetch multisig', description: err instanceof Error ? err.message : 'Invalid address', variant: 'destructive' });
      setMultisigInfo(null);
      setLooked(true);
    } finally {
      setLoading(false);
    }
  }, [connection, toast]);

  return (
    <Tabs defaultValue="multisig">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Badge variant="secondary">Governance</Badge>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-text-primary">
            Squads multisig panel
          </h2>
        </div>
        <TabsList>
          <TabsTrigger value="multisig">Multisig</TabsTrigger>
          <TabsTrigger value="authority">Authority</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="multisig">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader>
              <CardTitle>Multisig configuration</CardTitle>
              <CardDescription>
                Enter a Squads multisig address to view members, threshold, and transaction history.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {multisigInfo ? (
                <div className="grid gap-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="rounded-lg border border-border bg-bg-primary p-4">
                      <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Threshold</p>
                      <p className="mt-2 text-2xl font-semibold text-text-primary">
                        {multisigInfo.threshold} / {multisigInfo.members.length}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-bg-primary p-4">
                      <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Members</p>
                      <p className="mt-2 text-2xl font-semibold text-text-primary">{multisigInfo.members.length}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-bg-primary p-4">
                      <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Transactions</p>
                      <p className="mt-2 text-2xl font-semibold text-text-primary">{multisigInfo.transactionIndex}</p>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <p className="text-sm font-medium text-text-primary">Signer roster</p>
                    {multisigInfo.members.map((member, index) => (
                      <div
                        key={member.key}
                        className="flex items-center justify-between rounded-lg border border-border bg-bg-primary px-4 py-3"
                      >
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">
                            Signer {index + 1}
                            {publicKey && member.key === publicKey.toBase58() ? ' (you)' : ''}
                          </p>
                          <p className="mt-1 font-mono text-xs text-text-secondary">{member.key}</p>
                        </div>
                        <Badge variant={member.permissions > 0 ? 'success' : 'secondary'}>
                          {member.permissions >= 7 ? 'Full' : member.permissions >= 4 ? 'Vote' : 'Propose'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ) : looked ? (
                <div className="py-8 text-center text-text-tertiary">
                  No multisig found at this address. Create one via{' '}
                  <a href="https://app.squads.so" target="_blank" rel="noopener noreferrer" className="text-accent underline">
                    app.squads.so
                  </a>{' '}
                  to enable governance.
                </div>
              ) : (
                <div className="py-8 text-center text-text-tertiary">
                  Enter a Squads multisig address to view its configuration.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Badge variant="outline">Lookup</Badge>
              <CardTitle className="mt-3">Multisig address</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="multisigAddress">Squads multisig address</Label>
                <Input
                  id="multisigAddress"
                  value={multisigAddress}
                  onChange={(e) => setMultisigAddress(e.target.value)}
                  placeholder="e.g. 7xKXtg2CW87d97TXJ..."
                  className="font-mono text-xs"
                />
              </div>
              <Button
                onClick={() => fetchMultisig(multisigAddress)}
                disabled={loading || !multisigAddress.trim()}
                type="button"
              >
                {loading ? 'Loading...' : 'Fetch Multisig'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="authority">
        <Card>
          <CardHeader>
            <CardTitle>Vault authority</CardTitle>
            <CardDescription>
              The vault authority controls admin operations: risk limits, venue management, yield accrual, and compliance actions.
              Transfer authority to a Squads multisig for institutional-grade governance.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-bg-primary px-4 py-4">
              <span className="text-sm text-text-secondary">Vault state PDA</span>
              <span className="font-mono text-xs text-text-primary">{vaultAuthority.toBase58()}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-bg-primary px-4 py-4">
              <span className="text-sm text-text-secondary">Connected wallet</span>
              <span className="font-mono text-xs text-text-primary">
                {publicKey ? publicKey.toBase58() : 'Not connected'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-bg-primary px-4 py-4">
              <span className="text-sm text-text-secondary">Governance model</span>
              <Badge variant="accent">Single authority</Badge>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
