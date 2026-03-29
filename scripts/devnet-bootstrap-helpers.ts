import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export type RequiredIdlArtifact = {
  buildArgs: readonly string[];
  idlPath: string;
  programName: string;
};

export const DIRECT_WALLET_AUTHORITY_MODEL_NOTE =
  "Direct wallet authority is used for this demo bootstrap. Squads multisig remains the intended production authority model.";

type DevnetBootstrapPlan = {
  authorityModel: "direct-wallet";
  authorityModelNote: string;
  credentialsOnly: boolean;
  requiredIdlPrograms: readonly string[];
};

type AnchorLike = {
  BorshAccountsCoder: new (idl: any) => unknown;
  Program: new (idl: any, provider: unknown, coder?: unknown, getCustomResolver?: unknown) => unknown;
};

type NormalizeIdlOptions = {
  convertPubkeyToPublicKey?: boolean;
};

type EnsureRequiredIdlArtifactsOptions = {
  execFile?: (
    command: string,
    args: readonly string[],
    options: {
      cwd: string;
      stdio: "inherit";
    },
  ) => void;
  exists?: (path: string) => boolean;
  log?: (message: string) => void;
  mkdir?: (path: string) => void;
  programNames: readonly string[];
  rootDir: string;
};

export function parseBooleanEnvFlag(value: string | undefined) {
  if (!value) {
    return false;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

export function buildRequiredIdlArtifacts(
  rootDir: string,
  programNames: readonly string[],
): RequiredIdlArtifact[] {
  return programNames.map((programName) => {
    const idlPath = resolve(rootDir, "target", "idl", `${programName}.json`);

    return {
      buildArgs: [
        "idl",
        "build",
        "-p",
        programName,
        "-o",
        idlPath,
        "--skip-lint",
      ],
      idlPath,
      programName,
    };
  });
}

export function findMissingIdlArtifacts(
  artifacts: readonly RequiredIdlArtifact[],
  exists: (path: string) => boolean = existsSync,
) {
  return artifacts.filter((artifact) => !exists(artifact.idlPath));
}

export function getAnchorIdlBuildCommands(artifacts: readonly RequiredIdlArtifact[]) {
  return artifacts.map((artifact) => `anchor ${artifact.buildArgs.join(" ")}`);
}

export function resolveDevnetBootstrapPlan(
  env: NodeJS.ProcessEnv = process.env,
): DevnetBootstrapPlan {
  const credentialsOnly = parseBooleanEnvFlag(env.VAULTPROOF_CREDENTIALS_ONLY);

  return {
    authorityModel: "direct-wallet",
    authorityModelNote: DIRECT_WALLET_AUTHORITY_MODEL_NOTE,
    credentialsOnly,
    requiredIdlPrograms: credentialsOnly
      ? ["kyc_registry"]
      : ["kyc_registry", "vusd_vault"],
  };
}

export function createProgramFromIdl<T>(
  anchorModule: AnchorLike,
  idl: { address: string },
  provider: unknown,
) {
  const normalizedIdl = normalizeIdlForAnchorTs(idl, {
    convertPubkeyToPublicKey: false,
  });
  return new anchorModule.Program(
    {
      ...normalizedIdl,
      accounts: [],
    },
    provider,
  ) as T;
}

export function createAccountsCoderFromIdl<T>(
  anchorModule: Pick<AnchorLike, "BorshAccountsCoder">,
  idl: unknown,
) {
  return new anchorModule.BorshAccountsCoder(
    normalizeIdlForAnchorTs(idl, {
      convertPubkeyToPublicKey: false,
    }),
  ) as T;
}

function camelCaseKey(value: string) {
  return value.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase());
}

function camelizeDecodedValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => camelizeDecodedValue(entry)) as T;
  }

  if (value && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        camelCaseKey(key),
        camelizeDecodedValue(entry),
      ]),
    ) as T;
  }

  return value;
}

export function decodeAccountData<T>(
  coder: {
    decode: (accountName: string, data: Buffer) => T;
  },
  accountName: string,
  data: Buffer | Uint8Array,
) {
  return camelizeDecodedValue(coder.decode(accountName, Buffer.from(data)));
}

