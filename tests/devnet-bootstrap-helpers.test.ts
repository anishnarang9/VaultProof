import { strict as assert } from "node:assert";

import {
  createAccountsCoderFromIdl,
  createProgramFromIdl,
  decodeAccountData,
  decodeMatchingProgramAccounts,
  DIRECT_WALLET_AUTHORITY_MODEL_NOTE,
  buildRequiredIdlArtifacts,
  ensureRequiredIdlArtifacts,
  findMissingIdlArtifacts,
  getAnchorIdlBuildCommands,
  normalizeIdlForAnchorTs,
  parseBooleanEnvFlag,
  resolveDevnetBootstrapPlan,
} from "../scripts/devnet-bootstrap-helpers";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const testCases: TestCase[] = [
  {
    name: "parseBooleanEnvFlag recognizes common truthy values",
    run: () => {
      assert.equal(parseBooleanEnvFlag(undefined), false);
      assert.equal(parseBooleanEnvFlag(""), false);
      assert.equal(parseBooleanEnvFlag("0"), false);
      assert.equal(parseBooleanEnvFlag("false"), false);
      assert.equal(parseBooleanEnvFlag("1"), true);
      assert.equal(parseBooleanEnvFlag(" TRUE "), true);
      assert.equal(parseBooleanEnvFlag("yes"), true);
      assert.equal(parseBooleanEnvFlag("On"), true);
    },
  },
  {
    name: "createProgramFromIdl builds an instruction-only client with the provider argument",
    run: () => {
      const calls: unknown[][] = [];
      class FakeProgram {
        constructor(...args: unknown[]) {
          calls.push(args);
        }
      }

      const provider = { wallet: { publicKey: "wallet" } };
      const idl = {
        accounts: [{ discriminator: [1, 2, 3, 4, 5, 6, 7, 8], name: "VaultState" }],
        address: "Program1111111111111111111111111111111111",
        types: [
          {
            name: "VaultState",
            type: {
              fields: [{ name: "authority", type: "pubkey" }],
              kind: "struct",
            },
          },
        ],
      };

      createProgramFromIdl(
        {
          Program: FakeProgram as any,
        } as any,
        idl as any,
        provider as any,
      );

      assert.equal(calls.length, 1);
      assert.equal(calls[0][1], provider);
      assert.deepEqual((calls[0][0] as any).accounts, []);
      assert.equal((calls[0][0] as any).types[0].type.fields[0].type, "pubkey");
    },
  },
  {
    name: "createAccountsCoderFromIdl and account decoders camelize sparse account fields",
    run: async () => {
      const idl = {
        accounts: [{ discriminator: [1, 2, 3, 4, 5, 6, 7, 8], name: "StateTree" }],
        address: "Program1111111111111111111111111111111111",
        types: [
          {
            name: "StateTree",
            type: {
              fields: [
                { name: "registry", type: "pubkey" },
                { name: "root", type: { array: ["u8", 32] } },
                { name: "depth", type: "u8" },
                { name: "nextIndex", type: "u32" },
                { name: "bump", type: "u8" },
              ],
              kind: "struct",
            },
          },
        ],
      };
      class FakeBorshAccountsCoder {
        private readonly accountDiscriminatorBytes: Buffer;

        constructor(private readonly value: any) {
          this.accountDiscriminatorBytes = Buffer.from(value.accounts[0].discriminator);
        }

        async encode(_accountName: string, account: Record<string, unknown>) {
          const payload = Buffer.from(JSON.stringify(account), "utf8");
          return Buffer.concat([this.accountDiscriminatorBytes, payload]);
        }

        decode(_accountName: string, data: Buffer) {
          return JSON.parse(data.subarray(this.accountDiscriminatorBytes.length).toString("utf8"));
        }

        accountDiscriminator() {
          return this.accountDiscriminatorBytes;
        }
      }

      const coder = createAccountsCoderFromIdl(
        {
          BorshAccountsCoder: FakeBorshAccountsCoder as any,
        } as any,
        idl as any,
      );
      assert.equal((coder as any).value.types[0].type.fields[0].type, "pubkey");
      const encoded = await coder.encode("StateTree", {
        bump: 9,
        depth: 20,
        next_index: 7,
        registry: "pubkey",
        root: Array.from({ length: 32 }, () => 1),
      });
      const singleDecoded = decodeAccountData<{ nextIndex: number }>(
        coder as any,
        "StateTree",
        encoded,
      );
      const decoded = decodeMatchingProgramAccounts<{ depth: number; nextIndex: number }>(
        coder as any,
        "StateTree",
        [
          {
            account: { data: Buffer.from("no-match") },
            pubkey: "skip-me",
          },
          {
            account: { data: encoded },
            pubkey: "keep-me",
          },
        ] as any,
      );

      assert.deepEqual(singleDecoded, {
        bump: 9,
        depth: 20,
        nextIndex: 7,
        registry: "pubkey",
        root: Array.from({ length: 32 }, () => 1),
      });
      assert.deepEqual(decoded, [
        {
          account: {
            bump: 9,
            depth: 20,
            nextIndex: 7,
            registry: "pubkey",
            root: Array.from({ length: 32 }, () => 1),
          },
          pubkey: "keep-me",
        },
      ]);
    },
  },
  {
    name: "normalizeIdlForAnchorTs converts legacy pubkey fields recursively",
    run: () => {
      const idl = {
        accounts: [
          {
            discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
            name: "Example",
          },
        ],
        address: "Program1111111111111111111111111111111111",
        instructions: [
          {
            args: [
              { name: "owner", type: "pubkey" },
              { name: "many", type: { vec: "pubkey" } },
              { name: "opt", type: { option: "pubkey" } },
              { name: "arr", type: { array: ["pubkey", 2] } },
            ],
            name: "set_owner",
          },
        ],
        events: [
          {
            discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
            name: "ExampleEvent",
          },
        ],
        types: [
          {
            type: {
              fields: [
                { name: "authority", type: "pubkey" },
                { name: "nested", type: { vec: { defined: { name: "Thing" } } } },
              ],
              kind: "struct",
            },
            name: "Example",
          },
          {
            type: {
              fields: [
                { name: "wallet", type: "pubkey" },
              ],
              kind: "struct",
            },
            name: "ExampleEvent",
          },
        ],
      };

      const normalized = normalizeIdlForAnchorTs(idl as any);

      assert.equal(normalized.instructions[0].args[0].type, "publicKey");
      assert.deepEqual(normalized.instructions[0].args[1].type, { vec: "publicKey" });
      assert.deepEqual(normalized.instructions[0].args[2].type, { option: "publicKey" });
      assert.deepEqual(normalized.instructions[0].args[3].type, { array: ["publicKey", 2] });
      assert.deepEqual(normalized.accounts[0].type.fields[1].type, {
        vec: { defined: { name: "Thing" } },
      });
      assert.equal(normalized.accounts[0].type.fields[0].type, "publicKey");
      assert.deepEqual(normalized.accounts[0].discriminator, [1, 2, 3, 4, 5, 6, 7, 8]);
      assert.equal(normalized.events[0].fields[0].type, "publicKey");
      assert.equal(idl.instructions[0].args[0].type, "pubkey");
    },
  },
  {
    name: "buildRequiredIdlArtifacts maps program names to target/idl paths and commands",
    run: () => {
      const artifacts = buildRequiredIdlArtifacts("/tmp/vaultproof", [
        "kyc_registry",
        "vusd_vault",
      ]);

      assert.deepEqual(artifacts, [
        {
          buildArgs: [
            "idl",
            "build",
            "-p",
            "kyc_registry",
            "-o",
            "/tmp/vaultproof/target/idl/kyc_registry.json",
            "--skip-lint",
          ],
          idlPath: "/tmp/vaultproof/target/idl/kyc_registry.json",
          programName: "kyc_registry",
        },
        {
          buildArgs: [
            "idl",
            "build",
            "-p",
            "vusd_vault",
            "-o",
            "/tmp/vaultproof/target/idl/vusd_vault.json",
            "--skip-lint",
          ],
          idlPath: "/tmp/vaultproof/target/idl/vusd_vault.json",
          programName: "vusd_vault",
        },
      ]);
    },
  },
  {
    name: "findMissingIdlArtifacts returns only artifacts that do not exist",
    run: () => {
      const artifacts = buildRequiredIdlArtifacts("/tmp/vaultproof", [
        "kyc_registry",
        "vusd_vault",
      ]);
      const existing = new Set([artifacts[1].idlPath]);

      const missing = findMissingIdlArtifacts(artifacts, (path) => existing.has(path));

      assert.deepEqual(missing, [artifacts[0]]);
      assert.deepEqual(getAnchorIdlBuildCommands(missing), [
        "anchor idl build -p kyc_registry -o /tmp/vaultproof/target/idl/kyc_registry.json --skip-lint",
      ]);
    },
  },
  {
    name: "resolveDevnetBootstrapPlan standardizes on direct wallet authority",
    run: () => {
      assert.deepEqual(resolveDevnetBootstrapPlan({}), {
        authorityModel: "direct-wallet",
        authorityModelNote: DIRECT_WALLET_AUTHORITY_MODEL_NOTE,
        credentialsOnly: false,
        requiredIdlPrograms: ["kyc_registry", "vusd_vault"],
      });
      assert.deepEqual(
        resolveDevnetBootstrapPlan({
          VAULTPROOF_CREDENTIALS_ONLY: "true",
        } as NodeJS.ProcessEnv),
        {
          authorityModel: "direct-wallet",
          authorityModelNote: DIRECT_WALLET_AUTHORITY_MODEL_NOTE,
          credentialsOnly: true,
          requiredIdlPrograms: ["kyc_registry"],
        },
      );
    },
  },
  {
    name: "ensureRequiredIdlArtifacts builds only missing idls",
    run: () => {
      const artifacts = buildRequiredIdlArtifacts("/tmp/vaultproof", [
        "kyc_registry",
        "vusd_vault",
      ]);
      const existing = new Set([artifacts[1].idlPath]);
      const executed: Array<{ args: readonly string[]; command: string; cwd: string }> = [];
      const createdDirectories: string[] = [];

      ensureRequiredIdlArtifacts({
        execFile: (command, args, options) => {
          executed.push({ args, command, cwd: options.cwd });
          existing.add(artifacts[0].idlPath);
        },
        exists: (path) => existing.has(path),
        log: () => undefined,
        mkdir: (path) => {
          createdDirectories.push(path);
        },
        programNames: ["kyc_registry", "vusd_vault"],
        rootDir: "/tmp/vaultproof",
      });

      assert.deepEqual(createdDirectories, ["/tmp/vaultproof/target/idl"]);
      assert.deepEqual(executed, [
        {
          args: [
            "idl",
            "build",
            "-p",
            "kyc_registry",
            "-o",
            "/tmp/vaultproof/target/idl/kyc_registry.json",
            "--skip-lint",
          ],
          command: "anchor",
          cwd: "/tmp/vaultproof",
        },
      ]);
    },
  },
  {
    name: "ensureRequiredIdlArtifacts throws when a build does not materialize the idl",
    run: () => {
      assert.throws(
        () =>
          ensureRequiredIdlArtifacts({
            execFile: () => undefined,
            exists: () => false,
            log: () => undefined,
            programNames: ["kyc_registry"],
            rootDir: "/tmp/vaultproof",
          }),
        /Missing required IDL artifact\(s\) after build: kyc_registry/,
      );
    },
  },
];

void (async () => {
  let failures = 0;

  for (const testCase of testCases) {
    try {
      await testCase.run();
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${testCase.name}`);
      console.error(error);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  } else {
    console.log(`PASS ${testCases.length} tests`);
  }
})();
