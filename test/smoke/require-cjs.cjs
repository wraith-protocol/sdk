'use strict';

// Requires every published entry point through its CommonJS ("require")
// condition, exactly as a CommonJS consumer of the built package would, and
// asserts each one loads and exposes at least one export.

const { existsSync } = require('node:fs');
const { entrypoints } = require('./exports.cjs');

let failed = 0;

for (const ep of entrypoints) {
  const target = ep.require;
  if (!target || !existsSync(target)) {
    console.error(`FAIL cjs ${ep.subpath}: require target missing (${target || 'none'})`);
    failed += 1;
    continue;
  }
  try {
    const mod = require(target);
    const keys = Object.keys(mod);
    if (keys.length === 0) {
      console.error(`FAIL cjs ${ep.subpath}: module resolved but has no exports`);
      failed += 1;
    } else {
      console.log(`ok   cjs ${ep.subpath} (${keys.length} exports)`);
    }
  } catch (err) {
    console.error(`FAIL cjs ${ep.subpath}: ${err && err.stack ? err.stack : err}`);
    failed += 1;
  }
}

process.exit(failed === 0 ? 0 : 1);
