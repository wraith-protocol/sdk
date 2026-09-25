// Validates compat/matrix.json and keeps COMPAT.md in sync with it.
//
// Two checks run:
//   1. The matrix agrees with package.json — `engines`, `peerDependencies`,
//      `peerDependenciesMeta`, `dependencies` — and with the published entry
//      points in `exports`, and every declared range is valid semver.
//   2. The generated blocks inside COMPAT.md match the matrix exactly, so the
//      published matrix cannot drift from the data the checks read.
//
// Run with `--write` to regenerate COMPAT.md after editing compat/matrix.json.

import { readFileSync, writeFileSync } from 'node:fs';
import {
  compatDocPath,
  loadEntrypoints,
  loadMatrix,
  loadPackage,
  renderFormattedDoc,
  validateMatrix,
} from './matrix.mjs';

const write = process.argv.includes('--write');

const matrix = loadMatrix();
const pkg = loadPackage();
const entrypoints = loadEntrypoints();

let failed = false;

const problems = validateMatrix(matrix, pkg, entrypoints);
if (problems.length > 0) {
  failed = true;
  console.error('FAIL matrix: compat/matrix.json disagrees with package.json');
  for (const problem of problems) console.error(`  - ${problem}`);
} else {
  console.log(
    `ok   matrix (${matrix.runtimes.length} runtimes, ${matrix.peers.length} dependency ranges, ` +
      `${matrix.unsupported.length} unsupported combinations)`,
  );
}

const current = readFileSync(compatDocPath, 'utf8');
const expected = await renderFormattedDoc(current, matrix);

if (current === expected) {
  console.log('ok   doc (COMPAT.md matches compat/matrix.json)');
} else if (write) {
  writeFileSync(compatDocPath, expected);
  console.log('wrote COMPAT.md');
} else {
  failed = true;
  console.error('FAIL doc: COMPAT.md is stale. Run `pnpm compat:doc` to regenerate it.');
}

process.exit(failed ? 1 : 0);
