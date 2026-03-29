import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildCircuitArtifactCopyPlan,
  formatMissingCircuitArtifactsError,
  packageLocalCircuitArtifacts,
  shouldSkipLocalCircuitPackaging,
} from '../scripts/circuit-artifact-packager.mjs';

test('buildCircuitArtifactCopyPlan maps local build artifacts into app/public/circuits', () => {
  const projectRoot = '/tmp/vaultproof';

  assert.deepEqual(buildCircuitArtifactCopyPlan(projectRoot), [
    {
      source: join(projectRoot, 'circuits', 'build', 'compliance_js', 'compliance.wasm'),
      destination: join(projectRoot, 'app', 'public', 'circuits', 'compliance.wasm'),
    },
    {
      source: join(projectRoot, 'circuits', 'build', 'compliance_final.zkey'),
      destination: join(projectRoot, 'app', 'public', 'circuits', 'compliance_final.zkey'),
    },
  ]);
});

test('shouldSkipLocalCircuitPackaging requires both remote artifact env vars', () => {
  assert.equal(shouldSkipLocalCircuitPackaging({}), false);
  assert.equal(
    shouldSkipLocalCircuitPackaging({
      VITE_CIRCUIT_WASM_URL: 'https://example.com/compliance.wasm',
    }),
    false,
  );
  assert.equal(
    shouldSkipLocalCircuitPackaging({
      VITE_CIRCUIT_WASM_URL: 'https://example.com/compliance.wasm',
      VITE_CIRCUIT_ZKEY_URL: 'https://example.com/compliance_final.zkey',
    }),
    true,
  );
});

test('formatMissingCircuitArtifactsError calls out local-static packaging and env-based remote fallbacks', () => {
  const errorMessage = formatMissingCircuitArtifactsError([
    join('project', 'circuits', 'build', 'compliance_js', 'compliance.wasm'),
    join('project', 'circuits', 'build', 'compliance_final.zkey'),
  ]);

  assert.match(errorMessage, /Missing local circuit artifacts:/);
  assert.match(errorMessage, /circuits[\\/]build[\\/]compliance_js[\\/]compliance\.wasm/);
  assert.match(errorMessage, /circuits[\\/]build[\\/]compliance_final\.zkey/);
  assert.match(errorMessage, /cd circuits && npm ci && \.\/setup\.sh/);
  assert.match(errorMessage, /match the deployed verifier key/);
  assert.match(errorMessage, /VITE_CIRCUIT_WASM_URL/);
  assert.match(errorMessage, /VITE_CIRCUIT_ZKEY_URL/);
  assert.match(errorMessage, /local-static packaging step only/i);
});

test('packageLocalCircuitArtifacts copies both artifacts into app/public/circuits', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'vaultproof-package-circuits-'));
  const wasmSource = join(projectRoot, 'circuits', 'build', 'compliance_js', 'compliance.wasm');
  const zkeySource = join(projectRoot, 'circuits', 'build', 'compliance_final.zkey');

  await mkdir(join(projectRoot, 'circuits', 'build', 'compliance_js'), { recursive: true });
  await writeFile(wasmSource, 'wasm-bytes');
  await writeFile(zkeySource, 'zkey-bytes');

  const packaged = await packageLocalCircuitArtifacts(projectRoot);

  assert.deepEqual(
    packaged.map((entry) => entry.destination),
    [
      join(projectRoot, 'app', 'public', 'circuits', 'compliance.wasm'),
      join(projectRoot, 'app', 'public', 'circuits', 'compliance_final.zkey'),
    ],
  );

  assert.equal(
    await readFile(join(projectRoot, 'app', 'public', 'circuits', 'compliance.wasm'), 'utf8'),
    'wasm-bytes',
  );
  assert.equal(
    await readFile(join(projectRoot, 'app', 'public', 'circuits', 'compliance_final.zkey'), 'utf8'),
    'zkey-bytes',
  );
});

test('packageLocalCircuitArtifacts throws a clear error when a source artifact is missing', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'vaultproof-package-circuits-missing-'));
  const zkeySource = join(projectRoot, 'circuits', 'build', 'compliance_final.zkey');

  await mkdir(join(projectRoot, 'circuits', 'build'), { recursive: true });
  await writeFile(zkeySource, 'zkey-bytes');

  await assert.rejects(
    () => packageLocalCircuitArtifacts(projectRoot),
    /Missing local circuit artifacts:/,
  );
});
