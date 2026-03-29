#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOCAL_STATIC_ONLY_NOTE,
  packageLocalCircuitArtifacts,
  shouldSkipLocalCircuitPackaging,
} from './circuit-artifact-packager.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');

if (shouldSkipLocalCircuitPackaging(process.env)) {
  console.log(
    'Skipping local circuit packaging because VITE_CIRCUIT_WASM_URL and VITE_CIRCUIT_ZKEY_URL are set.',
  );
  process.exit(0);
}

try {
  const packaged = await packageLocalCircuitArtifacts(projectRoot);

  console.log('Packaged local circuit artifacts into app/public/circuits:');
  for (const entry of packaged) {
    console.log(`- ${entry.source} -> ${entry.destination}`);
  }
  console.log(LOCAL_STATIC_ONLY_NOTE);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
