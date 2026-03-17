import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Lock,
  ShieldCheck,
  TrendingUp,
  Waypoints,
} from 'lucide-react';
import { BrandMark } from '../components/layout/AppChrome';
import { Separator } from '../components/ui/primitives';

const capabilities = [
  {
    description:
      'Groth16 proofs verify KYC, accreditation, jurisdiction, and source-of-funds compliance without revealing investor identity on-chain.',
    icon: ShieldCheck,
    title: 'ZK Compliance Engine',
  },
  {
    description:
      'Circuit breakers, transaction limits, velocity checks, and deposit concentration controls enforce policy at the protocol level.',
    icon: Waypoints,
    title: 'Risk Controls',
  },
  {
    description:
      'Whitelisted venue management, yield accrual accounting, and share-price appreciation tracked through a transparent on-chain model.',
    icon: TrendingUp,
    title: 'Yield Governance',
  },
  {
    description:
      'Pluggable custody provider abstraction supporting self-custody, Fireblocks, BitGo, and Anchorage configurations.',
    icon: Lock,
    title: 'Custody Architecture',
  },
];

const steps = [
  {
    heading: 'Credential Issuance',
    description:
      'Operators issue wallet-bound credentials encoding accreditation level, jurisdiction, and source-of-funds attestation.',
  },
  {
    heading: 'Proof Generation',
    description:
      'Investors generate browser-side Groth16 proofs against the registry Merkle root and current vault thresholds.',
  },
  {
    heading: 'On-chain Verification',
    description:
      'The vault program verifies the proof and encrypted Travel Rule metadata before executing deposits, transfers, or withdrawals.',
  },
  {
    heading: 'Compliance Monitoring',
    description:
      'Compliance officers monitor TransferRecords, trigger multisig-approved decryption workflows, and investigate outliers.',
  },
];

const proofPoints = [
  'Solana',
  'Groth16 Verified',
  'Zero-Knowledge Proofs',
  'Institutional Grade',
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-bg-primary/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
          <BrandMark />
          <div className="hidden items-center gap-8 text-sm text-text-secondary md:flex">
            <a className="transition-colors hover:text-text-primary" href="#capabilities">
              Capabilities
            </a>
            <a className="transition-colors hover:text-text-primary" href="#architecture">
              Architecture
            </a>
          </div>
          <div className="flex items-center gap-3">
            <Link
              className="hidden text-sm text-text-secondary transition-colors hover:text-text-primary sm:inline"
              to="/investor"
            >
              Investor Portal
            </Link>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-text-primary transition-colors hover:bg-white/[0.08]"
              to="/developer"
            >
              Developer Console
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-7xl px-6 pb-28 pt-24 lg:px-10 lg:pt-32">
        <p className="text-[11px] uppercase tracking-[0.28em] text-text-tertiary">
          Zero-Knowledge Compliance Infrastructure
        </p>
        <h1 className="mt-6 max-w-4xl font-[var(--font-display)] text-[clamp(2.5rem,6vw,4.5rem)] font-medium leading-[1.05] tracking-[-0.04em] text-text-primary" style={{ fontFamily: 'var(--font-display)' }}>
          Compliant infrastructure for institutional digital assets.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-text-secondary">
          A privacy-preserving vault protocol where zero-knowledge proofs replace identity disclosure.
          Deposits, transfers, and withdrawals execute only when cryptographic compliance is verified on-chain.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-7 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            to="/developer"
          >
            Developer Console
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            className="inline-flex h-12 items-center gap-2 rounded-full border border-white/10 px-7 text-sm font-medium text-text-primary transition-colors hover:bg-white/[0.04]"
            to="/investor"
          >
            Investor Portal
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ── Social Proof Bar ── */}
      <div className="border-y border-white/[0.06] bg-surface/40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-5 lg:px-10">
          {proofPoints.map((point, i) => (
            <span key={point} className="flex items-center gap-8 text-xs uppercase tracking-[0.2em] text-text-tertiary">
              {i > 0 && <span className="mr-0 text-white/10">·</span>}
              {point}
            </span>
          ))}
        </div>
      </div>

      {/* ── Capabilities ── */}
      <section className="mx-auto max-w-7xl px-6 py-28 lg:px-10" id="capabilities">
        <p className="text-[11px] uppercase tracking-[0.28em] text-text-tertiary">Capabilities</p>
        <h2
          className="mt-4 max-w-2xl text-4xl font-medium leading-[1.1] tracking-[-0.03em] text-text-primary sm:text-5xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Built for regulated institutions, not retail demos.
        </h2>

        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {capabilities.map((cap) => {
            const Icon = cap.icon;
            return (
              <div
                key={cap.title}
                className="rounded-2xl bg-surface p-8 transition-colors hover:bg-elevated/60"
              >
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.08] bg-elevated">
                  <Icon className="h-5 w-5 text-text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-text-primary">{cap.title}</h3>
                <p className="mt-2 text-sm leading-7 text-text-secondary">{cap.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      <Separator />

      {/* ── Architecture ── */}
      <section className="mx-auto max-w-7xl px-6 py-28 lg:px-10" id="architecture">
        <p className="text-[11px] uppercase tracking-[0.28em] text-text-tertiary">Architecture</p>
        <h2
          className="mt-4 max-w-2xl text-4xl font-medium leading-[1.1] tracking-[-0.03em] text-text-primary sm:text-5xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          How VaultProof works
        </h2>

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          {steps.map((step, i) => (
            <div
              key={step.heading}
              className="flex gap-5 rounded-2xl bg-surface p-8"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-elevated text-sm font-medium text-text-secondary">
                {String(i + 1).padStart(2, '0')}
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-primary">{step.heading}</h3>
                <p className="mt-2 text-sm leading-7 text-text-secondary">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-white/[0.06] bg-surface/40">
        <div className="mx-auto max-w-7xl px-6 py-24 text-center lg:px-10">
          <h2
            className="mx-auto max-w-xl text-3xl font-medium leading-[1.1] tracking-[-0.03em] text-text-primary sm:text-4xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Start building with VaultProof.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-text-secondary">
            Connect a wallet and explore the developer console or investor portal.
            All proof generation happens in your browser — nothing leaves the client.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-7 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              to="/developer"
            >
              Developer Console
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              className="inline-flex h-12 items-center gap-2 rounded-full border border-white/10 px-7 text-sm font-medium text-text-primary transition-colors hover:bg-white/[0.04]"
              to="/investor"
            >
              Investor Portal
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
          <BrandMark />
          <p className="text-xs text-text-tertiary">&copy; {new Date().getFullYear()} VaultProof</p>
        </div>
      </footer>
    </div>
  );
}
