#!/bin/bash
# Refresh the devnet risk oracle to prevent RiskOracleStale errors.
# The oracle has a 24-hour staleness window; run this periodically.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

node -e "
const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, Keypair } = require('@solana/web3.js');
const fs = require('fs');
const crypto = require('crypto');

const VAULT_PROGRAM = new PublicKey('BQBzU5JXU9oBkezAqcnaRht4abWhKyqfYW3B2k5vAizT');
const keypairData = JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf-8'));
const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));
const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from('vault_state')], VAULT_PROGRAM);
const [riskOracle] = PublicKey.findProgramAddressSync([Buffer.from('risk_oracle'), vaultState.toBuffer()], VAULT_PROGRAM);
const address = authority.publicKey;
const [addressRiskScore] = PublicKey.findProgramAddressSync(
  [Buffer.from('risk_score'), riskOracle.toBuffer(), address.toBuffer()], VAULT_PROGRAM
);

const disc = crypto.createHash('sha256').update('global:update_risk_score').digest().slice(0, 8);
const data = Buffer.alloc(41);
disc.copy(data, 0);
address.toBuffer().copy(data, 8);
data[40] = 0;

const ix = new TransactionInstruction({
  keys: [
    { pubkey: vaultState, isSigner: false, isWritable: false },
    { pubkey: riskOracle, isSigner: false, isWritable: true },
    { pubkey: addressRiskScore, isSigner: false, isWritable: true },
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  programId: VAULT_PROGRAM,
  data,
});

const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

async function main() {
  const tx = new Transaction().add(ix);
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(authority);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, 'confirmed');
  const info = await conn.getAccountInfo(riskOracle);
  const lastUpdated = Number(info.data.readBigInt64LE(8 + 32 + 32 + 1 + 1 + 8));
  console.log('Risk oracle refreshed at', new Date(lastUpdated * 1000).toISOString());
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
"
