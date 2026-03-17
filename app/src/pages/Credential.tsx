import { useState } from 'react';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
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
} from '../components/ui/primitives';
import { useToast } from '../components/ui/primitives';
import { useCredential } from '../hooks/useCredential';
import { useRegistryState } from '../hooks/useRegistryState';
import { bigintToHex, textToField } from '../lib/crypto';
import { hashCredentialLeaf, prepareStoredCredential } from '../lib/credential';
import { buildAddCredentialTx, getPrograms } from '../lib/program';
import type { AccreditationTier } from '../lib/types';

const accreditationOptions: Array<{ label: string; value: AccreditationTier }> = [
  { label: 'Retail', value: 'retail' },
  { label: 'Accredited', value: 'accredited' },
  { label: 'Institutional', value: 'institutional' },
];

const nationalityOptions = [
  ['US', 'United States'],
  ['CH', 'Switzerland'],
  ['SG', 'Singapore'],
  ['AE', 'United Arab Emirates'],
  ['GB', 'United Kingdom'],
  ['HK', 'Hong Kong'],
] as const;

async function computeSourceOfFundsHash(reference: string) {
  const { buildPoseidon } = await import('circomlibjs');
  const poseidon = await buildPoseidon();
  return bigintToHex(BigInt(poseidon.F.toString(poseidon([textToField(reference)]))));
}

