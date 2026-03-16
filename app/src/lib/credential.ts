import type { StoredCredential } from './types';
import {
  DEFAULT_ISSUER_PRIVATE_KEY_HEX,
  accreditationToStatus,
  bigintToHex,
  countryCodeToNumeric,
  dateStringToUnixTimestamp,
  textToField,
  walletBytesToField,
} from './crypto';

interface CredentialCryptoContext {
  eddsa: Awaited<ReturnType<typeof import('circomlibjs')['buildEddsa']>>;
  poseidon: Awaited<ReturnType<typeof import('circomlibjs')['buildPoseidon']>>;
}

export interface PreparedCredential {
  accreditationStatus: bigint;
  credHashFinalBigInt: bigint;
  credentialExpiry: bigint;
  dateOfBirth: bigint;
  identitySecret: bigint;
  issuerSignature: {
    R8: [bigint, bigint];
    S: bigint;
  };
  jurisdiction: bigint;
  leafBigInt: bigint;
  name: bigint;
  nationality: bigint;
  walletPubkey: bigint;
}

let cryptoContextPromise: Promise<CredentialCryptoContext> | null = null;

function hexToBytes(value: string): Uint8Array {
  const normalized = value.length % 2 === 0 ? value : `0${value}`;
  return Uint8Array.from(
    Array.from({ length: normalized.length / 2 }, (_, index) =>
      Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16),
    ),
  );
}

async function getCredentialCryptoContext(): Promise<CredentialCryptoContext> {
  if (!cryptoContextPromise) {
    cryptoContextPromise = (async () => {
      const [{ buildEddsa, buildPoseidon }] = await Promise.all([import('circomlibjs')]);

      return {
        eddsa: await buildEddsa(),
        poseidon: await buildPoseidon(),
      };
    })();
  }

  return cryptoContextPromise;
}

function parseIdentitySecret(value: string): bigint {
  if (!value.trim()) {
    throw new Error('Identity secret is required to derive the credential leaf.');
  }

  try {
    return BigInt(value);
  } catch {
    return textToField(value);
  }
}

export async function prepareStoredCredential(credential: StoredCredential): Promise<PreparedCredential> {
  const { eddsa, poseidon } = await getCredentialCryptoContext();
  const field = eddsa.babyJub.F;
  const issuerPrivateKey = hexToBytes(DEFAULT_ISSUER_PRIVATE_KEY_HEX);

  const name = textToField(credential.fullName);
  const nationality = countryCodeToNumeric(credential.countryCode);
  const dateOfBirth = dateStringToUnixTimestamp(credential.dateOfBirth);
  const jurisdiction = countryCodeToNumeric(credential.countryCode || credential.jurisdiction);
  const accreditationStatus = accreditationToStatus(credential.accreditation);
  const credentialExpiry = dateStringToUnixTimestamp(credential.expiresAt);
  const identitySecret = parseIdentitySecret(credential.identitySecret);
  const walletPubkey = walletBytesToField(credential.wallet);

  const credHash1 = poseidon([name, nationality]);
  const credHash2 = poseidon([dateOfBirth, jurisdiction]);
  const credHash3 = poseidon([accreditationStatus, credentialExpiry]);
  const credHashFinal = poseidon([
    BigInt(poseidon.F.toString(credHash1)),
    BigInt(poseidon.F.toString(credHash2)),
    BigInt(poseidon.F.toString(credHash3)),
  ]);
  const credHashFinalBigInt = BigInt(poseidon.F.toString(credHashFinal));
  const signature = eddsa.signPoseidon(issuerPrivateKey, credHashFinal);
  const leaf = poseidon([credHashFinalBigInt, identitySecret, walletPubkey]);

  return {
    accreditationStatus,
    credHashFinalBigInt,
    credentialExpiry,
    dateOfBirth,
    identitySecret,
    issuerSignature: {
      R8: [
        BigInt(field.toObject(signature.R8[0]).toString()),
        BigInt(field.toObject(signature.R8[1]).toString()),
      ],
      S: BigInt(signature.S.toString()),
    },
    jurisdiction,
    leafBigInt: BigInt(poseidon.F.toString(leaf)),
    name,
    nationality,
    walletPubkey,
  };
}

export async function hashCredentialLeaf(
  input: Pick<
    StoredCredential,
    | 'accreditation'
    | 'countryCode'
    | 'dateOfBirth'
    | 'expiresAt'
    | 'fullName'
    | 'identitySecret'
    | 'jurisdiction'
    | 'wallet'
  >,
): Promise<string> {
  const prepared = await prepareStoredCredential({
    ...input,
    issuedAt: new Date().toISOString(),
    leafHash: '',
  });

  return bigintToHex(prepared.leafBigInt);
}
