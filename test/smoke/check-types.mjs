// Verifies that the TypeScript declarations for every published entry point
// resolve and type-check the way a consumer's compiler would.
//
// Two checks run:
//   1. Every "types" target declared in package.json exists on disk.
//   2. A generated fixture imports each entry point by its package specifier
//      and is type-checked with `tsc --noEmit`, so a broken or unresolvable
//      declaration file fails the suite.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { entrypoints, repoRoot } = require('./exports.cjs');

let failed = 0;

for (const ep of entrypoints) {
  if (!ep.types || !existsSync(ep.types)) {
    console.error(`FAIL types ${ep.subpath}: declaration target missing (${ep.types ?? 'none'})`);
    failed += 1;
  }
}

const toPosix = (p) => p.split(sep).join('/');

const tmp = mkdtempSync(join(tmpdir(), 'wraith-smoke-types-'));
try {
  const fixture = join(tmp, 'consume-types.ts');
  const importLines = entrypoints.map((ep, i) => `import * as ns${i} from '${ep.specifier}';`);
  const useLine = `export const used = [${entrypoints.map((_, i) => `ns${i}`).join(', ')}];`;
  writeFileSync(fixture, `${importLines.join('\n')}\n${useLine}\n`);

  // Map every specifier to its declared "types" target so resolution mirrors
  // the package's own exports map without depending on a node_modules symlink.
  const paths = {};
  for (const ep of entrypoints) {
    if (ep.types) paths[ep.specifier] = [toPosix(relative(repoRoot, ep.types))];
  }

  const tsconfig = {
    compilerOptions: {
      module: 'esnext',
      moduleResolution: 'bundler',
      target: 'es2020',
      lib: ['es2020', 'dom'],
      noEmit: true,
      strict: false,
      skipLibCheck: true,
      baseUrl: toPosix(repoRoot),
      paths,
      types: [],
    },
    include: [toPosix(fixture)],
  };
  const tsconfigPath = join(tmp, 'tsconfig.json');
  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

  const isWindows = process.platform === 'win32';
  const result = spawnSync(isWindows ? 'pnpm.cmd' : 'pnpm', ['exec', 'tsc', '-p', tsconfigPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.error) {
    console.error(`FAIL types: could not run tsc (${result.error.message})`);
    failed += 1;
  } else if (result.status !== 0) {
    console.error('FAIL types: tsc reported errors resolving declarations');
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
    failed += 1;
  } else {
    console.log(`ok   types (${entrypoints.length} declarations resolve)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
