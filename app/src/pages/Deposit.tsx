import { BN } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useCallback, useMemo, useState } from 'react';
import ProofGenerationModal from '../components/proof/ProofGenerationModal';
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
import { useProofGeneration } from '../hooks/useProofGeneration';
import { useVaultState } from '../hooks/useVaultState';
import { bigintToHex, randomFieldElement, textToField } from '../lib/crypto';
import { formatCurrency } from '../lib/format';
import { buildDepositTx, getPrograms, proofToOnchainFormat } from '../lib/program';
import type { AccreditationTier, StoredCredential } from '../lib/types';

// ---------------------------------------------------------------------------
// Country → identity document mapping
// ---------------------------------------------------------------------------

interface CountryConfig {
  label: string;
  code: string;
  region: 'US' | 'UK' | 'EU' | 'OTHER';
  idLabel: string;
  idPlaceholder: string;
  idMaxLength?: number;
  idPattern?: RegExp;
}

const COUNTRIES: CountryConfig[] = [
  { label: 'United States', code: 'US', region: 'US', idLabel: 'Last 4 digits of SSN', idPlaceholder: '1234', idMaxLength: 4, idPattern: /^\d{4}$/ },
  { label: 'United Kingdom', code: 'GB', region: 'UK', idLabel: 'National Insurance Number', idPlaceholder: 'QQ 12 34 56 A', idMaxLength: 13 },
  { label: 'Germany', code: 'DE', region: 'EU', idLabel: 'National ID Number (Personalausweisnummer)', idPlaceholder: 'T220001293', idMaxLength: 10 },
  { label: 'France', code: 'FR', region: 'EU', idLabel: 'National ID Number (CNI)', idPlaceholder: '123456789012', idMaxLength: 12 },
  { label: 'Switzerland', code: 'CH', region: 'EU', idLabel: 'National ID Number', idPlaceholder: 'C1234567', idMaxLength: 12 },
  { label: 'Canada', code: 'CA', region: 'OTHER', idLabel: 'Social Insurance Number (last 3)', idPlaceholder: '123', idMaxLength: 3, idPattern: /^\d{3}$/ },
  { label: 'Singapore', code: 'SG', region: 'OTHER', idLabel: 'NRIC / FIN Number', idPlaceholder: 'S1234567D', idMaxLength: 9 },
  { label: 'Hong Kong', code: 'HK', region: 'OTHER', idLabel: 'HKID Number', idPlaceholder: 'A123456(7)', idMaxLength: 10 },
  { label: 'Japan', code: 'JP', region: 'OTHER', idLabel: 'My Number (last 4)', idPlaceholder: '1234', idMaxLength: 4, idPattern: /^\d{4}$/ },
  { label: 'United Arab Emirates', code: 'AE', region: 'OTHER', idLabel: 'Emirates ID Number', idPlaceholder: '784-1234-1234567-1', idMaxLength: 18 },
  { label: 'Brazil', code: 'BR', region: 'OTHER', idLabel: 'CPF Number', idPlaceholder: '123.456.789-00', idMaxLength: 14 },
  { label: 'Other', code: 'XX', region: 'OTHER', idLabel: 'Passport Number', idPlaceholder: 'AB1234567', idMaxLength: 20 },
];

// ---------------------------------------------------------------------------
// Wizard step definitions
// ---------------------------------------------------------------------------

type StepId =
  | 'fullName'
  | 'dateOfBirth'
  | 'country'
  | 'identityNumber'
  | 'documentUpload'
  | 'accreditation'
  | 'sourceOfFunds'
  | 'amount'
  | 'walletConnect'
  | 'review'
  | 'proofSubmit';

const STEP_ORDER: StepId[] = [
  'fullName',
  'dateOfBirth',
  'country',
  'identityNumber',
  'documentUpload',
  'accreditation',
  'sourceOfFunds',
  'amount',
  'walletConnect',
  'review',
  'proofSubmit',
];

