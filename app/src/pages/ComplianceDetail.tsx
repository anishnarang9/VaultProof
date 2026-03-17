import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/primitives';
import { useToast } from '../components/ui/primitives';
import { useCredential } from '../hooks/useCredential';
import { useInstitutionalData } from '../hooks/useInstitutionalData';
import { formatDateTime, shorten } from '../lib/format';
import { buildAuthorizeDecryptionTx, getPrograms } from '../lib/program';

export default function ComplianceDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const { credential } = useCredential();
  const { records } = useInstitutionalData();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const [status, setStatus] = useState<string | null>(null);

  const record = useMemo(
    () => records.find((item) => item.address.toBase58() === id) ?? records[0],
    [id, records],
  );

  const encryptedMetadataHex = useMemo(
    () =>
      `0x${record.encryptedMetadata.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`,
    [record.encryptedMetadata],
  );

  const handleRequestDecryption = async () => {
    if (!record) {
      return;
    }

    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect the compliance authority wallet to request decryption.');
      return;
    }

    try {
      const { complianceAdmin } = getPrograms(connection, anchorWallet);
      const transaction = await buildAuthorizeDecryptionTx({
        program: complianceAdmin,
        signer: publicKey,
        transferRecord: record.address,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      toast({
        description: signature,
        title: 'Decryption request submitted',
        variant: 'success',
      });
      setStatus(`Decryption request submitted: ${signature}`);
    } catch (caughtError) {
      setStatus(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to request decryption.',
      );
    }
  };

  if (!record) {
    return (
      <Alert
        description="No transfer record could be resolved for this route."
        title="Record not found"
        variant="destructive"
      />
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader>
          <Badge variant="secondary">Transfer Investigation</Badge>
          <CardTitle className="mt-3">Detailed record view</CardTitle>
          <CardDescription>
            Inspect the proof hash, merkle-root snapshot, encrypted metadata, and decryption status.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {[
            ['Type', record.transferType],
            ['Amount', record.amount.toString()],
            ['Timestamp', formatDateTime(record.timestamp)],
            ['Signer', record.signer.toBase58()],
            ['Proof Hash', shorten(record.proofHash, 12, 10)],
            ['Merkle Root Snapshot', shorten(record.merkleRootSnapshot, 12, 10)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4"
            >
              <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">{label}</p>
              <p className="mt-2 break-all font-mono text-xs text-text-secondary">{value}</p>
            </div>
          ))}
          <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Encrypted Metadata</p>
            <p className="mt-2 break-all font-mono text-xs text-text-secondary">
              {encryptedMetadataHex}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Badge variant="outline">Decryption Status</Badge>
          <CardTitle className="mt-3">Release controls</CardTitle>
          <CardDescription>
            Direct authority mode is active until the Squads multisig handoff lands from Agent 4.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
            <span className="text-sm text-text-secondary">Decryption</span>
            <Badge variant={record.decryptionAuthorized ? 'success' : 'warning'}>
              {record.decryptionAuthorized ? 'Authorized' : 'Pending'}
            </Badge>
          </div>
          <div className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
            <span className="text-sm text-text-secondary">Source-of-funds indicator</span>
            <Badge variant={credential?.sourceOfFundsHash ? 'success' : 'secondary'}>
              {credential?.sourceOfFundsHash ? 'Verified in credential' : 'Unavailable'}
            </Badge>
          </div>
          {status ? (
            <Alert
              description={status}
              title="Decryption request status"
              variant={status.toLowerCase().includes('unable') ? 'destructive' : 'default'}
            />
          ) : null}
          <Button onClick={handleRequestDecryption} type="button">
            Request Decryption
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
