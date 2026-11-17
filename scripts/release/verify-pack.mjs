// Verifies that `pnpm pack` would publish exactly the files this package
// intends, before the publish workflow uploads the tarball.
//
// Checks, in order:
//   1. Pack listing — `pnpm pack --dry-run --json` (the packer behind
//      `pnpm publish`) reports every file that would go into the tarball
//      without writing one. Older pnpm releases reject `--json`, so
//      `npm pack --dry-run --json` is the fallback.
//   2. Allow list — every packed path has to be covered by the `files` field of
//      package.json, or be a metadata file npm and pnpm always ship
//      (package.json, README, LICENSE, CHANGELOG, ...).
//   3. Deny rules — tests, sources, the dependency tree, repository-only files,
//      secrets, source maps and temporary directories never belong in the
//      tarball, even where a `files` pattern would match them.
//   4. Required files — every path the entry point maps point at has to be
//      present, so a pack that drops `dist/` cannot pass by shipping nothing.
//   5. Runtime manifest hygiene — packs a temporary tarball, extracts
//      `package/package.json`, and asserts no self-dependency, no `workspace:`
//      or local link protocol, and only intentional runtime `dependencies`.
//
// `files` points at `dist`, so run `pnpm build` first; `pnpm pack:check` wraps
// this script.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

// Intentional runtime dependencies of `@wraith-protocol/sdk`. Build/dev tools
// and workspace packages must never appear in `dependencies`.
const INTENTIONAL_RUNTIME_DEPENDENCIES = ['@noble/curves', '@noble/hashes', 'viem'];

// Metadata npm and pnpm include whether or not `files` mentions it.
const ALWAYS_INCLUDED = [
  /^package\.json$/i,
  /^(readme|license|licence|notice|copying|authors|changelog|changes|history)(\.[^/]*)?$/i,
];

// Path patterns that must never reach the registry, with the reason to report.
const NEVER_PUBLISH = [
  [/(^|\/)node_modules(\/|$)/, 'dependency tree'],
  [/(^|\/)(test|tests|__tests__)(\/|$)/, 'tests'],
  [/(^|\/)src(\/|$)/, 'TypeScript sources'],
  [/(^|\/)(scripts|examples|docs|audits|packages)(\/|$)/, 'repository-only files'],
  [/(^|\/)\.github(\/|$)/, 'GitHub configuration'],
  [/(^|\/)(coverage|tmp|temp|\.cache)(\/|$)/, 'build or test leftovers'],
  [/\.map$/, 'source maps'],
  [/(^|\/)\.[^/]/, 'dotfiles that can carry local configuration'],
  [/(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p12|pfx|tgz))$/, 'secrets or packaged artifacts'],
];

let failed = 0;

function report(ok, label, detail) {
  if (ok) {
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

/** Squashes a build or spawn error into one readable line. */
function firstLine(error) {
  return String(error instanceof Error ? error.message : error)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0];
}

/**
 * Runs a `pack --dry-run --json`, which reports the tarball contents without
 * writing the tarball, and returns the parsed result. Lifecycle scripts
 * (`prepare`, `prepack`) print before the JSON, so the payload is read from the
 * first line that opens an object.
 */
function dryRunPack(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return {
      error: `${command} ${args.join(' ')} failed: ${firstLine(
        result.error ?? result.stderr ?? result.stdout,
      )}`,
    };
  }
  const lines = (result.stdout ?? '').split('\n');
  const start = lines.findIndex((line) => line.trimStart().startsWith('{'));
  if (start === -1) return { error: `${command} ${args.join(' ')} printed no JSON` };
  let parsed;
  try {
    parsed = JSON.parse(lines.slice(start).join('\n'));
  } catch (error) {
    return { error: `could not parse ${command} output: ${firstLine(error)}` };
  }
  if (!Array.isArray(parsed.files)) return { error: `${command} JSON has no files array` };
  return { packed: parsed };
}

