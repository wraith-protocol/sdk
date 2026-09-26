// Package entry point smoke tests.
//
// Runs the four checks as isolated child processes against the built package in
// dist/, so a crash or hang in one format cannot mask the others:
//   1. ESM imports of every entry point.
//   2. CommonJS requires of every entry point.
//   3. No entry point imports a Node-only builtin.
//   4. Every entry point's TypeScript declarations resolve.
//
// Requires `pnpm build` to have produced dist/ first, the same way CI runs it.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

if (!existsSync(join(repoRoot, 'dist'))) {
  console.error('dist/ not found. Run `pnpm build` before the entry point smoke tests.');
  process.exit(1);
}

const steps = [
  ['ESM imports', 'import-esm.mjs'],
  ['CommonJS requires', 'require-cjs.cjs'],
  ['No Node-only modules', 'check-node-free.mjs'],
  ['Type declarations', 'check-types.mjs'],
];

let failed = false;

for (const [label, file] of steps) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

console.log(failed ? '\nentry point smoke tests FAILED' : '\nentry point smoke tests passed');
process.exit(failed ? 1 : 0);