export function decodeMatchingProgramAccounts<T>(
  coder: {
    accountDiscriminator: (accountName: string) => Buffer;
    decode: (accountName: string, data: Buffer) => T;
  },
  accountName: string,
  accounts: Array<{
    account: {
      data: Buffer | Uint8Array;
    };
    pubkey: unknown;
  }>,
) {
  const discriminator = Buffer.from(coder.accountDiscriminator(accountName));

  return accounts
    .filter(({ account }) =>
      Buffer.from(account.data).subarray(0, discriminator.length).equals(discriminator),
    )
    .map(({ account, pubkey }) => ({
      account: decodeAccountData(coder, accountName, account.data),
      pubkey,
    }));
}

export function normalizeIdlForAnchorTs<T>(
  value: T,
  options: NormalizeIdlOptions = {
    convertPubkeyToPublicKey: true,
  },
): T {
  if (value === "pubkey" && options.convertPubkeyToPublicKey) {
    return "publicKey" as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeIdlForAnchorTs(entry, options)) as T;
  }

  if (value && typeof value === "object") {
    const normalizedObject = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeIdlForAnchorTs(entry, options)]),
    ) as Record<string, unknown>;

    if (Array.isArray(normalizedObject.accounts) && Array.isArray(normalizedObject.types)) {
      const typesByName = new Map(
        normalizedObject.types
          .filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object" && typeof entry.name === "string",
          )
          .map((entry) => [entry.name as string, entry]),
      );

      normalizedObject.accounts = normalizedObject.accounts.map((entry) => {
        if (!entry || typeof entry !== "object") {
          return entry;
        }

        if ("type" in entry) {
          return entry;
        }

        const typeDefinition = typesByName.get((entry as Record<string, unknown>).name as string);
        return typeDefinition
          ? { ...entry, type: (typeDefinition as Record<string, unknown>).type }
          : entry;
      });
    }

    if (Array.isArray(normalizedObject.events) && Array.isArray(normalizedObject.types)) {
      const typesByName = new Map(
        normalizedObject.types
          .filter(
            (entry): entry is Record<string, unknown> =>
              Boolean(entry) && typeof entry === "object" && typeof entry.name === "string",
          )
          .map((entry) => [entry.name as string, entry]),
      );

      normalizedObject.events = normalizedObject.events.map((entry) => {
        if (!entry || typeof entry !== "object") {
          return entry;
        }

        if ("fields" in entry) {
          return entry;
        }

        const typeDefinition = typesByName.get((entry as Record<string, unknown>).name as string);
        const type = typeDefinition && (typeDefinition as Record<string, unknown>).type;
        const fields =
          type && typeof type === "object" && Array.isArray((type as Record<string, unknown>).fields)
            ? (type as Record<string, unknown>).fields
            : undefined;

        return fields ? { ...entry, fields } : entry;
      });
    }

    return normalizedObject as T;
  }

  return value;
}

export function ensureRequiredIdlArtifacts(options: EnsureRequiredIdlArtifactsOptions) {
  const {
    execFile = (command, args, execOptions) =>
      void execFileSync(command, args, execOptions),
    exists = existsSync,
    log = console.log,
    mkdir = (path) => {
      mkdirSync(path, { recursive: true });
    },
    programNames,
    rootDir,
  } = options;
  mkdir(resolve(rootDir, "target", "idl"));
  const artifacts = buildRequiredIdlArtifacts(rootDir, programNames);
  const missing = findMissingIdlArtifacts(artifacts, exists);

  if (missing.length === 0) {
    return artifacts;
  }

  log(
    `Missing IDL artifact(s): ${missing
      .map((artifact) => artifact.programName)
      .join(", ")}. Generating with Anchor before bootstrap continues.`,
  );

  for (const artifact of missing) {
    log(`Running: anchor ${artifact.buildArgs.join(" ")}`);
    execFile("anchor", artifact.buildArgs, {
      cwd: rootDir,
      stdio: "inherit",
    });
  }

  const remainingMissing = findMissingIdlArtifacts(artifacts, exists);
  if (remainingMissing.length > 0) {
    throw new Error(
      `Missing required IDL artifact(s) after build: ${remainingMissing
        .map((artifact) => artifact.programName)
        .join(", ")}`,
    );
  }

  return artifacts;
}
