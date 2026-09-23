// Imports every published entry point through its ESM ("import") condition,
// exactly as an ESM consumer of the built package would, and asserts each one
// loads and exposes at least one export.

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { entrypoints } = require('./exports.cjs');

let failed = 0;

for (const ep of entrypoints) {
  const target = ep.import;
  if (!target || !existsSync(target)) {
    console.error(`FAIL esm ${ep.subpath}: import target missing (${target ?? 'none'})`);
    failed += 1;
    continue;
  }
  try {
    const mod = await import(pathToFileURL(target).href);
    const keys = Object.keys(mod);
    if (keys.length === 0) {
      console.error(`FAIL esm ${ep.subpath}: module resolved but has no exports`);
      failed += 1;
    } else {
      console.log(`ok   esm ${ep.subpath} (${keys.length} exports)`);
    }
  } catch (err) {
    console.error(`FAIL esm ${ep.subpath}: ${err && err.stack ? err.stack : err}`);
    failed += 1;
  }
}

process.exit(failed === 0 ? 0 : 1);
