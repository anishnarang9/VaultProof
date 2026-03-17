import { useCallback, useState } from 'react';
import { buildComplianceEncryptionBundle } from '../lib/elgamal';
import { buildSingleLeafMerkleProof, buildCircuitInput, generateProofWithSnarkJs } from '../lib/proof';
import { defaultReadClient } from '../lib/readClient';
import { prepareStoredCredential } from '../lib/credential';
import { bigintToHex, bytesToBigInt, walletBytesToField } from '../lib/crypto';
import { bytesToHex } from '../lib/format';
import type {
  ProofArtifacts,
  ProofLifecycleStep,
  ProofResult,
  RegulatorKey,
  StoredCredential,
  VaultProofReadClient,
  VaultThresholds,
} from '../lib/types';

interface ProofGenerationRequest {
  amount: bigint;
  balance?: bigint;
  credential: StoredCredential;
  recipient: string;
  regulatorPubkey: RegulatorKey;
  thresholds: VaultThresholds;
}

interface ProofTimelineStep {
  key: ProofLifecycleStep;
  label: string;
  status: 'pending' | 'active' | 'complete';
}

function createTimeline(activeStep: ProofLifecycleStep = 'idle'): ProofTimelineStep[] {
  const ordered: Array<{ key: ProofLifecycleStep; label: string }> = [
    { key: 'loading-circuit', label: 'Loading WASM + proving key' },
    { key: 'fetching-context', label: 'Fetching registry root and vault thresholds' },
    { key: 'building-witness', label: 'Preparing credential and Merkle witness' },
    { key: 'encrypting-metadata', label: 'Encrypting compliance metadata on Baby Jubjub' },
    { key: 'generating-proof', label: 'Generating Groth16 proof in the browser' },
    { key: 'ready', label: 'Proof package ready for submission' },
  ];

  const activeIndex = ordered.findIndex((step) => step.key === activeStep);

  return ordered.map((step, index) => ({
    ...step,
    status:
      activeStep === 'idle'
        ? 'pending'
        : index < activeIndex
          ? 'complete'
          : index === activeIndex
            ? 'active'
            : 'pending',
  }));
}

const defaultArtifacts: ProofArtifacts = {
  wasmUrl: import.meta.env.VITE_CIRCUIT_WASM_URL ?? '/circuits/compliance.wasm',
  zkeyUrl: import.meta.env.VITE_CIRCUIT_ZKEY_URL ?? '/circuits/compliance_final.zkey',
};

function isZeroHex(hex: string) {
  return /^0x0+$/.test(hex);
}

export function useProofGeneration(client: VaultProofReadClient = defaultReadClient) {
  const [step, setStep] = useState<ProofLifecycleStep>('idle');
  const [timeline, setTimeline] = useState<ProofTimelineStep[]>(() => createTimeline());
  const [result, setResult] = useState<ProofResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const mark = (nextStep: ProofLifecycleStep) => {
    setStep(nextStep);
    setTimeline(createTimeline(nextStep));
  };

  const reset = useCallback(() => {
    setStep('idle');
    setTimeline(createTimeline());
    setResult(null);
    setError(null);
    setIsGenerating(false);
  }, []);

  const generate = useCallback(
    async (request: ProofGenerationRequest) => {
      setIsGenerating(true);
      setError(null);
      setResult(null);

      try {
        mark('loading-circuit');
        const artifacts = defaultArtifacts;

        mark('fetching-context');
        const [registry, stateTree] = await Promise.all([
          client.fetchKycRegistry(),
          client.fetchStateTree(),
        ]);

        mark('building-witness');
        const preparedCredential = await prepareStoredCredential(request.credential);
        const merkleProof = await buildSingleLeafMerkleProof(preparedCredential.leafBigInt);
        const registryRootHex = bytesToHex(stateTree.root);
        const localRootHex = bigintToHex(merkleProof.root);
        const useRegistryRoot =
          !isZeroHex(registryRootHex) &&
          registryRootHex.toLowerCase() === localRootHex.toLowerCase();
        const merkleRoot = useRegistryRoot ? bytesToBigInt(stateTree.root) : merkleProof.root;
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const jurisdictionCode = preparedCredential.jurisdiction;

        mark('encrypting-metadata');
        const encryption = await buildComplianceEncryptionBundle(
          {
            amount: request.amount,
            jurisdiction: request.credential.countryCode || request.credential.jurisdiction,
            recipient: request.recipient,
            sender: request.credential.wallet,
          },
          {
            currentTimestamp,
            jurisdictionCode,
            regulatorKey: request.regulatorPubkey,
            senderIdentityHash: preparedCredential.credHashFinalBigInt,
          },
        );

        const circuitInput = buildCircuitInput({
          accreditationStatus: preparedCredential.accreditationStatus,
          balance: request.balance ?? request.amount,
          credentialVersion: preparedCredential.credentialVersion,
          credentialExpiry: preparedCredential.credentialExpiry,
          currentTimestamp,
          dateOfBirth: preparedCredential.dateOfBirth,
          elgamalRandomness: encryption.randomness,
          encryptedMetadata: encryption.scalars,
          identitySecret: preparedCredential.identitySecret,
          institutionalThreshold: BigInt(request.thresholds.institutional.toString()),
          issuerSignature: preparedCredential.issuerSignature,
          jurisdiction: preparedCredential.jurisdiction,
          merklePathElements: merkleProof.pathElements,
          merklePathIndices: merkleProof.pathIndices,
          merkleRoot,
          name: preparedCredential.name,
          nationality: preparedCredential.nationality,
          recipientAddress: walletBytesToField(request.recipient),
          regulatorPubKeyX: encryption.regulatorPubKeyX,
          regulatorPubKeyY: encryption.regulatorPubKeyY,
          retailThreshold: BigInt(request.thresholds.retail.toString()),
          accreditedThreshold: BigInt(request.thresholds.accredited.toString()),
          expiredThreshold: BigInt(request.thresholds.expired.toString()),
          sourceOfFundsHash: preparedCredential.sourceOfFundsHash,
          transferAmount: request.amount,
          walletPubkey: preparedCredential.walletPubkey,
        });

        mark('generating-proof');
        const proof = await generateProofWithSnarkJs(circuitInput, artifacts);

        const nextResult: ProofResult = {
          circuitInput,
          encryptedMetadata: encryption.ciphertext,
          encryptedMetadataScalars: encryption.scalars.map((value) => value.toString()),
          merkleContextSource: useRegistryRoot ? 'registry' : 'local-single-leaf',
          merkleRoot: useRegistryRoot ? registryRootHex : localRootHex,
          proof: proof.proof,
          proofTimeMs: proof.proofTimeMs,
          publicSignals: proof.publicSignals,
        };

        if (!useRegistryRoot && !isZeroHex(bytesToHex(registry.merkleRoot))) {
          nextResult.merkleRoot = localRootHex;
        }

        setResult(nextResult);
        mark('ready');
        return nextResult;
      } catch (caughtError) {
        setStep('error');
        setTimeline(createTimeline());
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Proof generation failed before submission.',
        );
        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    [client],
  );

  return {
    encryptedMetadata: result?.encryptedMetadata ?? null,
    error,
    generate,
    isGenerating,
    proof: result?.proof ?? null,
    proofTime:
      result && result.proofTimeMs > 0 ? `${(result.proofTimeMs / 1000).toFixed(1)}s` : null,
    publicSignals: result?.publicSignals ?? [],
    reset,
    result,
    step,
    timeline,
  };
}
