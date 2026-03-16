#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Creating Devnet Test Registry State ==="
cd "$ROOT_DIR"
npx ts-node --transpile-only scripts/init-devnet-state.ts
