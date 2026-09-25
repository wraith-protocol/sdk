#!/usr/bin/env node
/**
 * Verifies what `pnpm publish` would actually ship (issue #210).
 *
 * `package.json` restricts the tarball with `"files": ["dist"]`, but nothing
 * checked the result: a stray `files` edit, a new top-level directory, or a
 * generated artifact could quietly start shipping source, tests, API reports or
 * config to every consumer. The publish workflow built and published without ever
 * looking at the packed file list.
 *
 * This runs `pnpm pack --dry-run`, so nothing is written and no tarball is
 * created, then asserts:
 *
 *   1. no source, test, docs, script, config or API-report path is included;
 *   2. the entries a consumer needs (package.json and the built dist entry
 *      points) are present;
 *   3. the tarball name matches the package name and version.
 *
 * Parsing prefers `--json` (exact file list) and falls back to scanning the human
 * output, so the check still works if a pnpm release changes the flag or the
 * rendering.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

/** Paths that must never appear in the published tarball. */
const FORBIDDEN_PREFIXES = [
  'src/',
  'test/',
  'tests/',
  'docs/',
  'examples/',
  'scripts/',
  'etc/',
  'audits/',
  'packages/',
  'temp/',
  '.github/',
  '.husky/',
];

/** Root files that must never appear, beyond the directory prefixes above. */
const FORBIDDEN_FILES = new Set([
  '.npmrc',
  '.gitignore',
  '.prettierignore',
  '.prettierrc',
  'bun.lock',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'tsup.config.ts',
  'vitest.config.ts',
  'commitlint.config.cjs',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'MIGRATING.md',
  'COMPAT.md',
  'BUNDLE_SIZE.md',
  'RELEASING.md',
  'api-extractor.json',
  'api-extractor-ckb.json',
  'api-extractor-evm.json',
  'api-extractor-solana.json',
  'api-extractor-stellar.json',
  'api-extractor-vault.json',
]);

/** Root files npm always includes regardless of `files`, so they are expected. */
const AUTO_INCLUDED = new Set([
  'package.json',
  'readme',
  'readme.md',
  'license',
  'licence',
  'license.md',
  'changelog',
  'changelog.md',
]);

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Runs `pnpm pack --dry-run --json`, returning the parsed entries or null. */
function packJson() {
  const attempts = [
    ['pnpm', ['pack', '--dry-run', '--json']],
    ['npm', ['pack', '--dry-run', '--json', '--ignore-scripts']],
  ];
  for (const [cmd, args] of attempts) {
    try {
      const raw = run(cmd, args);
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start === -1 || end === -1) continue;
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].files)) {
        return parsed[0];
      }
    } catch {
      // try the next strategy
    }
  }
  return null;
}

/** Falls back to the plain `pnpm pack --dry-run` text output. */
function packText() {
  try {
    return run('pnpm', ['pack', '--dry-run']);
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout) : '';
    const stderr = error.stderr ? String(error.stderr) : '';
    if (stdout || stderr) return `${stdout}\n${stderr}`;
    throw error;
  }
}

const problems = [];
const json = packJson();
let paths = null;

if (json) {
  paths = json.files.map((file) => file.path);
} else {
  // No structured output: still able to prove nothing forbidden leaked.
  const text = packText();
  const leaked = [...FORBIDDEN_PREFIXES, ...FORBIDDEN_FILES].filter((needle) =>
    new RegExp(`(^|[\\s/"'])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm').test(text),
  );
  for (const needle of leaked) {
    problems.push(`pack output references "${needle}", which must not be published`);
  }
  if (!/dist\//.test(text)) problems.push('pack output does not mention any dist/ entry');
  if (!/package\.json/.test(text)) problems.push('pack output does not mention package.json');

  console.log(text.trim());
  console.log('\n(pnpm did not emit JSON; verified against the plain pack output.)');
}

if (paths) {
  for (const path of paths) {
    const normalised = path.replace(/^\.\//, '');
    const lower = normalised.toLowerCase();
    if (FORBIDDEN_PREFIXES.some((prefix) => normalised.startsWith(prefix))) {
      problems.push(`forbidden directory in tarball: ${normalised}`);
      continue;
    }
    const isRootFile = !normalised.includes('/');
    if (isRootFile && FORBIDDEN_FILES.has(normalised)) {
      problems.push(`forbidden file in tarball: ${normalised}`);
      continue;
    }
    if (isRootFile && !AUTO_INCLUDED.has(lower)) {
      problems.push(
        `unexpected root file in tarball: ${normalised} (add it to files, or to the allowlist in scripts/verify-pack.mjs if npm auto-includes it)`,
      );
    }
  }

  if (!paths.includes('package.json')) problems.push('package.json is missing from the tarball');
  if (!paths.some((path) => /^dist\/.*\.(cjs|mjs|js)$/.test(path))) {
    problems.push('no dist/ runtime entry point in the tarball — did the build run first?');
  }
  if (!paths.some((path) => /^dist\/.*\.d\.(ts|cts|mts)$/.test(path))) {
    problems.push('no dist/ TypeScript declarations in the tarball');
  }

  const expectedTarball = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;
  if (json.filename && json.filename !== expectedTarball) {
    problems.push(`tarball name ${json.filename} does not match package ${pkg.name}@${pkg.version} (expected ${expectedTarball})`);
  }

  console.log(`Packed ${paths.length} entries for ${pkg.name}@${pkg.version}:`);
  for (const path of paths) console.log(`  ${path}`);
  console.log(`\nTarball: ${json.filename} (${json.unpackedSize} bytes unpacked)`);
}

if (problems.length > 0) {
  console.error(`\npack verification failed (${problems.length} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nNothing was published. Fix `files` in package.json (or scripts/verify-pack.mjs) and retry.');
  process.exit(1);
}

console.log(`\npack verification passed: only intended files would be published by ${pkg.name}@${pkg.version}.`);
