/**
 * End-to-end proof generation test.
 *
 * Runs the full pipeline: credential → Poseidon hashing → EdDSA signing →
 * Merkle tree → ElGamal encryption → snarkjs Groth16 fullProve.
 *
 * Uses the real compiled circuit WASM + zkey from circuits/build/.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Increase timeout — proof generation can take 30–60s
const PROOF_TIMEOUT = 120_000;

const CIRCUITS_DIR = resolve(__dirname, '../../../circuits/build');
const WASM_PATH = resolve(CIRCUITS_DIR, 'compliance_js/compliance.wasm');
const ZKEY_PATH = resolve(CIRCUITS_DIR, 'compliance_final.zkey');

describe('proof generation e2e', () => {
  it(
    'generates a valid Groth16 proof with the real circuit',
    async () => {
      // --- Dynamic imports (circomlibjs, snarkjs are ESM-ish) ---
      const { buildPoseidon, buildEddsa, buildBabyjub } = await import('circomlibjs');
      const snarkjs = (await import('snarkjs')) as unknown as {
        groth16: {
          fullProve: (
            input: Record<string, unknown>,
            wasmPath: string,
            zkeyPath: string,
          ) => Promise<{ proof: unknown; publicSignals: string[] }>;
          verify: (
            vkey: unknown,
            publicSignals: string[],
            proof: unknown,
          ) => Promise<boolean>;
        };
      };

      const poseidon = await buildPoseidon();
      const eddsa = await buildEddsa();
      const babyJub = await buildBabyjub();
      const F = babyJub.F;

      // --- 1. Build credential fields ---
      const textToField = (text: string): bigint => {
        const bytes = new TextEncoder().encode(text.trim());
        let acc = 0n;
        for (const b of bytes) acc = (acc * 257n + BigInt(b)) % 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
        return acc;
      };

      const name = textToField('Jane Doe');
      const nationality = 840n; // US
      const dateOfBirth = BigInt(Math.floor(new Date('1990-01-01').getTime() / 1000));
      const jurisdiction = 840n;
      const accreditationStatus = 1n; // accredited
      const credentialExpiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 86400);
      const sourceOfFundsHash = textToField('Wire transfer from UBS');
      const credentialVersion = 1n;
      const identitySecret = textToField('1234'); // SSN last 4

      // --- 2. Hash credential (must match circuit's Poseidon tree) ---
      const credHash1 = poseidon([name, nationality]);
      const credHash2 = poseidon([dateOfBirth, jurisdiction]);
      const credHash3 = poseidon([accreditationStatus, credentialExpiry]);
      const credHash4 = poseidon([sourceOfFundsHash, credentialVersion]);

      const credHashFinal = poseidon([
        BigInt(poseidon.F.toString(credHash1)),
        BigInt(poseidon.F.toString(credHash2)),
        BigInt(poseidon.F.toString(credHash3)),
        BigInt(poseidon.F.toString(credHash4)),
      ]);
      const credHashFinalBigInt = BigInt(poseidon.F.toString(credHashFinal));

      // --- 3. EdDSA sign the credential ---
      const issuerPrivKey = Uint8Array.from(
        Array.from({ length: 32 }, (_, i) => (i % 10)),
      );
      // The private key hex is '0001020304050607080900010203040506070809000102030405060708090001'
      // which is bytes [0,1,2,3,4,5,6,7,8,9,0,1,2,3,...,0,1]
      const issuerPrivKeyCorrect = new Uint8Array(32);
      for (let i = 0; i < 32; i++) issuerPrivKeyCorrect[i] = i % 10;

      const signature = eddsa.signPoseidon(issuerPrivKeyCorrect, credHashFinal);
      const sigR8x = BigInt(F.toObject(signature.R8[0]).toString());
      const sigR8y = BigInt(F.toObject(signature.R8[1]).toString());
      const sigS = BigInt(signature.S.toString());

      // --- 4. Wallet pubkey ---
      const walletPubkey = textToField('DzGXeLhKHH81BKSLnQ82FWbmxyPezd7FUgLGDvSkzPge');

      // --- 5. Build Merkle proof (single-leaf tree) ---
      const leaf = poseidon([credHashFinalBigInt, identitySecret, walletPubkey]);
      const leafBigInt = BigInt(poseidon.F.toString(leaf));

      const pathElements: bigint[] = [];
      const pathIndices = Array.from({ length: 20 }, () => 0);
      let current = leafBigInt;
      let emptyNode = BigInt(poseidon.F.toString(poseidon([0n])));

      for (let level = 0; level < 20; level++) {
        pathElements.push(emptyNode);
        current = BigInt(poseidon.F.toString(poseidon([current, emptyNode])));
        emptyNode = BigInt(poseidon.F.toString(poseidon([emptyNode, emptyNode])));
      }
      const merkleRoot = current;

      // --- 6. ElGamal encryption ---
      const BASE8 = [
        F.e('5299619240641551281634865583518297030282874472190772894086521144482721001553'),
        F.e('16950150798460657717958625567821834550301663161624707787222815936182638968203'),
      ] as [unknown, unknown];

      // Use a small randomness that definitely fits in 253 bits
      const elgamalRandomness = 123456789n;

      // Regulator key: derive from default private key
      const DEFAULT_REG_PRIVKEY = 123456789n;
      const regulatorPoint = babyJub.mulPointEscalar(BASE8, DEFAULT_REG_PRIVKEY);
      const regulatorPubKeyX = BigInt(F.toObject(regulatorPoint[0]).toString());
      const regulatorPubKeyY = BigInt(F.toObject(regulatorPoint[1]).toString());

      // C1 = r * G
      const c1 = babyJub.mulPointEscalar(BASE8, elgamalRandomness);
      // r * PK
      const rPK = babyJub.mulPointEscalar(regulatorPoint, elgamalRandomness);

      const transferAmount = 10000n;
      const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
      const recipientAddress = textToField('vault_reserve');

      const metadataFields = [
        credHashFinalBigInt,
        recipientAddress,
        transferAmount,
        currentTimestamp,
        jurisdiction,
      ];

      const encryptedMetadata: bigint[] = [
        BigInt(F.toObject(c1[0]).toString()),
        BigInt(F.toObject(c1[1]).toString()),
      ];

      for (const fieldVal of metadataFields) {
        const mG = babyJub.mulPointEscalar(BASE8, fieldVal);
        const c2 = babyJub.addPoint(mG, rPK);
        encryptedMetadata.push(
          BigInt(F.toObject(c2[0]).toString()),
          BigInt(F.toObject(c2[1]).toString()),
        );
      }

      expect(encryptedMetadata).toHaveLength(12);

      // --- 7. Build circuit input ---
      const circuitInput: Record<string, string | string[]> = {
        name: name.toString(),
        nationality: nationality.toString(),
        dateOfBirth: dateOfBirth.toString(),
        jurisdiction: jurisdiction.toString(),
        accreditationStatus: accreditationStatus.toString(),
        credentialExpiry: credentialExpiry.toString(),
        sourceOfFundsHash: sourceOfFundsHash.toString(),
        credentialVersion: credentialVersion.toString(),
        identitySecret: identitySecret.toString(),
        issuerSigR8x: sigR8x.toString(),
        issuerSigR8y: sigR8y.toString(),
        issuerSigS: sigS.toString(),
        balance: transferAmount.toString(),
        merklePathElements: pathElements.map((v) => v.toString()),
        merklePathIndices: pathIndices.map((v) => v.toString()),
        elgamalRandomness: elgamalRandomness.toString(),
        recipientAddress: recipientAddress.toString(),
        merkleRoot: merkleRoot.toString(),
        transferAmount: transferAmount.toString(),
        currentTimestamp: currentTimestamp.toString(),
        retailThreshold: '100000',
        accreditedThreshold: '1000000',
        institutionalThreshold: '10000000',
        expiredThreshold: '1000',
        regulatorPubKeyX: regulatorPubKeyX.toString(),
        regulatorPubKeyY: regulatorPubKeyY.toString(),
        walletPubkey: walletPubkey.toString(),
        encryptedMetadata: encryptedMetadata.map((v) => v.toString()),
      };

      console.log('Circuit input keys:', Object.keys(circuitInput));
      console.log('encryptedMetadata length:', encryptedMetadata.length);
      console.log('elgamalRandomness bits:', elgamalRandomness.toString(2).length);
      console.log('regulatorPubKeyX:', regulatorPubKeyX.toString().slice(0, 20) + '...');
      console.log('regulatorPubKeyY:', regulatorPubKeyY.toString().slice(0, 20) + '...');

      // --- 8. Generate proof ---
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        WASM_PATH,
        ZKEY_PATH,
      );

      expect(proof).toBeDefined();
      expect(publicSignals.length).toBeGreaterThan(0);
      console.log('Proof generated successfully!');
      console.log('Public signals count:', publicSignals.length);

      // --- 9. Verify proof ---
      const vkeyRaw = readFileSync(resolve(CIRCUITS_DIR, 'verification_key.json'), 'utf-8');
      const vkey = JSON.parse(vkeyRaw);
      const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(valid).toBe(true);
      console.log('Proof verified successfully!');
    },
    PROOF_TIMEOUT,
  );

  it(
    'generates a valid proof using the frontend pipeline functions',
    async () => {
      const { prepareStoredCredential } = await import('../lib/credential');
      const { buildComplianceEncryptionBundle } = await import('../lib/elgamal');
      const { buildCircuitInput, buildSingleLeafMerkleProof, generateProofWithSnarkJs } = await import('../lib/proof');
      const { walletBytesToField, bigintToHex, bytesToBigInt } = await import('../lib/crypto');
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');

      // Simulate what Deposit.tsx does
      const credential = {
        fullName: 'Jane Doe',
        dateOfBirth: '1990-01-01',
        wallet: 'DzGXeLhKHH81BKSLnQ82FWbmxyPezd7FUgLGDvSkzPge',
        jurisdiction: 'United States',
        countryCode: 'US',
        accreditation: 'accredited' as const,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        leafHash: '',
        identitySecret: '12345678901234567890', // a numeric string
        sourceOfFundsHash: '0x' + '11'.repeat(32),
        credentialVersion: 1,
        sourceOfFundsReference: 'Wire transfer from UBS',
      };

      const preparedCredential = await prepareStoredCredential(credential);
      const merkleProof = await buildSingleLeafMerkleProof(preparedCredential.leafBigInt);
      const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
      const amount = 10000n;
      const recipient = 'vault_reserve';

      const encryption = await buildComplianceEncryptionBundle(
        {
          amount,
          jurisdiction: credential.countryCode,
          recipient,
          sender: credential.wallet,
        },
        {
          currentTimestamp,
          jurisdictionCode: preparedCredential.jurisdiction,
          senderIdentityHash: preparedCredential.credHashFinalBigInt,
        },
      );

      console.log('Encryption randomness bits:', encryption.randomness.toString(2).length);
      console.log('Encryption scalars count:', encryption.scalars.length);
      console.log('Regulator key X:', encryption.regulatorPubKeyX.toString().slice(0, 20) + '...');

      const circuitInput = buildCircuitInput({
        accreditationStatus: preparedCredential.accreditationStatus,
        balance: amount,
        credentialVersion: preparedCredential.credentialVersion,
        credentialExpiry: preparedCredential.credentialExpiry,
        currentTimestamp,
        dateOfBirth: preparedCredential.dateOfBirth,
        elgamalRandomness: encryption.randomness,
        encryptedMetadata: encryption.scalars,
        identitySecret: preparedCredential.identitySecret,
        institutionalThreshold: 10_000_000n,
        issuerSignature: preparedCredential.issuerSignature,
        jurisdiction: preparedCredential.jurisdiction,
        merklePathElements: merkleProof.pathElements,
        merklePathIndices: merkleProof.pathIndices,
        merkleRoot: merkleProof.root,
        name: preparedCredential.name,
        nationality: preparedCredential.nationality,
        recipientAddress: walletBytesToField(recipient),
        regulatorPubKeyX: encryption.regulatorPubKeyX,
        regulatorPubKeyY: encryption.regulatorPubKeyY,
        retailThreshold: 100_000n,
        accreditedThreshold: 1_000_000n,
        expiredThreshold: 1_000n,
        sourceOfFundsHash: preparedCredential.sourceOfFundsHash,
        transferAmount: amount,
        walletPubkey: preparedCredential.walletPubkey,
      });

      const { proof, publicSignals } = await generateProofWithSnarkJs(
        circuitInput,
        { wasmUrl: WASM_PATH, zkeyUrl: ZKEY_PATH },
      );

      expect(proof).toBeDefined();
      expect(publicSignals.length).toBe(22);
      console.log('Frontend pipeline proof generated successfully!');

      // Verify
      const vkeyRaw = readFileSync(resolve(CIRCUITS_DIR, 'verification_key.json'), 'utf-8');
      const vkey = JSON.parse(vkeyRaw);
      const snarkjs = (await import('snarkjs')) as unknown as {
        groth16: { verify: (vkey: unknown, ps: string[], proof: unknown) => Promise<boolean> };
      };
      const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
      expect(valid).toBe(true);
      console.log('Frontend pipeline proof verified!');
    },
    PROOF_TIMEOUT,
  );
});
