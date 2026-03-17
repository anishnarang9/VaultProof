import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

export const EMPTY_PUBLIC_KEY = new PublicKey('11111111111111111111111111111111');

export type AccreditationTier = 'retail' | 'accredited' | 'institutional' | 'expired';
export type CustodyProvider = 'SelfCustody' | 'Fireblocks' | 'BitGo' | 'Anchorage';
export type ProofLifecycleStep =
  | 'idle'
  | 'loading-circuit'
  | 'fetching-context'
  | 'building-witness'
  | 'generating-proof'
  | 'encrypting-metadata'
  | 'ready'
  | 'error';

export const TransferType = {
  Deposit: 'Deposit',
  Transfer: 'Transfer',
  Withdrawal: 'Withdrawal',
} as const;

export type TransferType = (typeof TransferType)[keyof typeof TransferType];

export interface VaultThresholds {
  retail: BN;
  accredited: BN;
  institutional: BN;
  expired: BN;
}

export interface RegulatorKey {
  x: number[];
  y: number[];
}

export interface VaultState {
  authority: PublicKey;
  custodyAuthority: PublicKey;
  custodyProvider: CustodyProvider;
  usdcMint: PublicKey;
  shareMint: PublicKey;
  usdcReserve: PublicKey;
  totalAssets: BN;
  totalShares: BN;
  sharePriceNumerator: BN;
  sharePriceDenominator: BN;
  yieldSource: PublicKey;
  liquidBufferBps: number;
  totalYieldEarned: BN;
  amlThresholds: [BN, BN, BN];
  expiredThreshold: BN;
  dailyOutflowTotal: BN;
  outflowWindowStart: BN;
  circuitBreakerThreshold: BN;
  paused: boolean;
  maxSingleTransaction: BN;
  maxSingleDeposit: BN;
  maxDailyTransactions: number;
  dailyTransactionCount: number;
  emergencyTimelock: BN;
  regulatorPubkeyX: number[];
  regulatorPubkeyY: number[];
  bump: number;
  reserveBump: number;
}

export interface VaultStateView extends VaultState {
  sharePrice: number;
  circuitBreakerUsage: number;
  liquidBufferRatio: number;
  regulatorKey: RegulatorKey;
  thresholds: VaultThresholds;
}

export interface KycRegistry {
  authority: PublicKey;
  stateTreePubkey: PublicKey;
  credentialCount: BN;
  revokedCount: BN;
  issuerPubkey: number[];
  merkleRoot: number[];
  bump: number;
}

export interface StateTree {
  registry: PublicKey;
  root: number[];
  depth: number;
  nextIndex: BN;
  bump: number;
}

export interface CredentialLeaf {
  registry: PublicKey;
  stateTree: PublicKey;
  leafHash: number[];
  leafIndex: BN;
  active: boolean;
  bump: number;
}

export interface CredentialLeafWithAddress extends CredentialLeaf {
  address: PublicKey;
}

export interface RegistryStateView {
  registry: KycRegistry;
  stateTree: StateTree;
  credentialCount: BN;
  revokedCount: BN;
  activeCredentials: BN;
  merkleRoot: number[];
  merkleRootHex: string;
}

export interface TransferRecord {
  proofHash: number[];
  transferType: TransferType;
  amount: BN;
  timestamp: BN;
  merkleRootSnapshot: number[];
  encryptedMetadata: number[];
  decryptionAuthorized: boolean;
  signer: PublicKey;
  bump: number;
}

export interface TransferRecordWithAddress extends TransferRecord {
  address: PublicKey;
}

export interface StoredCredential {
  fullName: string;
  dateOfBirth: string;
  wallet: string;
  jurisdiction: string;
  countryCode: string;
  accreditation: AccreditationTier;
  issuedAt: string;
  expiresAt: string;
  leafHash: string;
  identitySecret: string;
  sourceOfFundsHash: string;
  credentialVersion: number;
  sourceOfFundsReference?: string;
  note?: string;
}

export interface VaultProofReadClient {
  fetchVaultState: () => Promise<VaultState>;
  fetchKycRegistry: () => Promise<KycRegistry>;
  fetchStateTree: () => Promise<StateTree>;
  fetchTransferRecords: () => Promise<TransferRecordWithAddress[]>;
  fetchCredentialLeaves: () => Promise<CredentialLeafWithAddress[]>;
}

export interface CircuitInputParams {
  name: bigint;
  nationality: bigint;
  dateOfBirth: bigint;
  jurisdiction: bigint;
  accreditationStatus: bigint;
  credentialExpiry: bigint;
  sourceOfFundsHash: bigint;
  credentialVersion: bigint;
  identitySecret: bigint;
  issuerSignature: {
    R8: [bigint, bigint];
    S: bigint;
  };
  balance: bigint;
  merklePathElements: bigint[];
  merklePathIndices: number[];
  elgamalRandomness: bigint;
  recipientAddress: bigint;
  merkleRoot: bigint;
  transferAmount: bigint;
  currentTimestamp: bigint;
  retailThreshold: bigint;
  accreditedThreshold: bigint;
  institutionalThreshold: bigint;
  expiredThreshold: bigint;
  regulatorPubKeyX: bigint;
  regulatorPubKeyY: bigint;
  walletPubkey: bigint;
  encryptedMetadata: bigint[];
}

export interface CompliancePayload {
  sender: string;
  recipient: string;
  jurisdiction: string;
  amount: bigint;
}

