'use strict';

// Single source of truth for the published entry points, derived from the
// package.json "exports" map so the smoke suite stays in sync automatically.
// Loaded from both the CommonJS fixtures (require) and the ESM fixtures
// (via createRequire), so it is written as CommonJS.

const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const packageName = pkg.name;

function toAbsolute(target) {
  return target ? resolve(repoRoot, target) : null;
}

const entrypoints = Object.entries(pkg.exports).map(([subpath, conditions]) => {
  const clean = subpath === '.' ? '' : subpath.replace(/^\.\//, '');
  const specifier = clean ? `${packageName}/${clean}` : packageName;
  return {
    subpath,
    specifier,
    types: toAbsolute(conditions.types),
    import: toAbsolute(conditions.import),
    require: toAbsolute(conditions.require),
  };
});

module.exports = { repoRoot, packageName, entrypoints };
