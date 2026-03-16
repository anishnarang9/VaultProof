import { PublicKey } from "@solana/web3.js";

import {
  bigintToBytes32,
  computeSha256,
  publicKeyToField,
  usd,
} from "./test_utils";

const ROOT = "/Users/anishnarang/VaultProof";
const TREE_DEPTH = 20;
const WASM_PATH = `${ROOT}/circuits/build/compliance_js/compliance.wasm`;
const ZKEY_PATH = `${ROOT}/circuits/build/compliance_final.zkey`;

export type Thresholds = {
  retail: bigint;
  accredited: bigint;
  institutional: bigint;
  expired: bigint;
};

export type SparseLeafValue = {
  index: number;
  value: bigint;
  active?: boolean;
};

export type ProofBundle = {
  proof: any;
  publicSignals: string[];
  proofA: Buffer;
  proofB: Buffer;
  proofC: Buffer;
  publicInputs: Buffer[];
  proofHash: Buffer;
  merkleRoot: bigint;
  merkleRootBytes: Buffer;
  leafBigInt: bigint;
  leafBytes: Buffer;
  merkleProof: {
    pathElements: bigint[];
    pathIndices: number[];
    root: bigint;
  };
  encryptedMetadataFieldElements: bigint[];
  encryptedMetadataBytes: Buffer;
  walletField: bigint;
  currentTimestamp: bigint;
  transferAmount: bigint;
  thresholds: Thresholds;
  regulator: any;
  issuer: any;
  credential: any;
  input: Record<string, string | string[]>;
};

type Harness = {
  circuit: any;
  snarkjs: any;
  crypto: any;
  issuer: any;
  defaultRegulator: any;
  defaultThresholds: Thresholds;
};

let harnessPromise: Promise<Harness> | null = null;

function bigintToNumberArray(value: bigint) {
  return Array.from(bigintToBytes32(value));
}

function proofToOnchainFormat(proof: any, publicSignals: string[]) {
  const ax = BigInt(proof.pi_a[0]);
  const ay = BigInt(proof.pi_a[1]);
  const proofA = Buffer.concat([bigintToBytes32(ax), bigintToBytes32(ay)]);

  const bx0 = BigInt(proof.pi_b[0][0]);
  const bx1 = BigInt(proof.pi_b[0][1]);
  const by0 = BigInt(proof.pi_b[1][0]);
  const by1 = BigInt(proof.pi_b[1][1]);
  const proofB = Buffer.concat([
    bigintToBytes32(bx1),
    bigintToBytes32(bx0),
    bigintToBytes32(by1),
    bigintToBytes32(by0),
  ]);

  const cx = BigInt(proof.pi_c[0]);
  const cy = BigInt(proof.pi_c[1]);
  const proofC = Buffer.concat([bigintToBytes32(cx), bigintToBytes32(cy)]);

  const publicInputs = publicSignals.map((signal) => bigintToBytes32(BigInt(signal)));

  return { proofA, proofB, proofC, publicInputs };
}

function computeZeroNodes(harness: Harness) {
  const { poseidon, F } = harness.crypto;
  const zeroNodes: bigint[] = [F.toObject(poseidon([0n]))];

  for (let level = 0; level < TREE_DEPTH; level += 1) {
    zeroNodes.push(F.toObject(poseidon([zeroNodes[level], zeroNodes[level]])));
  }

  return zeroNodes;
}

function compressLevel(
  harness: Harness,
  levelMap: Map<number, bigint>,
  zeroCurrent: bigint,
  zeroNext: bigint
) {
  const parentMap = new Map<number, bigint>();
  const parentIndexes = new Set<number>();

  for (const index of Array.from(levelMap.keys())) {
    parentIndexes.add(Math.floor(index / 2));
  }

  for (const parentIndex of Array.from(parentIndexes)) {
    const left = levelMap.get(parentIndex * 2) ?? zeroCurrent;
    const right = levelMap.get(parentIndex * 2 + 1) ?? zeroCurrent;
    const parent = harness.crypto.F.toObject(harness.crypto.poseidon([left, right]));
    if (parent !== zeroNext) {
      parentMap.set(parentIndex, parent);
    }
  }

  return parentMap;
}

function buildSparseLevels(harness: Harness, leaves: SparseLeafValue[]) {
  const zeroNodes = computeZeroNodes(harness);
  const levels: Array<Map<number, bigint>> = [];
  let current = new Map<number, bigint>();

  for (const leaf of leaves) {
    if (leaf.active !== false) {
      current.set(leaf.index, leaf.value);
    }
  }

  levels.push(current);
  for (let level = 0; level < TREE_DEPTH; level += 1) {
    current = compressLevel(harness, current, zeroNodes[level], zeroNodes[level + 1]);
    levels.push(current);
  }

  return { levels, zeroNodes };
}

function getMerkleProofForIndex(
  harness: Harness,
  leaves: SparseLeafValue[],
  index: number
) {
  const { levels, zeroNodes } = buildSparseLevels(harness, leaves);
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let cursor = index;

  for (let level = 0; level < TREE_DEPTH; level += 1) {
    pathElements.push(levels[level].get(cursor ^ 1) ?? zeroNodes[level]);
    pathIndices.push(cursor % 2);
    cursor = Math.floor(cursor / 2);
  }

  return {
    pathElements,
    pathIndices,
    root: levels[TREE_DEPTH].get(0) ?? zeroNodes[TREE_DEPTH],
  };
}

