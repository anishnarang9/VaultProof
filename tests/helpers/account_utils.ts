import { PublicKey } from "@solana/web3.js";

export function deriveKycRegistryPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("kyc_registry")], programId);
}

export function deriveStateTreePda(programId: PublicKey, registry: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("state_tree"), registry.toBuffer()],
    programId
  );
}

export function deriveCredentialLeafPda(
  programId: PublicKey,
  registry: PublicKey,
  leafHash: Buffer
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("credential_leaf"), registry.toBuffer(), leafHash],
    programId
  );
}

export function deriveVaultStatePda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("vault_state")], programId);
}

export function deriveUsdcReservePda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("usdc_reserve")], programId);
}

export function deriveProofBufferPda(programId: PublicKey, owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proof_buffer"), owner.toBuffer()],
    programId
  );
}

export function deriveTransferRecordPda(programId: PublicKey, proofHash: Buffer) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("transfer_record"), proofHash],
    programId
  );
}

export function deriveEmergencyPda(programId: PublicKey, requester: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("emergency"), requester.toBuffer()],
    programId
  );
}

export function deriveDecryptionAuthPda(
  programId: PublicKey,
  transferRecord: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("decryption_auth"), transferRecord.toBuffer()],
    programId
  );
}
