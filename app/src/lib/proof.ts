import { TREE_DEPTH } from './crypto';
import type { CircuitInputParams, ProofArtifacts } from './types';

let poseidonPromise: Promise<Awaited<ReturnType<typeof import('circomlibjs')['buildPoseidon']>>> | null =
  null;

async function getPoseidon() {
  if (!poseidonPromise) {
    poseidonPromise = (async () => {
      const { buildPoseidon } = await import('circomlibjs');
      return buildPoseidon();
    })();
  }

  return poseidonPromise;
}

export function buildCircuitInput(params: CircuitInputParams) {
  return {
    name: params.name.toString(),
    nationality: params.nationality.toString(),
    dateOfBirth: params.dateOfBirth.toString(),
    jurisdiction: params.jurisdiction.toString(),
    accreditationStatus: params.accreditationStatus.toString(),
    credentialExpiry: params.credentialExpiry.toString(),
    sourceOfFundsHash: params.sourceOfFundsHash.toString(),
    credentialVersion: params.credentialVersion.toString(),
    identitySecret: params.identitySecret.toString(),
    issuerSigR8x: params.issuerSignature.R8[0].toString(),
    issuerSigR8y: params.issuerSignature.R8[1].toString(),
    issuerSigS: params.issuerSignature.S.toString(),
    balance: params.balance.toString(),
    merklePathElements: params.merklePathElements.map((value) => value.toString()),
    merklePathIndices: params.merklePathIndices.map((value) => value.toString()),
    elgamalRandomness: params.elgamalRandomness.toString(),
    recipientAddress: params.recipientAddress.toString(),
    merkleRoot: params.merkleRoot.toString(),
    transferAmount: params.transferAmount.toString(),
    currentTimestamp: params.currentTimestamp.toString(),
    retailThreshold: params.retailThreshold.toString(),
    accreditedThreshold: params.accreditedThreshold.toString(),
    institutionalThreshold: params.institutionalThreshold.toString(),
    expiredThreshold: params.expiredThreshold.toString(),
    regulatorPubKeyX: params.regulatorPubKeyX.toString(),
    regulatorPubKeyY: params.regulatorPubKeyY.toString(),
    walletPubkey: params.walletPubkey.toString(),
    encryptedMetadata: params.encryptedMetadata.map((value) => value.toString()),
  };
}

export async function buildSingleLeafMerkleProof(leaf: bigint) {
  const poseidon = await getPoseidon();
  const pathElements: bigint[] = [];
  const pathIndices = Array.from({ length: TREE_DEPTH }, () => 0);
  let current = leaf;
  let emptyNode = BigInt(poseidon.F.toString(poseidon([0n])));

  for (let level = 0; level < TREE_DEPTH; level += 1) {
    pathElements.push(emptyNode);
    current = BigInt(poseidon.F.toString(poseidon([current, emptyNode])));
    emptyNode = BigInt(poseidon.F.toString(poseidon([emptyNode, emptyNode])));
  }

  return {
    pathElements,
    pathIndices,
    root: current,
  };
}

export async function generateProofWithSnarkJs(
  input: Record<string, unknown>,
  artifacts: ProofArtifacts,
): Promise<{ proof: unknown; publicSignals: string[]; proofTimeMs: number }> {
  const snarkjs = (await import('snarkjs')) as unknown as {
    groth16: {
      fullProve: (
        witness: Record<string, unknown>,
        wasmUrl: string,
        zkeyUrl: string,
      ) => Promise<{ proof: unknown; publicSignals: unknown[] }>;
    };
  };

  const startedAt = performance.now();
  const result = await snarkjs.groth16.fullProve(
    input,
    artifacts.wasmUrl,
    artifacts.zkeyUrl,
  );

  return {
    proof: result.proof,
    publicSignals: result.publicSignals.map((value) => String(value)),
    proofTimeMs: performance.now() - startedAt,
  };
}