const STEP_TITLES: Record<StepId, string> = {
  fullName: 'Full Legal Name',
  dateOfBirth: 'Date of Birth',
  country: 'Country of Residence',
  identityNumber: 'Identity Verification',
  documentUpload: 'Document Upload',
  accreditation: 'Investor Accreditation',
  sourceOfFunds: 'Source of Funds',
  amount: 'Deposit Amount',
  walletConnect: 'Connect Wallet',
  review: 'Review & Confirm',
  proofSubmit: 'Generate Proof & Submit',
};

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface DepositFormState {
  fullName: string;
  dateOfBirth: string;
  countryCode: string;
  identityNumber: string;
  documentFile: File | null;
  documentPreview: string | null;
  accreditation: AccreditationTier;
  sourceOfFunds: string;
  amount: string;
}

const INITIAL_FORM: DepositFormState = {
  fullName: '',
  dateOfBirth: '',
  countryCode: '',
  identityNumber: '',
  documentFile: null,
  documentPreview: null,
  accreditation: 'accredited',
  sourceOfFunds: '',
  amount: '',
};

// ---------------------------------------------------------------------------
// Poseidon identity hash
// ---------------------------------------------------------------------------

async function hashIdentity(countryCode: string, idNumber: string): Promise<string> {
  const { buildPoseidon } = await import('circomlibjs');
  const poseidon = await buildPoseidon();
  const countryField = textToField(countryCode);
  const idField = textToField(idNumber);
  const hash = poseidon([countryField, idField]);
  return bigintToHex(BigInt(poseidon.F.toString(hash)));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Deposit() {
  const { toast } = useToast();
  const { data: vault, refresh } = useVaultState();
  const { credential, saveCredential } = useCredential();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction, wallet, disconnect, connected } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  const proofGeneration = useProofGeneration();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<DepositFormState>(INITIAL_FORM);
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currentStepId = STEP_ORDER[step];
  const totalSteps = STEP_ORDER.length;

  const countryConfig = useMemo(
    () => COUNTRIES.find((c) => c.code === form.countryCode) ?? COUNTRIES[COUNTRIES.length - 1],
    [form.countryCode],
  );

  const numericAmount = useMemo(
    () => BigInt(Math.round(Number(form.amount || '0'))),
    [form.amount],
  );

  const update = useCallback(
    <K extends keyof DepositFormState>(key: K, value: DepositFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // Clear identity number when country changes
  const setCountry = useCallback((code: string) => {
    setForm((prev) => ({ ...prev, countryCode: code, identityNumber: '' }));
  }, []);

  // Validation per step
  const canAdvance = useMemo(() => {
    switch (currentStepId) {
      case 'fullName':
        return form.fullName.trim().length >= 2;
      case 'dateOfBirth':
        return form.dateOfBirth.length > 0;
      case 'country':
        return form.countryCode.length > 0;
      case 'identityNumber': {
        const val = form.identityNumber.trim();
        if (!val) return false;
        if (countryConfig.idPattern) return countryConfig.idPattern.test(val);
        return val.length >= 2;
      }
      case 'documentUpload':
        return true; // optional step
      case 'accreditation':
        return !!form.accreditation;
      case 'sourceOfFunds':
        return form.sourceOfFunds.trim().length >= 3;
      case 'amount':
        return numericAmount > 0n;
      case 'walletConnect':
        return !!publicKey;
      case 'review':
        return true;
      case 'proofSubmit':
        return true;
      default:
        return false;
    }
  }, [currentStepId, form, countryConfig, numericAmount]);

  const goNext = () => {
    if (step < totalSteps - 1) setStep(step + 1);
  };
  const goBack = () => {
    if (step > 0) setStep(step - 1);
  };
  const goToStep = (target: number) => {
    if (target < step) setStep(target);
  };

  // Document upload
  const handleDocUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    update('documentFile', file);
    const reader = new FileReader();
    reader.onload = (e) => {
      update('documentPreview', e.target?.result as string);
    };
    reader.readAsDataURL(file);
    toast({ title: 'Document uploaded', description: file.name, variant: 'success' });
  };

  // Build credential and submit proof
  const handleProofAndSubmit = async () => {
    setModalOpen(true);
    setStatus(null);
    setSubmitting(true);

    if (!anchorWallet || !publicKey || !sendTransaction) {
      setStatus('Connect a wallet before submitting a deposit transaction.');
      setSubmitting(false);
      return;
    }

    try {
      // Hash identity number into identitySecret
      const identitySecret = await hashIdentity(form.countryCode, form.identityNumber);
      const sourceOfFundsHash = bigintToHex(textToField(form.sourceOfFunds));

      // Build credential from wizard form data
      const builtCredential: StoredCredential = {
        fullName: form.fullName.trim(),
        dateOfBirth: form.dateOfBirth,
        wallet: publicKey.toBase58(),
        jurisdiction: countryConfig.label,
        countryCode: form.countryCode,
        accreditation: form.accreditation,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        leafHash: '',
        identitySecret,
        sourceOfFundsHash,
        credentialVersion: 1,
        sourceOfFundsReference: form.sourceOfFunds,
      };

      // If we already have a credential stored (e.g. from institution issuance), prefer it
      // Otherwise save the one we just built
      const activeCredential = credential ?? builtCredential;
      if (!credential) {
        saveCredential(builtCredential);
      }

      const proofResult = await proofGeneration.generate({
        amount: numericAmount,
        credential: activeCredential,
        recipient: 'vault_reserve',
        thresholds: vault.thresholds,
        regulatorPubkey: vault.regulatorKey,
      });

      if (!proofResult) {
        setSubmitting(false);
        return;
      }

      const { vusdVault } = getPrograms(connection, anchorWallet);
      const { proofA, proofB, proofC, publicInputs } = proofToOnchainFormat(
        proofResult.proof,
        proofResult.publicSignals,
      );
      const { storeProofTx, depositTx } = await buildDepositTx({
        amount: new BN(numericAmount.toString()),
        encryptedMetadata: proofResult.encryptedMetadata,
        program: vusdVault,
        proofA,
        proofB,
        proofC,
        publicInputs,
        signer: publicKey,
      });

      // Transaction 1: Store proof data in buffer PDA
      const storeSig = await sendTransaction(storeProofTx, connection);
      await connection.confirmTransaction(storeSig, 'confirmed');

      // Transaction 2: Execute deposit referencing the proof buffer
      const signature = await sendTransaction(depositTx, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      await refresh();
      toast({
        description: signature,
        title: 'Deposit submitted',
        variant: 'success',
      });
      setStatus(`Deposit submitted: ${signature}`);
    } catch (caughtError) {
      setStatus(caughtError instanceof Error ? caughtError.message : 'Unable to submit deposit.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Step renderers
  // ---------------------------------------------------------------------------

  function renderStepContent() {
    switch (currentStepId) {
      case 'fullName':
        return (
          <div className="grid gap-2">
            <Label htmlFor="fullName">Full Legal Name</Label>
            <Input
              id="fullName"
              placeholder="As it appears on your government-issued ID"
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
              autoFocus
            />
            <p className="text-xs text-text-tertiary">
              Must match the name on your identity document exactly.
            </p>
          </div>
        );

      case 'dateOfBirth':
        return (
          <div className="grid gap-2">
            <Label htmlFor="dob">Date of Birth</Label>
            <Input
              id="dob"
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => update('dateOfBirth', e.target.value)}
              autoFocus
            />
          </div>
        );

      case 'country':
        return (
          <div className="grid gap-2">
            <Label htmlFor="country">Country of Residence</Label>
            <Select
              id="country"
              value={form.countryCode}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="">Select your country</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
            {form.countryCode && (
              <p className="text-xs text-text-tertiary">
                {countryConfig.region === 'EU'
                  ? 'Regulated under MiCA (Markets in Crypto-Assets Regulation).'
                  : countryConfig.region === 'US'
                    ? 'Regulated under U.S. securities law (SEC / FinCEN).'
                    : countryConfig.region === 'UK'
                      ? 'Regulated under UK FCA guidelines.'
                      : 'International compliance standards apply.'}
              </p>
            )}
          </div>
        );

      case 'identityNumber':
        return (
          <div className="grid gap-2">
            <Label htmlFor="idNumber">{countryConfig.idLabel}</Label>
            <Input
              id="idNumber"
              placeholder={countryConfig.idPlaceholder}
              maxLength={countryConfig.idMaxLength}
              value={form.identityNumber}
              onChange={(e) => update('identityNumber', e.target.value)}
              autoFocus
            />
            <p className="text-xs text-text-tertiary">
              This value is hashed locally using Poseidon and never leaves your browser.
              Only the cryptographic hash is included in the ZK proof.
            </p>
          </div>
        );

      case 'documentUpload':
        return (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="docUpload">Upload Identity Document</Label>
              <Input
                id="docUpload"
                type="file"
                accept="image/*,.pdf"
                onChange={handleDocUpload}
              />
              <p className="text-xs text-text-tertiary">
                Accepted: passport, national ID, or driver's license. JPG, PNG, or PDF.
              </p>
            </div>
            {form.documentPreview && (
              <div className="rounded-[var(--radius)] border border-border overflow-hidden">
                <img
                  src={form.documentPreview}
                  alt="Document preview"
                  className="max-h-48 w-full object-contain bg-bg-primary"
                />
              </div>
            )}
            {form.documentFile && (
              <div className="flex items-center gap-2">
                <Badge variant="success">Uploaded</Badge>
                <span className="text-sm text-text-secondary">{form.documentFile.name}</span>
              </div>
            )}
            <Alert
              title="AI verification coming soon"
              description="Document verification via AI-powered OCR is under development. Your upload is saved locally for this session but will not be processed automatically yet."
              variant="default"
            />
          </div>
        );

      case 'accreditation':
        return (
          <div className="grid gap-2">
            <Label htmlFor="accreditation">Investor Accreditation Tier</Label>
            <Select
              id="accreditation"
              value={form.accreditation}
              onChange={(e) => update('accreditation', e.target.value as AccreditationTier)}
            >
              <option value="retail">Retail Investor</option>
              <option value="accredited">Accredited Investor</option>
              <option value="institutional">Institutional Investor</option>
            </Select>
            <div className="mt-2 grid gap-2 text-xs text-text-tertiary">
              <p>
                <span className="font-medium text-text-secondary">Retail:</span> Deposit up to{' '}
                {formatCurrency(vault.thresholds.retail)}
              </p>
              <p>
                <span className="font-medium text-text-secondary">Accredited:</span> Deposit up to{' '}
                {formatCurrency(vault.thresholds.accredited)}
              </p>
              <p>
                <span className="font-medium text-text-secondary">Institutional:</span> Deposit up to{' '}
                {formatCurrency(vault.thresholds.institutional)}
              </p>
            </div>
          </div>
        );

      case 'sourceOfFunds':
        return (
          <div className="grid gap-2">
            <Label htmlFor="sourceOfFunds">Source of Funds Reference</Label>
            <Input
              id="sourceOfFunds"
              placeholder="e.g., Wire transfer from UBS, verified 2026-03-01"
              value={form.sourceOfFunds}
              onChange={(e) => update('sourceOfFunds', e.target.value)}
              autoFocus
            />
            <p className="text-xs text-text-tertiary">
              Describe the origin of the funds you are depositing. This is hashed into your
              compliance proof for Travel Rule compliance.
            </p>
          </div>
        );

      case 'amount':
        return (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="amount">Deposit Amount (USDC)</Label>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder="10,000"
                value={form.amount}
                onChange={(e) => update('amount', e.target.value.replace(/[^\d.]/g, ''))}
                autoFocus
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">
                  Share Price
                </p>
                <p className="mt-2 text-sm text-text-primary">
                  {vault.sharePrice > 0 ? `$${vault.sharePrice.toFixed(3)}` : 'Awaiting first mint'}
                </p>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">
                  Tier Limit
                </p>
                <p className="mt-2 text-sm text-text-primary">
                  {formatCurrency(vault.thresholds[form.accreditation] ?? vault.thresholds.retail)}
                </p>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">
                  Est. Shares
                </p>
                <p className="mt-2 text-sm text-text-primary">
                  {vault.sharePrice > 0 && numericAmount > 0n
                    ? (Number(numericAmount) / vault.sharePrice).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })
                    : '—'}
                </p>
              </div>
            </div>
          </div>
        );

      case 'walletConnect':
        return (
          <div className="grid gap-4">
            {connected && publicKey ? (
              <>
                <div className="rounded-[var(--radius)] border border-success/30 bg-success/5 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10">
                      <span className="text-success text-lg">&#10003;</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text-primary">Wallet Connected</p>
                      <p className="mt-0.5 font-mono text-xs text-text-tertiary">
                        {publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-8)}
                      </p>
                    </div>
                    {wallet?.adapter.icon && (
                      <img
                        src={wallet.adapter.icon}
                        alt={wallet.adapter.name}
                        className="h-8 w-8 rounded-lg"
                      />
                    )}
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => openWalletModal(true)}
                  >
                    Switch Wallet
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => disconnect()}
                  >
                    Disconnect
                  </Button>
                </div>
                <p className="text-xs text-text-tertiary">
                  Connected via {wallet?.adapter.name ?? 'unknown wallet'}. Your deposit transaction
                  will be signed by this wallet.
                </p>
              </>
            ) : (
              <>
                <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-6 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
                    <span className="text-2xl">&#128274;</span>
                  </div>
                  <p className="text-sm font-medium text-text-primary">
                    Connect a Solana wallet to continue
                  </p>
                  <p className="mt-2 text-xs text-text-tertiary">
                    Supports Phantom, Solflare, Coinbase, Backpack, and any wallet
                    that implements the Solana Wallet Standard.
                  </p>
                  <Button
                    className="mt-4"
                    onClick={() => openWalletModal(true)}
                  >
                    Select Wallet
                  </Button>
                </div>
              </>
            )}
          </div>
        );

      case 'review':
        return (
          <div className="grid gap-4">
            {[
              { label: 'Full Name', value: form.fullName, editStep: 0 },
              { label: 'Date of Birth', value: form.dateOfBirth, editStep: 1 },
              { label: 'Country', value: countryConfig.label, editStep: 2 },
              { label: countryConfig.idLabel, value: form.countryCode === 'US' ? `****${form.identityNumber}` : form.identityNumber, editStep: 3 },
              { label: 'Document', value: form.documentFile ? form.documentFile.name : 'Not uploaded', editStep: 4 },
              { label: 'Accreditation', value: form.accreditation.charAt(0).toUpperCase() + form.accreditation.slice(1), editStep: 5 },
              { label: 'Source of Funds', value: form.sourceOfFunds, editStep: 6 },
              { label: 'Deposit Amount', value: `${Number(form.amount).toLocaleString()} USDC`, editStep: 7 },
              { label: 'Wallet', value: publicKey ? `${publicKey.toBase58().slice(0, 8)}...${publicKey.toBase58().slice(-8)}` : 'Not connected', editStep: 8 },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-3"
              >
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">
                    {row.label}
                  </p>
                  <p className="mt-1 text-sm text-text-primary">{row.value}</p>
                </div>
                <button
                  type="button"
                  onClick={() => goToStep(row.editStep)}
                  className="text-xs text-accent hover:underline"
                >
                  Edit
                </button>
              </div>
            ))}
            {vault.sharePrice > 0 && numericAmount > 0n && (
              <div className="rounded-[var(--radius)] border border-accent/20 bg-accent/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">
                  Estimated Shares to Receive
                </p>
                <p className="mt-1 text-lg font-medium text-text-primary">
                  {(Number(numericAmount) / vault.sharePrice).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}{' '}
                  shares
                </p>
              </div>
            )}
          </div>
        );

      case 'proofSubmit':
        return (
          <div className="grid gap-4">
            <div className="rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4">
              <p className="text-sm text-text-secondary">
                Clicking below will generate a Groth16 zero-knowledge proof in your browser. Your
                identity number is hashed locally — only the cryptographic proof is submitted
                on-chain.
              </p>
            </div>
            {[
              'Hash identity with Poseidon and build credential witness.',
              'Fetch current registry root and vault thresholds from Solana.',
              'Generate the Groth16 proof and encrypt Travel Rule metadata.',
              'Submit deposit_with_proof and confirm the share mint.',
            ].map((desc, index) => (
              <div
                key={desc}
                className="flex gap-3 rounded-[var(--radius)] border border-border bg-bg-primary px-4 py-4"
              >
                <span className="font-mono text-xs text-text-tertiary">0{index + 1}</span>
                <p className="text-sm leading-6 text-text-secondary">{desc}</p>
              </div>
            ))}
            {status && (
              <Alert
                description={status}
                title={status.toLowerCase().includes('unable') ? 'Deposit failed' : 'Deposit status'}
                variant={status.toLowerCase().includes('unable') ? 'destructive' : 'success'}
              />
            )}
          </div>
        );

      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Badge variant="secondary">Deposit</Badge>
            <span className="text-xs text-text-tertiary">
              Step {step + 1} of {totalSteps}
            </span>
          </div>
          <CardTitle className="mt-3">{STEP_TITLES[currentStepId]}</CardTitle>
          <CardDescription>
            {currentStepId === 'walletConnect'
              ? 'Connect the Solana wallet you want to deposit from.'
              : currentStepId === 'review'
                ? 'Review your information before generating the compliance proof.'
                : currentStepId === 'proofSubmit'
                  ? 'Generate a zero-knowledge proof and submit your deposit on-chain.'
                  : 'Complete each step to build your compliance credential and deposit.'}
          </CardDescription>

          {/* Progress bar */}
          <div className="mt-4 flex gap-1">
            {STEP_ORDER.map((_, index) => (
              <div
                key={index}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  index < step
                    ? 'bg-success'
                    : index === step
                      ? 'bg-accent'
                      : 'bg-border'
                }`}
              />
            ))}
          </div>
        </CardHeader>

        <CardContent>
          <div className="min-h-[200px]">{renderStepContent()}</div>

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={goBack}
              disabled={step === 0}
            >
              Back
            </Button>

            {currentStepId === 'proofSubmit' ? (
              <Button
                onClick={handleProofAndSubmit}
                disabled={!publicKey || submitting || numericAmount === 0n}
              >
                {submitting ? 'Generating...' : 'Generate Proof & Deposit'}
              </Button>
            ) : currentStepId === 'walletConnect' ? (
              <Button onClick={goNext} disabled={!connected}>
                {connected ? 'Continue' : 'Connect a Wallet Above'}
              </Button>
            ) : (
              <Button onClick={goNext} disabled={!canAdvance}>
                {currentStepId === 'review' ? 'Proceed to Proof' : 'Continue'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <ProofGenerationModal
        error={proofGeneration.error}
        isGenerating={proofGeneration.isGenerating}
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          proofGeneration.reset();
        }}
        proofTime={proofGeneration.proofTime}
        steps={proofGeneration.timeline}
        title="Deposit proof generation"
      />
    </div>
  );
}