export interface ProofArtifacts {
  wasmUrl: string;
  zkeyUrl: string;
}

export interface ProofResult {
  proof: unknown;
  publicSignals: string[];
  encryptedMetadata: Uint8Array;
  encryptedMetadataScalars: string[];
  proofTimeMs: number;
  circuitInput: Record<string, unknown>;
  merkleRoot: string;
  merkleContextSource: 'registry' | 'local-single-leaf';
}

export interface MonitoringAlert {
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

function emptyBytes(length = 32) {
  return Array.from({ length }, () => 0);
}

function bn(value: number | string | bigint) {
  return new BN(value.toString());
}

export function createEmptyVaultState(overrides: Partial<VaultState> = {}): VaultState {
  return {
    authority: overrides.authority ?? EMPTY_PUBLIC_KEY,
    custodyAuthority: overrides.custodyAuthority ?? EMPTY_PUBLIC_KEY,
    custodyProvider: overrides.custodyProvider ?? 'SelfCustody',
    usdcMint: overrides.usdcMint ?? EMPTY_PUBLIC_KEY,
    shareMint: overrides.shareMint ?? EMPTY_PUBLIC_KEY,
    usdcReserve: overrides.usdcReserve ?? EMPTY_PUBLIC_KEY,
    totalAssets: overrides.totalAssets ?? bn(0),
    totalShares: overrides.totalShares ?? bn(0),
    sharePriceNumerator: overrides.sharePriceNumerator ?? bn(1),
    sharePriceDenominator: overrides.sharePriceDenominator ?? bn(1),
    yieldSource: overrides.yieldSource ?? EMPTY_PUBLIC_KEY,
    liquidBufferBps: overrides.liquidBufferBps ?? 0,
    totalYieldEarned: overrides.totalYieldEarned ?? bn(0),
    amlThresholds: overrides.amlThresholds ?? [bn(0), bn(0), bn(0)],
    expiredThreshold: overrides.expiredThreshold ?? bn(0),
    dailyOutflowTotal: overrides.dailyOutflowTotal ?? bn(0),
    outflowWindowStart: overrides.outflowWindowStart ?? bn(0),
    circuitBreakerThreshold: overrides.circuitBreakerThreshold ?? bn(500_000),
    paused: overrides.paused ?? false,
    maxSingleTransaction: overrides.maxSingleTransaction ?? bn(250_000),
    maxSingleDeposit: overrides.maxSingleDeposit ?? bn(1_000_000),
    maxDailyTransactions: overrides.maxDailyTransactions ?? 40,
    dailyTransactionCount: overrides.dailyTransactionCount ?? 0,
    emergencyTimelock: overrides.emergencyTimelock ?? bn(72 * 60 * 60),
    regulatorPubkeyX: overrides.regulatorPubkeyX ?? emptyBytes(32),
    regulatorPubkeyY: overrides.regulatorPubkeyY ?? emptyBytes(32),
    bump: overrides.bump ?? 0,
    reserveBump: overrides.reserveBump ?? 0,
  };
}

export function createEmptyKycRegistry(overrides: Partial<KycRegistry> = {}): KycRegistry {
  return {
    authority: overrides.authority ?? EMPTY_PUBLIC_KEY,
    stateTreePubkey: overrides.stateTreePubkey ?? EMPTY_PUBLIC_KEY,
    credentialCount: overrides.credentialCount ?? bn(0),
    revokedCount: overrides.revokedCount ?? bn(0),
    issuerPubkey: overrides.issuerPubkey ?? emptyBytes(32),
    merkleRoot: overrides.merkleRoot ?? emptyBytes(32),
    bump: overrides.bump ?? 0,
  };
}

export function createEmptyStateTree(overrides: Partial<StateTree> = {}): StateTree {
  return {
    registry: overrides.registry ?? EMPTY_PUBLIC_KEY,
    root: overrides.root ?? emptyBytes(32),
    depth: overrides.depth ?? 20,
    nextIndex: overrides.nextIndex ?? bn(0),
    bump: overrides.bump ?? 0,
  };
}

export function createEmptyCredentialLeaf(
  overrides: Partial<CredentialLeafWithAddress> = {},
): CredentialLeafWithAddress {
  return {
    address: overrides.address ?? EMPTY_PUBLIC_KEY,
    registry: overrides.registry ?? EMPTY_PUBLIC_KEY,
    stateTree: overrides.stateTree ?? EMPTY_PUBLIC_KEY,
    leafHash: overrides.leafHash ?? emptyBytes(32),
    leafIndex: overrides.leafIndex ?? bn(0),
    active: overrides.active ?? false,
    bump: overrides.bump ?? 0,
  };
}

export function createEmptyTransferRecord(
  overrides: Partial<TransferRecord> = {},
): TransferRecord {
  return {
    proofHash: overrides.proofHash ?? emptyBytes(32),
    transferType: overrides.transferType ?? TransferType.Deposit,
    amount: overrides.amount ?? bn(0),
    timestamp: overrides.timestamp ?? bn(0),
    merkleRootSnapshot: overrides.merkleRootSnapshot ?? emptyBytes(32),
    encryptedMetadata: overrides.encryptedMetadata ?? [],
    decryptionAuthorized: overrides.decryptionAuthorized ?? false,
    signer: overrides.signer ?? EMPTY_PUBLIC_KEY,
    bump: overrides.bump ?? 0,
  };
}
