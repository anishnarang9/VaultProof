import { PublicKey } from "@solana/web3.js";

const BN254_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DEFAULT_ISSUER_PRIVATE_KEY_HEX =
  "0001020304050607080900010203040506070809000102030405060708090001";

export type DevnetCredentialInput = {
  accreditation?: "retail" | "accredited" | "institutional" | "expired";
  countryCode?: string;
  dateOfBirth?: string;
  expiresAt?: string;
  fullName?: string;
  identitySecret?: string;
  jurisdiction?: string;
  sourceOfFundsReference?: string;
  wallet: PublicKey | string;
  credentialVersion?: number;
};

export type DevnetCredentialArtifact = {
  accreditationStatus: string;
  countryCode: string;
  credentialExpiry: string;
  credentialVersion: number;
  dateOfBirth: string;
  fullName: string;
  identitySecret: string;
  jurisdiction: string;
  leafHashHex: string;
  sourceOfFundsHashHex: string;
  sourceOfFundsReference: string;
  wallet: string;
};

function bigintToBytes(value: bigint, width = 32) {
  let normalized = value;

  if (normalized < 0n) {
    normalized = ((normalized % BN254_FIELD) + BN254_FIELD) % BN254_FIELD;
  }

  const bytes = new Uint8Array(width);
  for (let index = width - 1; index >= 0; index -= 1) {
    bytes[index] = Number(normalized & 0xffn);
    normalized >>= 8n;
  }

  return bytes;
}

function bigintToHex(value: bigint, width = 32) {
  return `0x${Buffer.from(bigintToBytes(value, width)).toString("hex")}`;
}

function bytesToBigInt(value: Uint8Array) {
  let result = 0n;

  for (const byte of value) {
    result = (result << 8n) + BigInt(byte);
  }

  return result;
}

function textToField(text: string) {
  const bytes = new TextEncoder().encode(text.trim());
  let acc = 0n;

  for (const byte of bytes) {
    acc = (acc * 257n + BigInt(byte)) % BN254_FIELD;
  }

  return acc;
}

function dateStringToUnixTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return BigInt(Math.floor(timestamp / 1000));
}

function accreditationToStatus(value: DevnetCredentialInput["accreditation"]) {
  switch (value) {
    case "retail":
      return 0n;
    case "institutional":
      return 2n;
    case "expired":
      return 0n;
    case "accredited":
    default:
      return 1n;
  }
}

function countryCodeToNumeric(value: string) {
  const numericCodes: Record<string, number> = {
    AE: 784,
    BR: 76,
    CA: 124,
    CH: 756,
    DE: 276,
    FR: 250,
    GB: 826,
    HK: 344,
    JP: 392,
    SG: 702,
    US: 840,
  };
  const code = value.trim().slice(0, 2).toUpperCase();
  return typeof numericCodes[code] === "number"
    ? BigInt(numericCodes[code])
    : textToField(code || value);
}

function walletBytesToField(value: PublicKey | string) {
  const publicKey = value instanceof PublicKey ? value : new PublicKey(value);
  return bytesToBigInt(publicKey.toBytes()) % BN254_FIELD;
}

function hexToBytes(value: string) {
  const normalized = value.length % 2 === 0 ? value : `0${value}`;
  return Uint8Array.from(
    Array.from({ length: normalized.length / 2 }, (_, index) =>
      Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16),
    ),
  );
}

export async function computeSourceOfFundsHash(reference: string) {
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();
  return BigInt(poseidon.F.toString(poseidon([textToField(reference)])));
}

export async function buildDevnetCredential(
  input: DevnetCredentialInput,
): Promise<DevnetCredentialArtifact> {
  const wallet = input.wallet instanceof PublicKey ? input.wallet : new PublicKey(input.wallet);
  const fullName = input.fullName ?? "VaultProof Devnet Investor";
  const dateOfBirth = input.dateOfBirth ?? "1990-01-01";
  const countryCode = (input.countryCode ?? "US").toUpperCase();
  const jurisdiction = input.jurisdiction ?? countryCode;
  const expiresAt = input.expiresAt ?? "2027-12-31";
  const sourceOfFundsReference =
    input.sourceOfFundsReference ?? "Wire transfer from regulated bank account";
  const identitySecret = input.identitySecret ?? "42424242424242";
  const credentialVersion = input.credentialVersion ?? 1;

  const [{ buildEddsa, buildPoseidon }, sourceOfFundsHash] = await Promise.all([
    import("circomlibjs"),
    computeSourceOfFundsHash(sourceOfFundsReference),
  ]);
  const eddsa = await buildEddsa();
  const poseidon = await buildPoseidon();

  const name = textToField(fullName);
  const nationality = countryCodeToNumeric(countryCode);
  const dob = dateStringToUnixTimestamp(dateOfBirth);
  const jurisdictionField = countryCodeToNumeric(jurisdiction);
  const accreditationStatus = accreditationToStatus(input.accreditation);
  const credentialExpiry = dateStringToUnixTimestamp(expiresAt);
  const walletPubkey = walletBytesToField(wallet);
  const identitySecretField = BigInt(identitySecret);
  const credentialVersionField = BigInt(credentialVersion);

  const credHash1 = poseidon([name, nationality]);
  const credHash2 = poseidon([dob, jurisdictionField]);
  const credHash3 = poseidon([accreditationStatus, credentialExpiry]);
  const credHash4 = poseidon([sourceOfFundsHash, credentialVersionField]);
  const credHashFinal = poseidon([
    BigInt(poseidon.F.toString(credHash1)),
    BigInt(poseidon.F.toString(credHash2)),
    BigInt(poseidon.F.toString(credHash3)),
    BigInt(poseidon.F.toString(credHash4)),
  ]);

  // Sign the credential hash now so the artifact shape matches the new
  // credential format even before the frontend consumes the signature again.
  eddsa.signPoseidon(hexToBytes(DEFAULT_ISSUER_PRIVATE_KEY_HEX), credHashFinal);

  const leaf = poseidon([
    BigInt(poseidon.F.toString(credHashFinal)),
    identitySecretField,
    walletPubkey,
  ]);
  const leafBigInt = BigInt(poseidon.F.toString(leaf));

  return {
    accreditationStatus: accreditationStatus.toString(),
    countryCode,
    credentialExpiry: credentialExpiry.toString(),
    credentialVersion,
    dateOfBirth,
    fullName,
    identitySecret,
    jurisdiction,
    leafHashHex: bigintToHex(leafBigInt),
    sourceOfFundsHashHex: bigintToHex(sourceOfFundsHash),
    sourceOfFundsReference,
    wallet: wallet.toBase58(),
  };
}
