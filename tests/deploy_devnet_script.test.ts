import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const TEST_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const SCRIPT_SOURCE = resolve(TEST_DIR, "..", "scripts", "deploy-devnet.sh");
const ROTATED_IDS = {
  compliance_admin: "J6Z2xLJajs627cCpQQGBRqkvPEGE6YkXsx22CTwFkCaF",
  kyc_registry: "HKAr17WzrUyXudnWb63jxpRtXSEYAFnovv3kVfSKB4ih",
  vusd_vault: "2ZrgfkWWHoverBrKXwZsUnmZMaHUFssGipng31jrnn28",
} as const;

type TempRepo = {
  binDir: string;
  logFile: string;
  repoDir: string;
  scriptPath: string;
};

function writeExecutable(path: string, contents: string) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function createTempRepo(existingKeypairs: readonly string[]): TempRepo {
  const repoDir = mkdtempSync(join(tmpdir(), "vaultproof-deploy-"));
  const scriptPath = join(repoDir, "scripts", "deploy-devnet.sh");
  const logFile = join(repoDir, "command.log");
  const binDir = join(repoDir, "bin");

  mkdirSync(join(repoDir, "scripts"), { recursive: true });
  mkdirSync(join(repoDir, "programs", "kyc-registry", "src"), { recursive: true });
  mkdirSync(join(repoDir, "programs", "vusd-vault", "src"), { recursive: true });
  mkdirSync(join(repoDir, "programs", "compliance-admin", "src"), { recursive: true });
  mkdirSync(join(repoDir, "target", "deploy"), { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeFileSync(scriptPath, readFileSync(SCRIPT_SOURCE, "utf8"));
  chmodSync(scriptPath, 0o755);

  writeFileSync(
    join(repoDir, "Anchor.toml"),
    `[programs.localnet]
kyc_registry = "old-kyc"
vusd_vault = "old-vault"
compliance_admin = "old-compliance"

[programs.devnet]
kyc_registry = "old-kyc"
vusd_vault = "old-vault"
compliance_admin = "old-compliance"
`,
  );
  writeFileSync(
    join(repoDir, "programs", "kyc-registry", "src", "lib.rs"),
    `use anchor_lang::prelude::*;\ndeclare_id!("${ROTATED_IDS.kyc_registry}");\n`,
  );
  writeFileSync(
    join(repoDir, "programs", "vusd-vault", "src", "lib.rs"),
    `use anchor_lang::prelude::*;\ndeclare_id!("${ROTATED_IDS.vusd_vault}");\n`,
  );
  writeFileSync(
    join(repoDir, "programs", "compliance-admin", "src", "lib.rs"),
    `use anchor_lang::prelude::*;\ndeclare_id!("Placeholder1111111111111111111111111111111");\n`,
  );
  writeFileSync(join(repoDir, "target", "deploy", "kyc_registry.so"), "stub");
  writeFileSync(join(repoDir, "target", "deploy", "vusd_vault.so"), "stub");
  writeFileSync(join(repoDir, "target", "deploy", "compliance_admin.so"), "stub");

  for (const programName of existingKeypairs) {
    writeFileSync(join(repoDir, "target", "deploy", `${programName}-keypair.json`), "[]\n");
  }

  writeExecutable(
    join(binDir, "solana"),
    `#!/bin/bash
set -euo pipefail
echo "solana $*" >> "$LOG_FILE"

address_for() {
  case "$1" in
    *kyc_registry-keypair.json) echo "$KYC_ID" ;;
    *vusd_vault-keypair.json) echo "$VAULT_ID" ;;
    *compliance_admin-keypair.json) echo "$COMPLIANCE_ID" ;;
    *) echo "unexpected keypair path: $1" >&2; exit 1 ;;
  esac
}

if [[ "$1" == "config" && "$2" == "set" ]]; then
  exit 0
fi

if [[ "$1" == "balance" ]]; then
  echo "5 SOL"
  exit 0
fi

if [[ "$1" == "airdrop" ]]; then
  echo "Airdrop signature: stub"
  exit 0
fi

if [[ "$1" == "address" && "$2" == "-k" ]]; then
  address_for "$3"
  exit 0
fi

if [[ "$1" == "program" && "$2" == "deploy" ]]; then
  echo "Program Id: $(address_for "$6")"
  exit 0
fi

echo "unexpected solana invocation: $*" >&2
exit 1
`,
  );
  writeExecutable(
    join(binDir, "solana-keygen"),
    `#!/bin/bash
set -euo pipefail
echo "solana-keygen $*" >> "$LOG_FILE"

output_path=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then
    output_path="$2"
    shift 2
    continue
  fi
  shift
done

if [[ -z "$output_path" ]]; then
  echo "missing -o path" >&2
  exit 1
fi

printf "[]\\n" > "$output_path"
`,
  );
  writeExecutable(
    join(binDir, "anchor"),
    `#!/bin/bash
set -euo pipefail
echo "anchor $*" >> "$LOG_FILE"
exit 0
`,
  );

  return {
    binDir,
    logFile,
    repoDir,
    scriptPath,
  };
}

function runDeployScript(repo: TempRepo, env: NodeJS.ProcessEnv = {}) {
  execFileSync(repo.scriptPath, {
    cwd: repo.repoDir,
    env: {
      ...process.env,
      ...env,
      COMPLIANCE_ID: ROTATED_IDS.compliance_admin,
      KYC_ID: ROTATED_IDS.kyc_registry,
      LOG_FILE: repo.logFile,
      PATH: `${repo.binDir}:${process.env.PATH ?? ""}`,
      VAULT_ID: ROTATED_IDS.vusd_vault,
    },
    stdio: "pipe",
  });

  return readFileSync(repo.logFile, "utf8");
}

describe("deploy-devnet script", () => {
  it("reuses committed deploy keypairs when they already exist", () => {
    const repo = createTempRepo([
      "kyc_registry",
      "vusd_vault",
      "compliance_admin",
    ]);

    try {
      const log = runDeployScript(repo);

      assert.equal(log.includes("solana-keygen"), false, log);
      assert.equal(log.includes("anchor build"), true, log);
      assert.equal(
        readFileSync(join(repo.repoDir, "target", "deploy", "program-ids.env"), "utf8"),
        `KYC_REGISTRY_ID=${ROTATED_IDS.kyc_registry}\nVUSD_VAULT_ID=${ROTATED_IDS.vusd_vault}\nCOMPLIANCE_ADMIN_ID=${ROTATED_IDS.compliance_admin}\n`,
      );
    } finally {
      rmSync(repo.repoDir, { force: true, recursive: true });
    }
  });

  it("generates only missing deploy keypairs so fresh deploys still work", () => {
    const repo = createTempRepo(["kyc_registry"]);

    try {
      const log = runDeployScript(repo);
      const keygenMatches = log.match(/solana-keygen new/g) ?? [];

      assert.equal(keygenMatches.length, 2, log);
    } finally {
      rmSync(repo.repoDir, { force: true, recursive: true });
    }
  });

  it("regenerates all deploy keypairs when forced explicitly", () => {
    const repo = createTempRepo([
      "kyc_registry",
      "vusd_vault",
      "compliance_admin",
    ]);

    try {
      const log = runDeployScript(repo, {
        VAULTPROOF_FORCE_NEW_PROGRAM_IDS: "1",
      });
      const keygenMatches = log.match(/solana-keygen new/g) ?? [];

      assert.equal(keygenMatches.length, 3, log);
    } finally {
      rmSync(repo.repoDir, { force: true, recursive: true });
    }
  });
});
