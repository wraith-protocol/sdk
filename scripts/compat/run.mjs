// Supported runtime and peer dependency matrix checks.
//
// Runs each check in its own child process so a crash or hang in one cannot
// mask the others, mirroring the package entry point smoke suite:
//   1. `check.mjs`            - compat/matrix.json vs package.json vs COMPAT.md.
//   2. `verify-imports.mjs`   - every entry point imports and runs on this runtime.
//   3. `verify-imports.mjs`   - the same, against a simulated React Native scope.
//   4. `verify-package.mjs`   - browser bundling, optional peers, tarball contents.
//
// Requires `pnpm build` to have produced dist/ first, the same way CI runs it.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

if (!existsSync(join(repoRoot, 'dist'))) {
  console.error('dist/ not found. Run `pnpm build` before the compat checks.');
  process.exit(1);
}

const steps = [
  ['Matrix and COMPAT.md', 'check.mjs'],
  ['Runtime imports', 'verify-imports.mjs', '--mode=auto'],
  ['React Native imports', 'verify-imports.mjs', '--mode=react-native'],
  ['Built package', 'verify-package.mjs'],
];

let failed = false;

for (const [label, file, ...args] of steps) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, [join(here, file), ...args], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

console.log(failed ? '\ncompat checks FAILED' : '\ncompat checks passed');
process.exit(failed ? 1 : 0);