function downloadAsJson(payload: Record<string, unknown>, filename: string) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return;
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Credential() {
  const { credential, clearCredential, saveCredential } = useCredential();
  const { refresh } = useRegistryState();
  const { toast } = useToast();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();

  const [fullName, setFullName] = useState(credential?.fullName ?? '');
  const [countryCode, setCountryCode] = useState(credential?.countryCode ?? 'US');
  const [dateOfBirth, setDateOfBirth] = useState(credential?.dateOfBirth ?? '1990-01-01');
  const [jurisdiction, setJurisdiction] = useState(credential?.jurisdiction ?? 'Switzerland');
  const [wallet, setWallet] = useState(credential?.wallet ?? '');
  const [accreditation, setAccreditation] = useState<AccreditationTier>(
    credential?.accreditation ?? 'institutional',
  );
  const [expiresAt, setExpiresAt] = useState(
    credential?.expiresAt?.slice(0, 10) ??
      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [identitySecret, setIdentitySecret] = useState(
    credential?.identitySecret ?? `${Date.now()}${Math.floor(Math.random() * 100_000)}`,
  );
  const [sourceOfFundsReference, setSourceOfFundsReference] = useState(
    credential?.sourceOfFundsReference ?? '',
  );
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function hexToBytes(value: string) {
    const normalized = value.replace(/^0x/, '').padStart(64, '0');
    return Array.from(
      { length: normalized.length / 2 },
      (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16),
    );
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus(null);

    if (!fullName || !wallet || !jurisdiction || !sourceOfFundsReference) {
      setStatus('Full name, investor wallet, jurisdiction, and source of funds are required.');
      setIsSubmitting(false);
      return;
    }

    try {
      const issuedAt = new Date().toISOString();
      const expiresAtIso = new Date(expiresAt).toISOString();
      const sourceOfFundsHash = await computeSourceOfFundsHash(sourceOfFundsReference);
      const credentialVersion = 1;
      const leafHash = await hashCredentialLeaf({
        accreditation,
        countryCode,
        credentialVersion,
        dateOfBirth,
        expiresAt: expiresAtIso,
        fullName,
        identitySecret,
        jurisdiction,
        sourceOfFundsHash,
        wallet,
      });

      const stagedCredential = {
        accreditation,
        countryCode,
        credentialVersion,
        dateOfBirth,
        expiresAt: expiresAtIso,
        fullName,
        identitySecret,
        issuedAt,
        jurisdiction,
        leafHash,
        note: 'Operator-issued institutional credential.',
        sourceOfFundsHash,
        sourceOfFundsReference,
        wallet,
      };

      const prepared = await prepareStoredCredential(stagedCredential);
      saveCredential(stagedCredential);
      downloadAsJson(
        {
          ...stagedCredential,
          issuerSignature: prepared.issuerSignature,
        },
        'vaultproof-credential.json',
      );

      if (!anchorWallet || !publicKey || !sendTransaction) {
        setStatus(
          'Credential staged locally and downloaded. Connect the operator authority wallet to submit add_credential on-chain.',
        );
        toast({
          description: 'Credential file downloaded for the investor.',
          title: 'Credential staged',
          variant: 'success',
        });
        return;
      }

      const { kycRegistry } = getPrograms(connection, anchorWallet);
      const transaction = await buildAddCredentialTx({
        leafHash: hexToBytes(leafHash),
        program: kycRegistry,
        signer: publicKey,
      });
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      toast({
        description: signature,
        title: 'Credential issued on-chain',
        variant: 'success',
      });
      setStatus(`Credential issued and registry updated: ${signature}`);
    } catch (caughtError) {
      setStatus(
        caughtError instanceof Error ? caughtError.message : 'Unable to issue credential.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_400px]">
      <Card>
        <CardHeader>
          <Badge variant="secondary">Operator Onboarding</Badge>
          <CardTitle>Issue an investor credential</CardTitle>
          <CardDescription>
            Operator-issued credentials bind nationality, jurisdiction, accreditation, source of
            funds, and a wallet address into the Merkle registry leaf.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Jane Doe"
                value={fullName}
              />
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="nationality">Nationality</Label>
                <Select
                  id="nationality"
                  onChange={(event) => setCountryCode(event.target.value)}
                  value={countryCode}
                >
                  {nationalityOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dob">Date of Birth</Label>
                <Input
                  id="dob"
                  onChange={(event) => setDateOfBirth(event.target.value)}
                  type="date"
                  value={dateOfBirth}
                />
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="jurisdiction">Jurisdiction</Label>
                <Input
                  id="jurisdiction"
                  onChange={(event) => setJurisdiction(event.target.value)}
                  placeholder="Switzerland"
                  value={jurisdiction}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="accreditation">Accreditation Tier</Label>
                <Select
                  id="accreditation"
                  onChange={(event) => setAccreditation(event.target.value as AccreditationTier)}
                  value={accreditation}
                >
                  {accreditationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_180px]">
              <div className="grid gap-2">
                <Label htmlFor="sourceOfFundsReference">Source of Funds Reference</Label>
                <Input
                  id="sourceOfFundsReference"
                  onChange={(event) => setSourceOfFundsReference(event.target.value)}
                  placeholder="Wire transfer from UBS, verified 2026-03-01"
                  value={sourceOfFundsReference}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="credentialVersion">Credential Version</Label>
                <Input id="credentialVersion" readOnly value="1" />
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="expiresAt">Credential Expiry</Label>
                <Input
                  id="expiresAt"
                  onChange={(event) => setExpiresAt(event.target.value)}
                  type="date"
                  value={expiresAt}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="wallet">Investor Wallet Address</Label>
                <Input
                  id="wallet"
                  onChange={(event) => setWallet(event.target.value)}
                  placeholder="Investor main wallet"
                  value={wallet}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="identitySecret">Identity Secret</Label>
              <Input
                id="identitySecret"
                onChange={(event) => setIdentitySecret(event.target.value.replace(/[^\d]/g, ''))}
                value={identitySecret}
              />
            </div>

            {status ? (
              <Alert
                description={status}
                title={status.toLowerCase().includes('unable') ? 'Issuance failed' : 'Issuance status'}
                variant={status.toLowerCase().includes('unable') ? 'destructive' : 'default'}
              />
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button disabled={isSubmitting} type="submit">
                {isSubmitting ? 'Issuing Credential...' : 'Issue Credential'}
              </Button>
              <Button onClick={clearCredential} type="button" variant="secondary">
                Clear Local Copy
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Badge variant="outline">Downloaded Credential</Badge>
          <CardTitle>Current staged artifact</CardTitle>
          <CardDescription>
            The stored credential feeds the investor proof flow and includes source-of-funds hash
            plus credential version.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {credential ? (
            <>
              <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Investor</p>
                <p className="mt-2 text-sm text-text-primary">{credential.fullName}</p>
                <p className="mt-1 font-mono text-xs text-text-secondary">{credential.wallet}</p>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Source of Funds Hash</p>
                <p className="mt-2 break-all font-mono text-xs text-text-secondary">
                  {credential.sourceOfFundsHash}
                </p>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">Leaf Hash</p>
                <p className="mt-2 break-all font-mono text-xs text-text-secondary">
                  {credential.leafHash}
                </p>
              </div>
            </>
          ) : (
            <Alert
              description="Issue a credential to populate the investor proof flow."
              title="No staged credential"
              variant="warning"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
