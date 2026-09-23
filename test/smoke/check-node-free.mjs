// Verifies that no published entry point pulls in a Node-only builtin.
//
// The published entry points are all meant to run in browsers and React Native
// as well as Node, so their authored source must never import a Node builtin
// (`node:*` or a bare builtin such as `fs`, `path`, `crypto`). This walks the
// authored TypeScript module graph reachable from each entry point rather than
// the bundled output, so a browser-safe polyfill that a third-party dependency
// selects through export conditions does not produce a false positive; the
// guard is about code authored in this package.

import { existsSync, readFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { entrypoints, repoRoot } = require('./exports.cjs');

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

function isNodeBuiltin(specifier) {
  if (specifier.startsWith('node:')) return true;
  return BUILTINS.has(specifier);
}

const SPECIFIER_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g, // import ... from "x" / export ... from "x"
  /\bimport\s+["']([^"']+)["']/g, // import "x"
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // import("x")
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("x")
];

function specifiersOf(code) {
  const found = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(code)) !== null) {
      found.add(match[1]);
    }
  }
  return found;
}

// Resolve a relative import to a concrete authored source file. Handles both
// extensionless specifiers and NodeNext-style `.js`/`.mjs`/`.cjs` specifiers
// that map back to a TypeScript source.
function resolveRelative(fromDir, specifier) {
  const withoutJs = specifier.replace(/\.(js|mjs|cjs)$/, '');
  const base = resolve(fromDir, withoutJs);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

// Map a built entry point back to its authored source entry, following the
// tsup layout: dist/<path>.js -> src/<path>.ts.
function sourceEntryFor(ep) {
  const distDir = join(repoRoot, 'dist');
  const fromDist = relative(distDir, ep.import).replace(/\.js$/, '.ts');
  return join(repoRoot, 'src', fromDist);
}

function scan(entryFile) {
  const offenders = new Map();
  const visited = new Set();
  const stack = [entryFile];
  while (stack.length > 0) {
    const file = stack.pop();
    if (visited.has(file) || !existsSync(file)) continue;
    visited.add(file);
    const code = readFileSync(file, 'utf8');
    const bad = [];
    for (const specifier of specifiersOf(code)) {
      if (isNodeBuiltin(specifier)) {
        bad.push(specifier);
      } else if (specifier.startsWith('.')) {
        const next = resolveRelative(dirname(file), specifier);
        if (next) stack.push(next);
      }
    }
    if (bad.length > 0) offenders.set(file, bad);
  }
  return offenders;
}

let failed = 0;

for (const ep of entrypoints) {
  const entry = sourceEntryFor(ep);
  if (!existsSync(entry)) {
    console.error(`FAIL node-free ${ep.subpath}: source entry not found (${entry})`);
    failed += 1;
    continue;
  }
  const offenders = scan(entry);
  if (offenders.size > 0) {
    failed += 1;
    console.error(`FAIL node-free ${ep.subpath}: imports Node-only modules`);
    for (const [file, specifiers] of offenders) {
      console.error(`  ${relative(repoRoot, file)} -> ${specifiers.join(', ')}`);
    }
  } else {
    console.log(`ok   node-free ${ep.subpath}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
