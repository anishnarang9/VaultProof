import type { CompliancePayload, RegulatorKey } from './types';
import {
  DEFAULT_REGULATOR_PRIVATE_KEY,
  NUM_METADATA_FIELDS,
  bigintToBytes,
  bytesToBigInt,
  countryCodeToNumeric,
  randomFieldElement,
  walletBytesToField,
} from './crypto';

const BASE8_RAW = [
  '5299619240641551281634865583518297030282874472190772894086521144482721001553',
  '16950150798460657717958625567821834550301663161624707787222815936182638968203',
] as const;

interface EncryptionContext {
  babyJub: Awaited<ReturnType<typeof import('circomlibjs')['buildBabyjub']>>;
  base8: [unknown, unknown];
  field: Awaited<ReturnType<typeof import('circomlibjs')['buildBabyjub']>>['F'];
}

interface ComplianceEncryptionOptions {
  currentTimestamp?: bigint;
  jurisdictionCode?: bigint;
  randomness?: bigint;
  regulatorKey?: RegulatorKey;
  senderIdentityHash?: bigint;
}

export interface ComplianceEncryptionBundle {
  ciphertext: Uint8Array;
  metadataFields: bigint[];
  randomness: bigint;
  regulatorPubKeyX: bigint;
  regulatorPubKeyY: bigint;
  scalars: bigint[];
}

let encryptionContextPromise: Promise<EncryptionContext> | null = null;

async function getEncryptionContext(): Promise<EncryptionContext> {
  if (!encryptionContextPromise) {
    encryptionContextPromise = (async () => {
      const { buildBabyjub } = await import('circomlibjs');
      const babyJub = await buildBabyjub();
      const field = babyJub.F;

      return {
        babyJub,
        base8: [field.e(BASE8_RAW[0]), field.e(BASE8_RAW[1])],
        field,
      };
    })();
  }

  return encryptionContextPromise;
}

function isZeroKey(regulatorKey?: RegulatorKey) {
  return !regulatorKey || regulatorKey.x.every((value) => value === 0) || regulatorKey.y.every((value) => value === 0);
}

function buildMetadataFields(payload: CompliancePayload, options: ComplianceEncryptionOptions): bigint[] {
  const timestamp = options.currentTimestamp ?? BigInt(Math.floor(Date.now() / 1000));

  return [
    options.senderIdentityHash ?? 0n,
    walletBytesToField(payload.recipient),
    payload.amount,
    timestamp,
    options.jurisdictionCode ?? countryCodeToNumeric(payload.jurisdiction),
  ];
}

async function resolveRegulatorPoint(regulatorKey?: RegulatorKey) {
  const context = await getEncryptionContext();

  if (isZeroKey(regulatorKey)) {
    return context.babyJub.mulPointEscalar(context.base8, DEFAULT_REGULATOR_PRIVATE_KEY);
  }

  return [
    context.field.e(bytesToBigInt(regulatorKey?.x ?? [])),
    context.field.e(bytesToBigInt(regulatorKey?.y ?? [])),
  ] as [unknown, unknown];
}

export async function buildComplianceEncryptionBundle(
  payload: CompliancePayload,
  options: ComplianceEncryptionOptions = {},
): Promise<ComplianceEncryptionBundle> {
  const context = await getEncryptionContext();
  const randomness = options.randomness ?? randomFieldElement();
  const regulatorPoint = await resolveRegulatorPoint(options.regulatorKey);
  const metadataFields = buildMetadataFields(payload, options);

  const c1 = context.babyJub.mulPointEscalar(context.base8, randomness);
  const rPk = context.babyJub.mulPointEscalar(regulatorPoint, randomness);
  const scalars: bigint[] = [
    BigInt(context.field.toObject(c1[0]).toString()),
    BigInt(context.field.toObject(c1[1]).toString()),
  ];

  for (const fieldValue of metadataFields.slice(0, NUM_METADATA_FIELDS)) {
    const messagePoint = context.babyJub.mulPointEscalar(context.base8, fieldValue);
    const c2 = context.babyJub.addPoint(messagePoint, rPk);
    scalars.push(
      BigInt(context.field.toObject(c2[0]).toString()),
      BigInt(context.field.toObject(c2[1]).toString()),
    );
  }

  return {
    ciphertext: Uint8Array.from(
      scalars.flatMap((value) => Array.from(bigintToBytes(value, 32))),
    ),
    metadataFields,
    randomness,
    regulatorPubKeyX: BigInt(context.field.toObject(regulatorPoint[0]).toString()),
    regulatorPubKeyY: BigInt(context.field.toObject(regulatorPoint[1]).toString()),
    scalars,
  };
}

export async function encryptCompliancePayload(
  payload: CompliancePayload,
  options: ComplianceEncryptionOptions = {},
): Promise<Uint8Array> {
  const bundle = await buildComplianceEncryptionBundle(payload, options);
  return bundle.ciphertext;
}