function packListing() {
  const attempts = [
    ['pnpm', ['pack', '--dry-run', '--json']],
    ['npm', ['pack', '--dry-run', '--json', '--ignore-scripts']],
  ];
  const errors = [];
  for (const [command, args] of attempts) {
    const result = dryRunPack(command, args);
    if (!result.error) return { ...result, command: `${command} ${args.join(' ')}` };
    errors.push(result.error);
  }
  return { errors };
}

/** Converts a `files` entry into a regular expression over packed paths. */
function globToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        // A `**/` segment may match no directory at all, so `dist/**/*.js`
        // also covers `dist/index.js`.
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Splits `files` into the patterns that allow a path and the `!` patterns that
 * take one back, treating a directory entry as "the directory and everything
 * under it", the way npm and pnpm read it.
 */
function allowPatterns() {
  const allow = [];
  const deny = [];
  for (const entry of Array.isArray(pkg.files) ? pkg.files : []) {
    const raw = String(entry).trim();
    if (!raw) continue;
    const negated = raw.startsWith('!');
    const target = (negated ? raw.slice(1) : raw).replace(/^\.\//, '').replace(/\/+$/, '');
    if (!target) continue;
    const absolute = join(repoRoot, target);
    const directory = existsSync(absolute) && statSync(absolute).isDirectory();
    (negated ? deny : allow).push(globToRegExp(directory ? `${target}/**` : target));
  }
  return { allow, deny };
}

/** Collects every path the published entry point maps point at. */
function entryPointTargets() {
  const targets = new Set();
  const visit = (value) => {
    if (typeof value === 'string') {
      // A wildcard subpath cannot be checked against one packed path.
      if (!value.includes('*')) targets.add(value.replace(/^\.\//, '').replace(/^\//, ''));
      return;
    }
    if (value && typeof value === 'object')
      for (const nested of Object.values(value)) visit(nested);
  };
  visit(pkg.exports);
  for (const field of [
    'main',
    'module',
    'types',
    'typings',
    'browser',
    'unpkg',
    'jsdelivr',
    'react-native',
    'bin',
  ]) {
    visit(pkg[field]);
  }
  return targets;
}

const listing = packListing();
if (listing.errors) {
  report(false, 'pack dry run', listing.errors.join('; '));
  console.error('\nThe tarball contents could not be listed, so nothing else was checked.');
  process.exit(1);
}

const packed = listing.packed.files.map((file) => String(file.path ?? file.name));
const packedPaths = new Set(packed);

console.log(`Tarball contents from \`${listing.command}\` (${packed.length} files):`);
for (const path of packed) console.log(`  ${path}`);
console.log('');

const { allow, deny } = allowPatterns();
const isAllowed = (path) =>
  allow.some((pattern) => pattern.test(path)) && !deny.some((pattern) => pattern.test(path));
const isAlwaysIncluded = (path) => ALWAYS_INCLUDED.some((pattern) => pattern.test(path));

const forbidden = [];
const unexpected = [];
for (const path of packed) {
  const never = NEVER_PUBLISH.find(([pattern]) => pattern.test(path));
  if (never) forbidden.push(`${path} (${never[1]})`);
  else if (!isAlwaysIncluded(path) && !isAllowed(path)) unexpected.push(path);
}

report(
  forbidden.length === 0,
  'no tests, sources, CI files, secrets or source maps in the tarball',
  forbidden.slice(0, 20).join(', '),
);

if (allow.length === 0) {
  console.log(
    'warn package.json has no `files` field, so every file npm does not ignore is intended',
  );
} else {
  report(
    unexpected.length === 0,
    `every packed file is intended by the files field (${allow.length} pattern${allow.length === 1 ? '' : 's'})`,
    unexpected.length > 0
      ? `not covered by files: ${unexpected.slice(0, 20).join(', ')}` +
          '\n     add an intended path to `files`, or keep it out of the tarball'
      : undefined,
  );
}

const targets = entryPointTargets();
const missing = [...targets].filter((target) => !packedPaths.has(target));
report(
  missing.length === 0,
  `every entry point file is packed (${targets.size} paths)`,
  missing.length > 0 ? `missing from the tarball: ${missing.join(', ')}` : undefined,
);

function inspectPackedManifest() {
  const scratch = mkdtempSync(join(tmpdir(), 'wraith-verify-pack-'));
  try {
    const isWin = process.platform === 'win32';
    const packAttempts = [
      ['pnpm', ['pack', '--pack-destination', scratch]],
      [
        isWin ? 'npm.cmd' : 'npm',
        ['pack', '--pack-destination', scratch, '--ignore-scripts'],
        { shell: isWin },
      ],
    ];
    let packedOk = false;
    const packErrors = [];
    for (const [cmd, args, extra] of packAttempts) {
      const res = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', ...extra });
      if (!res.error && res.status === 0) {
        packedOk = true;
        break;
      }
      packErrors.push(`${cmd}: ${firstLine(res.error ?? res.stderr ?? res.stdout)}`);
    }
    if (!packedOk) {
      report(false, 'packed manifest inspection', packErrors.join('; '));
      return;
    }

    const expectedTarball = join(
      scratch,
      `${pkg.name.replace(/^@/, '').replace(/\//g, '-')}-${pkg.version}.tgz`,
    );
    if (!existsSync(expectedTarball)) {
      report(false, 'packed manifest inspection', `missing tarball ${expectedTarball}`);
      return;
    }

    const extracted = spawnSync(
      'tar',
      ['-xzf', expectedTarball, '-C', scratch, 'package/package.json'],
      { encoding: 'utf8' },
    );
    if (extracted.error || extracted.status !== 0) {
      report(
        false,
        'packed manifest inspection',
        `tar failed: ${firstLine(extracted.error ?? extracted.stderr ?? extracted.stdout)}`,
      );
      return;
    }

    const packedPkg = JSON.parse(readFileSync(join(scratch, 'package', 'package.json'), 'utf8'));
    const depFields = ['dependencies', 'peerDependencies', 'optionalDependencies'];

    const selfRefs = [];
    const localProtocols = [];
    for (const field of depFields) {
      const entries = packedPkg[field] ?? {};
      if (Object.prototype.hasOwnProperty.call(entries, packedPkg.name)) {
        selfRefs.push(`${field}.${packedPkg.name}`);
      }
      for (const [dep, spec] of Object.entries(entries)) {
        if (typeof spec === 'string' && /^(workspace|link|file):/.test(spec)) {
          localProtocols.push(`${field}.${dep}="${spec}"`);
        }
      }
    }

    report(selfRefs.length === 0, 'no self-dependency in the packed manifest', selfRefs.join(', '));
    report(
      localProtocols.length === 0,
      'no workspace or local link specifiers in the packed manifest',
      localProtocols.join(', '),
    );

    const actualDeps = Object.keys(packedPkg.dependencies ?? {}).sort();
    const expectedDeps = [...INTENTIONAL_RUNTIME_DEPENDENCIES].sort();
    const unexpectedDeps = actualDeps.filter((dep) => !expectedDeps.includes(dep));
    const missingDeps = expectedDeps.filter((dep) => !actualDeps.includes(dep));
    const detailParts = [];
    if (unexpectedDeps.length > 0) detailParts.push(`unexpected: ${unexpectedDeps.join(', ')}`);
    if (missingDeps.length > 0) detailParts.push(`missing: ${missingDeps.join(', ')}`);

    report(
      unexpectedDeps.length === 0 && missingDeps.length === 0,
      `runtime dependencies contain only intentional packages (${expectedDeps.join(', ')})`,
      detailParts.join('; '),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

inspectPackedManifest();

process.exit(failed === 0 ? 0 : 1);
