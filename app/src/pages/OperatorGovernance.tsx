import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/primitives';
import { useToast } from '../components/ui/primitives';
import { useInstitutionalData } from '../hooks/useInstitutionalData';
import { formatDateTime, shorten } from '../lib/format';
import { buildAuthorizeDecryptionTx, getPrograms } from '../lib/program';

export default function OperatorGovernance() {
  const { toast } = useToast();
  const {
    decryptionAuthorizations,
    governanceMembers,
    records,
    refresh,
    vaultState,
  } = useInstitutionalData();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null);

  const handleAuthorize = async (transferRecord: string) => {
    const targetRecord = records.find((record) => record.address.toBase58() === transferRecord);

    if (!targetRecord) {
      setStatus('Transfer record not found.');
      return;
    }

    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect wallet to manage vault.');
      return;
    }

    setIsSubmitting(transferRecord);
    setStatus(null);

    try {
      const { complianceAdmin } = getPrograms(connection, anchorWallet);
      const transaction = await buildAuthorizeDecryptionTx({
        program: complianceAdmin,
        signer: publicKey,
        transferRecord: targetRecord.address,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      toast({
        description: signature,
        title: 'Decryption authorized',
        variant: 'success',
      });
      setStatus(`Decryption authorized: ${signature}`);
    } catch (caughtError) {
      setStatus(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to authorize decryption.',
      );
    } finally {
      setIsSubmitting(null);
    }
  };

  return (
    <Tabs defaultValue="actions">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Badge variant="secondary">Compliance Actions</Badge>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-text-primary">
            Authority-routed decryption controls
          </h2>
        </div>
        <TabsList>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="members">Authority</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="actions" className="grid gap-6">
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
            title={status.toLowerCase().includes('unable') ? 'Compliance action failed' : 'Compliance action status'}
            variant={status.toLowerCase().includes('unable') ? 'destructive' : 'default'}
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Transfer records</CardTitle>
            <CardDescription>
              Review transfer metadata state and authorize decryption on records that still show as
              pending.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto rounded-[calc(var(--radius)*2)] border border-border px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transfer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Signer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.address.toBase58()}>
                    <TableCell className="font-mono text-xs">
                      {shorten(record.address.toBase58(), 12, 8)}
                    </TableCell>
                    <TableCell>{record.transferType}</TableCell>
                    <TableCell className="font-mono text-xs">{shorten(record.signer)}</TableCell>
                    <TableCell>
                      <Badge variant={record.decryptionAuthorized ? 'success' : 'warning'}>
                        {record.decryptionAuthorized ? 'Authorized' : 'Pending'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        disabled={!publicKey || Boolean(isSubmitting) || record.decryptionAuthorized}
                        onClick={() => {
                          void handleAuthorize(record.address.toBase58());
                        }}
                        type="button"
                        variant="secondary"
                      >
                        Authorize Decryption
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Authorization history</CardTitle>
            <CardDescription>
              Real decryption authorization accounts recorded by the compliance-admin program.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto rounded-[calc(var(--radius)*2)] border border-border px-0 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Authorization</TableHead>
                  <TableHead>Transfer</TableHead>
                  <TableHead>Authorized By</TableHead>
                  <TableHead>Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decryptionAuthorizations.length > 0 ? (
                  decryptionAuthorizations.map((authorization) => (
                    <TableRow key={authorization.address.toBase58()}>
                      <TableCell className="font-mono text-xs">
                        {shorten(authorization.address.toBase58(), 12, 8)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shorten(authorization.transferRecord.toBase58(), 12, 8)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shorten(authorization.authorizedBy.toBase58(), 12, 8)}
                      </TableCell>
                      <TableCell>{formatDateTime(authorization.timestamp)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <td className="px-4 py-8 text-center text-sm text-text-secondary" colSpan={4}>
                      No decryption authorizations recorded yet.
                    </td>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="members">
        <Card>
          <CardHeader>
            <CardTitle>Vault authority</CardTitle>
            <CardDescription>
              The current vault authority and operator-visible signer roster used to gate compliance
              actions.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">
                Vault authority
              </p>
              <p className="mt-2 font-mono text-xs text-text-secondary">
                {vaultState.data.authority.toBase58()}
              </p>
            </div>
            {governanceMembers.map((member, index) => (
              <div
                key={member}
                className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4"
              >
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">
                  Signer {index + 1}
                </p>
                <p className="mt-2 font-mono text-xs text-text-secondary">{member}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