export async function loadCircuitHarness() {
  if (!harnessPromise) {
    harnessPromise = (async () => {
      const circuit = await import(`${ROOT}/circuits/test_utils.mjs`);
      const snarkjs = await import("snarkjs");
      const crypto = await circuit.initCrypto();
      const issuer = circuit.createIssuerKeypair(crypto);
      const defaultRegulator = circuit.createRegulatorKeypair(crypto);

      return {
        circuit,
        snarkjs,
        crypto,
        issuer,
        defaultRegulator,
        defaultThresholds: {
          retail: usd(10_000),
          accredited: usd(1_000_000),
          institutional: 18_446_744_073_709_551_615n,
          expired: usd(1_000),
        },
      };
    })();
  }

  return harnessPromise;
}

export function buildIssuerBytes() {
  return Uint8Array.from(
    Array.from({ length: 32 }, (_, index) => (index + 1) & 0xff)
  );
}

export async function buildProofBundle(params: {
  wallet: PublicKey;
  transferAmount: bigint;
  currentTimestamp: bigint;
  balance: bigint;
  recipientAddress?: bigint;
  regulator?: any;
  thresholds?: Partial<Thresholds>;
  identitySecret?: bigint;
  nameNonce?: bigint;
  leafIndex?: number;
  merkleLeaves?: SparseLeafValue[];
  credential?: any;
}) {
  const harness = await loadCircuitHarness();
  const { circuit, snarkjs, crypto, issuer } = harness;
  const regulator = params.regulator ?? harness.defaultRegulator;
  const thresholds: Thresholds = {
    ...harness.defaultThresholds,
    ...(params.thresholds ?? {}),
  };

  const walletField = publicKeyToField(params.wallet);
  const nameNonce = params.nameNonce ?? 12345678901234567890n;
  const identitySecret = params.identitySecret ?? 9876543210987654321n;
  const recipientAddress = params.recipientAddress ?? 111111111111111111n;

  const fields = {
    name: crypto.F.toObject(crypto.poseidon([nameNonce])),
    nationality: 756n,
    dateOfBirth: 631152000n,
    jurisdiction: 756n,
    accreditationStatus: 1n,
    credentialExpiry: params.currentTimestamp + 86_400n * 365n,
    walletPubkey: walletField,
  };

  const credential =
    params.credential ??
    circuit.createCredential(crypto, issuer, fields, identitySecret);
  const leafIndex = params.leafIndex ?? 0;
  const merkleLeaves =
    params.merkleLeaves ??
    [
      {
        index: leafIndex,
        value: credential.leafBigInt,
        active: true,
      },
    ];
  const merkleProof = getMerkleProofForIndex(harness, merkleLeaves, leafIndex);
  const metadataFields = circuit.buildMetadataFields(
    credential,
    recipientAddress,
    params.transferAmount,
    params.currentTimestamp
  );
  const { encrypted } = circuit.computeElGamalCiphertexts(
    crypto,
    regulator,
    metadataFields,
    42424242424242n
  );

  const input = circuit.buildCircuitInput({
    credential,
    merkleProof,
    merkleRoot: merkleProof.root,
    transferAmount: params.transferAmount,
    currentTimestamp: params.currentTimestamp,
    retailThreshold: thresholds.retail,
    accreditedThreshold: thresholds.accredited,
    institutionalThreshold: thresholds.institutional,
    expiredThreshold: thresholds.expired,
    balance: params.balance,
    recipientAddress,
    elgamalRandomness: 42424242424242n,
    regulatorKeypair: regulator,
    encryptedMetadata: encrypted,
  });

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    WASM_PATH,
    ZKEY_PATH
  );
  const valid = await snarkjs.groth16.verify(harness.crypto.vkey, publicSignals, proof);
  if (!valid) {
    throw new Error("generated proof did not verify against the current verification key");
  }

  const { proofA, proofB, proofC, publicInputs } = proofToOnchainFormat(
    proof,
    publicSignals
  );
  const encryptedMetadataBytes = Buffer.concat(publicInputs.slice(10));

  return {
    proof,
    publicSignals,
    proofA,
    proofB,
    proofC,
    publicInputs,
    proofHash: computeSha256([proofA, proofB, proofC]),
    merkleRoot: merkleProof.root,
    merkleRootBytes: bigintToBytes32(merkleProof.root),
    leafBigInt: credential.leafBigInt,
    leafBytes: bigintToBytes32(credential.leafBigInt),
    merkleProof,
    encryptedMetadataFieldElements: encrypted,
    encryptedMetadataBytes,
    walletField,
    currentTimestamp: params.currentTimestamp,
    transferAmount: params.transferAmount,
    thresholds,
    regulator,
    issuer,
    credential,
    input,
  } satisfies ProofBundle;
}

export function merkleProofToByteArrays(pathElements: bigint[]) {
  return pathElements.map((value) => bigintToNumberArray(value));
}

export async function buildSparseMerkleProof(
  leaves: SparseLeafValue[],
  index: number
) {
  const harness = await loadCircuitHarness();
  return getMerkleProofForIndex(harness, leaves, index);
}
