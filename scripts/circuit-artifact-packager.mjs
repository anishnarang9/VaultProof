import { copyFile, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const LOCAL_STATIC_ONLY_NOTE =
  'This is the local-static packaging step only. App code can still use VITE_CIRCUIT_WASM_URL and VITE_CIRCUIT_ZKEY_URL for remote artifacts.';

export function shouldSkipLocalCircuitPackaging(env = process.env) {
  return Boolean(env.VITE_CIRCUIT_WASM_URL && env.VITE_CIRCUIT_ZKEY_URL);
}

export function buildCircuitArtifactCopyPlan(projectRoot) {
  return [
    {
      source: join(projectRoot, 'circuits', 'build', 'compliance_js', 'compliance.wasm'),
      destination: join(projectRoot, 'app', 'public', 'circuits', 'compliance.wasm'),
    },
    {
      source: join(projectRoot, 'circuits', 'build', 'compliance_final.zkey'),
      destination: join(projectRoot, 'app', 'public', 'circuits', 'compliance_final.zkey'),
    },
  ];
}

export function formatMissingCircuitArtifactsError(missingSources) {
  return [
    'Missing local circuit artifacts:',
    ...missingSources.map((source) => `- ${source}`),
    '',
    'Generate or restore a matching circuit build first: cd circuits && npm ci && ./setup.sh (only reuse artifacts that match the deployed verifier key).',
    LOCAL_STATIC_ONLY_NOTE,
  ].join('\n');
}

export async function packageLocalCircuitArtifacts(
  projectRoot,
  { doesPathExist = existsSync } = {},
) {
  const copyPlan = buildCircuitArtifactCopyPlan(projectRoot);
  const missingSources = copyPlan
    .map((entry) => entry.source)
    .filter((source) => !doesPathExist(source));

  if (missingSources.length > 0) {
    throw new Error(formatMissingCircuitArtifactsError(missingSources));
  }

  for (const entry of copyPlan) {
    await mkdir(dirname(entry.destination), { recursive: true });
    await new Promise((resolve, reject) => {
      copyFile(entry.source, entry.destination, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  return copyPlan;
}

export { LOCAL_STATIC_ONLY_NOTE };
