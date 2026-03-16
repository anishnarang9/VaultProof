#!/bin/bash
set -euo pipefail

echo "=== Funding Devnet Deployer ==="
solana config set --url https://api.devnet.solana.com >/dev/null

solana airdrop 2 --url devnet || true
sleep 3
solana airdrop 2 --url devnet || true
sleep 3

echo "Wallet funded with $(solana balance --url devnet)"
echo "USDC still needs a dedicated devnet mint or faucet flow."
