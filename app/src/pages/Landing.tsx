import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, FileCheck, Activity } from 'lucide-react';
import { BrandMark } from '../components/layout/AppChrome';

function PrivacyDiagram() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-accent/30 bg-accent/10">
          <ShieldCheck className="h-5 w-5 text-accent" />
        </div>
        <div className="h-px w-8 bg-border" />
        <div className="rounded-lg border border-border bg-bg-primary px-3 py-2">
          <p className="font-mono text-[10px] text-text-tertiary">ZK PROOF</p>
          <p className="font-mono text-[11px] text-accent">Groth16</p>
        </div>
        <div className="h-px w-8 bg-border" />
        <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2">
          <p className="font-mono text-[10px] text-text-tertiary">ON-CHAIN</p>
          <p className="font-mono text-[11px] text-success">Verified</p>
        </div>
      </div>
      <div className="flex items-center gap-6 text-[10px]">
        <span className="rounded border border-border px-2 py-1 font-mono text-text-tertiary">KYC</span>
        <span className="rounded border border-border px-2 py-1 font-mono text-text-tertiary">Jurisdiction</span>
        <span className="rounded border border-border px-2 py-1 font-mono text-text-tertiary">Accreditation</span>
        <span className="rounded border border-border px-2 py-1 font-mono text-text-tertiary">AML Tier</span>
      </div>
      <p className="font-mono text-[10px] text-text-tertiary">Identity never touches the chain</p>
    </div>
  );
}

function ComplianceDiagram() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
      <div className="flex items-center gap-2">
        {['Deposit', 'Transfer', 'Withdraw'].map((type, i) => (
          <div key={type} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-4 bg-border" />}
            <div className="rounded-lg border border-border bg-bg-primary px-3 py-2 text-center">
              <p className="font-mono text-[10px] text-text-tertiary">{type}</p>
            </div>
          </div>
        ))}
      </div>
      <svg width="2" height="24" className="text-border"><line x1="1" y1="0" x2="1" y2="24" stroke="currentColor" strokeDasharray="4 2" /></svg>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-success/30 bg-success/10">
          <FileCheck className="h-4 w-4 text-success" />
        </div>
        <div>
          <p className="font-mono text-[11px] font-medium text-text-primary">TransferRecord</p>
          <p className="font-mono text-[10px] text-text-tertiary">Proof hash + encrypted metadata + timestamp</p>
        </div>
      </div>
      <svg width="2" height="16" className="text-border"><line x1="1" y1="0" x2="1" y2="16" stroke="currentColor" strokeDasharray="4 2" /></svg>
      <div className="flex items-center gap-4 text-[10px]">
        <span className="rounded border border-success/30 px-2 py-1 font-mono text-success">Source of Funds</span>
        <span className="rounded border border-accent/30 px-2 py-1 font-mono text-accent">Multisig Decrypt</span>
      </div>
    </div>
  );
}

function RiskDiagram() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-warning/30 bg-warning/10">
          <Activity className="h-4 w-4 text-warning" />
        </div>
        <div>
          <p className="font-mono text-[11px] font-medium text-text-primary">Risk Oracle</p>
          <p className="font-mono text-[10px] text-text-tertiary">Per-address scoring + staleness checks</p>
        </div>
      </div>
      <div className="grid w-full max-w-[320px] grid-cols-2 gap-2">
        {[
          ['Circuit Breaker', '500K USDC'],
          ['Max Transaction', '250K USDC'],
          ['Velocity Limit', '40/day'],
          ['Deposit Cap', '1M USDC'],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-border bg-bg-primary px-3 py-2">
            <p className="font-mono text-[9px] text-text-tertiary">{label}</p>
            <p className="font-mono text-[11px] text-text-primary">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const bundleDiagrams = [PrivacyDiagram, ComplianceDiagram, RiskDiagram];

const bundles = [
  {
    number: '01',
    label: 'Privacy Bundle',
    labelColor: 'text-accent',
    title: 'Confidential identity, visible rails.',
    description:
      'Zero-knowledge proofs verify KYC, accreditation, and jurisdiction without revealing investor identity on-chain. Travel Rule metadata is encrypted for authorized compliance review only.',
  },
  {
    number: '02',
    label: 'Compliance Bundle',
    labelColor: 'text-success',
    title: 'On-chain audit trail.',
    description:
      'Every deposit, transfer, and withdrawal creates a TransferRecord. Source-of-funds demands flow through multisig-approved workflows. Compliance officers monitor the protocol without accessing private data.',
  },
  {
    number: '03',
    label: 'Risk Bundle',
    labelColor: 'text-warning',
    title: 'Protocol-level controls.',
    description:
      'Risk oracle integration with staleness checks, per-address risk scoring, circuit breakers, velocity controls, and deposit concentration limits enforced at the program level.',
  },
];

const steps = [
  { label: 'Credential Issuance', description: 'Operators issue wallet-bound credentials encoding accreditation, jurisdiction, and source-of-funds attestation.' },
  { label: 'Proof Generation', description: 'Investors generate browser-side Groth16 proofs against the registry Merkle root and current vault thresholds.' },
  { label: 'On-chain Verification', description: 'The vault program verifies the proof and encrypted Travel Rule metadata before executing the transaction.' },
  { label: 'Compliance Monitoring', description: 'Compliance officers monitor TransferRecords, trigger multisig-approved decryption, and investigate outliers.' },
];

const proofPoints = [
  'Built on Solana',
  'Groth16 Verified',
  'ZK Compliance',
  'Institutional Grade',
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-border-subtle" style={{ background: 'rgba(9,9,11,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4 lg:px-12">
          <BrandMark />
          <div className="hidden items-center gap-8 text-[13px] text-text-tertiary md:flex">
            <a className="transition-colors duration-150 hover:text-text-primary" href="#bundles">
              Infrastructure
            </a>
            <a className="transition-colors duration-150 hover:text-text-primary" href="#architecture">
              Architecture
            </a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              className="hidden text-[13px] text-text-secondary transition-colors duration-150 hover:text-text-primary sm:inline"
              to="/investor"
            >
              For Investors
            </Link>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-accent-hover"
              to="/institution"
            >
              For Institutions
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative mx-auto max-w-[1200px] px-6 pb-24 pt-24 lg:px-12 lg:pt-32">
        <div className="pointer-events-none absolute -left-32 -top-32 h-[600px] w-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(37,99,235,0.08) 0%, transparent 70%)' }} />
        <div className="relative grid items-start gap-16 lg:grid-cols-[3fr_2fr]">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
              Zero-Knowledge Compliance Infrastructure
            </p>
            <h1
              className="mt-6 max-w-[560px] text-[clamp(2.5rem,5vw,4rem)] leading-[1.05] tracking-[-0.03em] text-text-primary"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Compliant vaults for institutional capital.
            </h1>
            <p className="mt-6 max-w-[480px] text-lg leading-[1.7] text-text-secondary">
              A privacy-preserving vault protocol on Solana where zero-knowledge proofs
              replace identity disclosure. Deposits, transfers, and withdrawals execute
              only when cryptographic compliance is verified on-chain.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                className="inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-7 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-accent-hover"
                to="/institution"
              >
                For Institutions
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                className="inline-flex h-12 items-center gap-2 rounded-lg border border-border px-7 text-[15px] font-medium text-text-primary transition-colors duration-150 hover:bg-surface"
                to="/investor"
              >
                For Investors
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="hidden lg:block">
            <div className="flex h-[320px] flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-surface px-8">
              <div className="flex items-center gap-3">
                <div className="rounded-lg border border-border bg-bg-primary px-4 py-3 text-center">
                  <p className="font-mono text-[9px] uppercase text-text-tertiary">Witness</p>
                  <p className="font-mono text-[12px] text-text-primary">Private Input</p>
                </div>
                <svg width="32" height="2"><line x1="0" y1="1" x2="32" y2="1" stroke="#27272A" /></svg>
                <div className="relative rounded-xl border border-accent/40 bg-accent/5 px-5 py-4 text-center">
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-accent px-2 py-0.5 font-mono text-[8px] font-medium text-white">GROTH16</div>
                  <p className="mt-1 font-mono text-[10px] text-text-tertiary">compliance.circom</p>
                  <p className="font-mono text-[13px] font-medium text-accent">49K constraints</p>
                  <p className="font-mono text-[9px] text-text-tertiary">22 public inputs</p>
                </div>
                <svg width="32" height="2"><line x1="0" y1="1" x2="32" y2="1" stroke="#27272A" /></svg>
                <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-center">
                  <p className="font-mono text-[9px] uppercase text-text-tertiary">Output</p>
                  <p className="font-mono text-[12px] text-success">Proof</p>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {['EdDSA Sig', 'Merkle Path', 'AML Tiers', 'ElGamal Enc', 'Solvency'].map((label) => (
                  <span key={label} className="rounded border border-border px-2 py-1 font-mono text-[9px] text-text-tertiary">{label}</span>
                ))}
              </div>
              <p className="font-mono text-[10px] text-text-tertiary">Browser-side proof generation via snarkjs + WASM</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Social Proof Bar ── */}
      <div className="border-y border-border-subtle bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-12 gap-y-3 px-6 py-4 lg:px-12">
          {proofPoints.map((point, i) => (
            <span key={point} className="flex items-center gap-12 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
              {i > 0 && <span className="mr-0 text-border">·</span>}
              {point}
            </span>
          ))}
        </div>
      </div>

      {/* ── Three Bundles ── */}
      <section className="mx-auto max-w-[1200px] px-6 py-24 lg:px-12" id="bundles">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
          What VaultProof Provides
        </p>
        <h2
          className="mt-4 max-w-[480px] text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-[-0.03em] text-text-primary"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Three layers of institutional trust.
        </h2>

        <div className="mt-16 space-y-0">
          {bundles.map((bundle, i) => (
            <div
              key={bundle.number}
              className={`grid items-center gap-12 py-12 lg:grid-cols-2 ${i > 0 ? 'border-t border-border-subtle' : ''}`}
            >
              <div>
                <p className={`font-mono text-[11px] font-medium uppercase tracking-[0.12em] ${bundle.labelColor}`}>
                  {bundle.number} / {bundle.label}
                </p>
                <h3
                  className="mt-3 text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.15] tracking-[-0.02em] text-text-primary"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {bundle.title}
                </h3>
                <p className="mt-4 max-w-[440px] text-[15px] leading-[1.7] text-text-secondary">
                  {bundle.description}
                </p>
              </div>
              <div className="flex h-[200px] items-center justify-center rounded-xl border border-border bg-surface">
                {(() => { const Diagram = bundleDiagrams[i]; return Diagram ? <Diagram /> : null; })()}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Architecture ── */}
      <section className="border-t border-border-subtle" id="architecture">
        <div className="mx-auto max-w-[1200px] px-6 py-24 lg:px-12">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
            Architecture
          </p>
          <h2
            className="mt-4 max-w-[480px] text-[clamp(2rem,4vw,3rem)] leading-[1.1] tracking-[-0.03em] text-text-primary"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            How VaultProof works
          </h2>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <div key={step.label} className="relative">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-elevated font-mono text-sm text-text-secondary">
                  {String(i + 1).padStart(2, '0')}
                </div>
                <h3 className="text-[15px] font-semibold text-text-primary">{step.label}</h3>
                <p className="mt-2 text-[13px] leading-[1.7] text-text-secondary">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Split CTA ── */}
      <section className="border-t border-border-subtle">
        <div className="mx-auto max-w-[1200px] px-6 py-24 lg:px-12">
          <div className="grid overflow-hidden rounded-2xl border border-border-subtle lg:grid-cols-2">
            <div className="flex flex-col gap-4 bg-bg-primary p-12 lg:p-16">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
                For Institutions
              </p>
              <h3
                className="text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.15] tracking-[-0.02em] text-text-primary"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Operate a compliant vault.
              </h3>
              <p className="max-w-[380px] text-[15px] leading-[1.7] text-text-secondary">
                Deploy permissioned vaults with built-in ZK compliance, risk controls,
                and regulatory infrastructure. No identity data ever touches the chain.
              </p>
              <div className="mt-4">
                <Link
                  className="inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-7 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-accent-hover"
                  to="/institution"
                >
                  Launch Institution Console
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <div className="flex flex-col gap-4 border-t border-border-subtle bg-surface p-12 lg:border-l lg:border-t-0 lg:p-16">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
                For Investors
              </p>
              <h3
                className="text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.15] tracking-[-0.02em] text-text-primary"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Access institutional yield.
              </h3>
              <p className="max-w-[380px] text-[15px] leading-[1.7] text-text-secondary">
                Generate privacy-preserving credentials and participate in institutional
                vaults. Your compliance is proven cryptographically — your identity stays private.
              </p>
              <div className="mt-4">
                <Link
                  className="inline-flex h-12 items-center gap-2 rounded-lg border border-border px-7 text-[15px] font-medium text-text-primary transition-colors duration-150 hover:bg-elevated"
                  to="/investor"
                >
                  Enter Investor Portal
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-6 lg:px-12">
          <BrandMark />
          <p className="font-mono text-[11px] text-text-tertiary">&copy; {new Date().getFullYear()} VaultProof</p>
        </div>
      </footer>
    </div>
  );
}
