// Smoke-tests every companion workspace package as an independently
// publishable tarball.
//
// For each package it:
//   1. Builds the package (tsup) so dist/ is fresh.
//   2. Runs `pnpm pack --dry-run --json` and verifies the published file list:
//      every packed path is covered by `files`, nothing on the deny list is
//      shipped, and every documented entry-point target is present.
//   3. Packs the target tarball plus any `@wraith-protocol/*` workspace
//      dependencies into real .tgz files, writes a fixture package.json that
//      references every dependency (workspace ones resolved to their local
//      tarballs, third-party ones by their declared version range), and runs
//      `pnpm install` so the fixture layout matches what a real consumer gets
//      after `npm install`.
//   4. Asserts that no `workspace:` protocol survives into the packed
//      package.json — i.e. pnpm rewrote every workspace:* to a real semver
//      range before publishing.
//   5. Verifies ESM imports of every entry point from the installed package.
//   6. Verifies TypeScript declarations resolve when each entry point is
//      imported by its package specifier.
//   7. Verifies documented exports (the exports-map targets exist on disk).
//
// Run with:
//
//   pnpm test:packages

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const require = createRequire(import.meta.url);

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

// Every companion workspace package published independently of the core SDK.
// Kept in sync with pnpm-workspace.yaml (`packages/*`).
const PACKAGES = [
  { name: '@wraith-protocol/sdk-agent', dir: 'packages/sdk-agent' },
  { name: '@wraith-protocol/sdk-react', dir: 'packages/sdk-react' },
  { name: '@wraith-protocol/sdk-vue', dir: 'packages/sdk-vue' },
  { name: '@wraith-protocol/sdk-solid', dir: 'packages/sdk-solid' },
  { name: '@wraith-protocol/sdk-svelte', dir: 'packages/sdk-svelte' },
  { name: '@wraith-protocol/codemod', dir: 'packages/codemod' },
  { name: '@wraith-protocol/test-vectors', dir: 'packages/test-vectors' },
];

let failed = 0;
const results = [];

function spawn(command, args, opts = {}) {
  try {
    const result = execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      ...opts,
    });
    return { ok: true, stdout: String(result), stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? err.message),
    };
  }
}

function globToRegExp(pattern) {
  let source = '';
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` matches this directory and everything beneath it; a trailing
        // `**` matches anything beneath it.
        if (pattern[i + 2] === '/') {
          source += '(?:/.*)?';
          i += 3;
        } else {
          source += '.*';
          i += 2;
        }
      } else {
        source += '[^/]*';
        i += 1;
      }
    } else if (char === '?') {
      source += '[^/]';
      i += 1;
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

function allowPatterns(pkgDir, files) {
  const allow = [];
  const deny = [];
  for (const entry of Array.isArray(files) ? files : []) {
    const raw = String(entry).trim();
    if (!raw) continue;
    const negated = raw.startsWith('!');
    const target = (negated ? raw.slice(1) : raw).replace(/^\.\//, '').replace(/\/+$/, '');
    if (!target) continue;
    const absolute = join(pkgDir, target);
    const directory = existsSync(absolute) && statSync(absolute).isDirectory();
    (negated ? deny : allow).push(globToRegExp(directory ? `${target}/**` : target));
  }
  return { allow, deny };
}

/** Every path the package's entry points point at (exports + main/module/types/bin). */
function entryPointTargets(pkgJson) {
  const targets = new Set();
  const visit = (value) => {
    if (typeof value === 'string') {
      if (!value.includes('*')) targets.add(value.replace(/^\.\//, '').replace(/^\//, ''));
      return;
    }
    if (value && typeof value === 'object')
      for (const nested of Object.values(value)) visit(nested);
  };
  if (pkgJson.exports && typeof pkgJson.exports === 'object') visit(pkgJson.exports);
  for (const field of ['main', 'module', 'types', 'typings', 'browser', 'bin'])
    visit(pkgJson[field]);
  return targets;
}

function entrypointsOf(pkgJson) {
  const entrypoints = [];
  const add = (subpath, conditions) => {
    const clean = subpath === '.' ? '' : subpath.replace(/^\.\//, '');
    const specifier = clean ? `${pkgJson.name}/${clean}` : pkgJson.name;
    entrypoints.push({
      subpath,
      specifier,
      typesRel: conditions.types ?? null,
      importRel: conditions.import ?? null,
      requireRel: conditions.require ?? null,
    });
  };
  if (pkgJson.exports && typeof pkgJson.exports === 'object') {
    for (const [subpath, conditions] of Object.entries(pkgJson.exports)) add(subpath, conditions);
  } else {
    add('.', {
      types: (pkgJson.types || pkgJson.typings) ?? null,
      import: (pkgJson.module || pkgJson.main) ?? null,
      require: pkgJson.main ?? null,
    });
  }
  return entrypoints;
}

function readPkgJson(pkgDir) {
  return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
}

function dryRunPack(pkgDir) {
  const result = spawn('pnpm', ['pack', '--dry-run', '--json'], { cwd: pkgDir });
  if (!result.ok) {
    return {
      error: `pnpm pack --dry-run --json failed: ${(result.stderr || result.stdout).trim().split('\n')[0]}`,
    };
  }
  const stdout = result.stdout;
  const start = stdout.indexOf('{');
  if (start === -1) return { error: 'pnpm pack --dry-run --json printed no JSON' };
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch (err) {
    return { error: `could not parse pnpm pack output: ${err.message}` };
  }
  if (!Array.isArray(parsed.files)) return { error: 'pnpm pack JSON has no files array' };
  return { packed: parsed.files };
}

function tarballNameFor(pkgJson) {
  const scoped = pkgJson.name.replace(/^@/, '').replace(/\//g, '-');
  return `${scoped}-${pkgJson.version}.tgz`;
}

function packTarball(pkgDir, dest) {
  const result = spawn('pnpm', ['pack', '--pack-destination', dest], { cwd: pkgDir });
  if (!result.ok) {
    return { error: `pnpm pack failed: ${(result.stderr || result.stdout).trim().split('\n')[0]}` };
  }
  const pkgJson = readPkgJson(pkgDir);
  const expectedName = tarballNameFor(pkgJson);
  const tarball = join(dest, expectedName);
  if (!existsSync(tarball)) {
    return { error: `could not locate packed tarball in ${dest} (expected ${expectedName})` };
  }
  return { tarball };
}

function checkFileList(pkgDir, pkgJson, packed) {
  const problems = [];
  const packedPaths = new Set(packed.map((f) => String(f.path ?? f.name)));

  console.log(`  tarball contents (${packed.length} files):`);
  for (const file of packed) console.log(`    ${String(file.path ?? file.name)}`);

  const { allow, deny } = allowPatterns(pkgDir, pkgJson.files);
  const isAllowed = (path) =>
    allow.some((pattern) => pattern.test(path)) && !deny.some((pattern) => pattern.test(path));
  const isAlwaysIncluded = (path) => ALWAYS_INCLUDED.some((pattern) => pattern.test(path));

  const forbidden = [];
  const unexpected = [];
  for (const file of packed) {
    const path = String(file.path ?? file.name);
    const never = NEVER_PUBLISH.find(([pattern]) => pattern.test(path));
    if (never) forbidden.push(`${path} (${never[1]})`);
    else if (!isAlwaysIncluded(path) && !isAllowed(path)) unexpected.push(path);
  }

  if (forbidden.length > 0) {
    problems.push(`denied files in tarball: ${forbidden.slice(0, 20).join(', ')}`);
  }
  if (allow.length === 0) {
    console.log(`  warn: package.json has no \`files\` field`);
  } else if (unexpected.length > 0) {
    problems.push(`files not covered by \`files\` field: ${unexpected.slice(0, 20).join(', ')}`);
  }

  const missing = [...entryPointTargets(pkgJson)].filter((t) => !packedPaths.has(t));
  if (missing.length > 0)
    problems.push(`entry-point target missing from tarball: ${missing.join(', ')}`);

  return problems;
}

function scopeDir(fixture, packageName) {
  return join(fixture, 'node_modules', ...packageName.split('/'));
}

// ---------------------------------------------------------------------------
// Workspace-package resolution
// ---------------------------------------------------------------------------

// Map of every known workspace package name to its directory path (relative to
// repoRoot).  This covers the root SDK and all companion packages.
const WORKSPACE_PACKAGES = new Map([
  ['@wraith-protocol/sdk', '.'],
  ['@wraith-protocol/sdk-agent', 'packages/sdk-agent'],
  ['@wraith-protocol/sdk-react', 'packages/sdk-react'],
  ['@wraith-protocol/sdk-vue', 'packages/sdk-vue'],
  ['@wraith-protocol/sdk-solid', 'packages/sdk-solid'],
  ['@wraith-protocol/sdk-svelte', 'packages/sdk-svelte'],
  ['@wraith-protocol/codemod', 'packages/codemod'],
  ['@wraith-protocol/test-vectors', 'packages/test-vectors'],
]);

/**
 * Collect every @wraith-protocol/* name referenced in any dep field, then
 * transitively for each of those packages as well, stopping when the closure
 * is stable.  Returns a Set of package names (excluding `targetName` itself).
 */
function collectWraithDeps(targetName, visited = new Set()) {
  if (visited.has(targetName)) return visited;
  visited.add(targetName);

  const dir = WORKSPACE_PACKAGES.get(targetName);
  if (!dir) return visited;

  let pkgJson;
  try {
    pkgJson = readPkgJson(resolve(repoRoot, dir));
  } catch {
    return visited;
  }

  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dep of Object.keys(pkgJson[field] || {})) {
      if (dep.startsWith('@wraith-protocol/') && !visited.has(dep)) {
        collectWraithDeps(dep, visited);
      }
    }
  }
  return visited;
}

// Pack cache so dependencies (especially the root SDK) are only built and packed once.
const packedDepCache = new Map();

/**
 * Pack every @wraith-protocol/* workspace dependency (transitively) of
 * `targetName` into `destDir`.  Returns a Map<name, tarballPath> for all
 * deps (not including the target itself, which is packed separately).
 */
function packWraithDeps(targetName, destDir) {
  const deps = collectWraithDeps(targetName);
  deps.delete(targetName); // target is already packed by the caller

  const tarballs = new Map();
  for (const name of deps) {
    if (packedDepCache.has(name)) {
      tarballs.set(name, packedDepCache.get(name));
      continue;
    }

    const dir = WORKSPACE_PACKAGES.get(name);
    if (!dir) continue;
    const pkgDir = resolve(repoRoot, dir);

    // Build first so dist/ is fresh (best-effort; ignore if no build script).
    const pkgJson = readPkgJson(pkgDir);
    if (pkgJson.scripts?.build) {
      spawn('pnpm', ['--filter', name, 'build'], { cwd: repoRoot });
    }

    const packed = packTarball(pkgDir, destDir);
    if (packed.error) {
      tarballs.set(name, { error: packed.error });
    } else {
      tarballs.set(name, { tarball: packed.tarball });
      packedDepCache.set(name, { tarball: packed.tarball });
    }
  }
  return tarballs;
}

/**
 * Check that the packed package.json contains no `workspace:` protocol in any
 * dependency field — pnpm must have rewritten them all to real semver ranges.
 */
function noWorkspaceProtocolInPacked(tarball) {
  const tmpExtract = mkdtempSync(join(tmpdir(), 'wraith-pkg-wscheck-'));
  try {
    const result = spawn('tar', [
      '-xzf',
      tarball,
      '--strip-components=1',
      '-C',
      tmpExtract,
      'package/package.json',
    ]);
    if (!result.ok) {
      return [
        `could not extract package.json from tarball to check workspace protocol: ${result.stderr.trim().split('\n')[0]}`,
      ];
    }
    const packedManifest = JSON.parse(readFileSync(join(tmpExtract, 'package.json'), 'utf8'));
    const problems = [];
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [dep, version] of Object.entries(packedManifest[field] || {})) {
        if (typeof version === 'string' && version.startsWith('workspace:')) {
          problems.push(
            `packed package.json still contains workspace protocol: ${field}.${dep} = "${version}"`,
          );
        }
      }
    }
    return problems;
  } finally {
    rmSync(tmpExtract, { recursive: true, force: true });
  }
}

/**
 * Install the target package (and all its dependencies) into a clean fixture
 * directory using `pnpm install`.  @wraith-protocol/* workspace deps are
 * resolved from pre-packed local tarballs so the install layout matches what a
 * real consumer gets after `npm install`.
 *
 * Returns `{ ok, error? }`.
 */
function installPackage(fixture, targetTarball, targetPkgJson, wraith_dep_tarballs) {
  // Build a dependency map for the fixture's own package.json.
  const fixtureDeps = {};
  const overrides = {};

  // The target package itself — installed via its local tarball path.
  fixtureDeps[targetPkgJson.name] = `file:${targetTarball}`;

  // @wraith-protocol/* workspace deps — resolved from their packed tarballs.
  for (const [name, result] of wraith_dep_tarballs) {
    if (result.error) {
      // Surface the pack error but continue; the import check will catch it.
      console.log(`  note: could not pack workspace dep ${name}: ${result.error}`);
      continue;
    }
    fixtureDeps[name] = `file:${result.tarball}`;
    overrides[name] = `file:${result.tarball}`;
  }

  // Third-party deps — collect declared version ranges from the target manifest
  // as well as all workspace dependencies (so transitive peer deps like
  // @stellar/stellar-sdk on @wraith-protocol/sdk are installed in the fixture).
  const manifests = [targetPkgJson];
  for (const [name] of wraith_dep_tarballs) {
    const dir = WORKSPACE_PACKAGES.get(name);
    if (dir) {
      try {
        manifests.push(readPkgJson(resolve(repoRoot, dir)));
      } catch {}
    }
  }

  for (const manifest of manifests) {
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [dep, ver] of Object.entries(manifest[field] || {})) {
        if (dep.startsWith('@wraith-protocol/')) continue;
        if (!(dep in fixtureDeps)) fixtureDeps[dep] = ver;
      }
    }
  }

  // Write a fixture package.json that declares every dep at the resolved version.
  const fixturePkg = join(fixture, 'package.json');
  writeFileSync(
    fixturePkg,
    JSON.stringify(
      {
        name: 'wraith-pkg-smoke-fixture',
        private: true,
        type: 'module',
        dependencies: fixtureDeps,
        overrides,
        resolutions: overrides,
        pnpm: { overrides },
      },
      null,
      2,
    ),
  );

  let wsYaml = 'overrides:\n';
  for (const [k, v] of Object.entries(overrides)) {
    wsYaml += `  "${k}": "${v}"\n`;
  }
  writeFileSync(join(fixture, 'pnpm-workspace.yaml'), wsYaml);

  console.log(`  installing ${Object.keys(fixtureDeps).length} deps via pnpm install …`);
  const result = spawn('pnpm', ['install', '--prefer-offline', '--no-lockfile'], { cwd: fixture });
  if (!result.ok) {
    return {
      ok: false,
      error: `pnpm install failed:\n${(result.stderr || result.stdout).trim().slice(0, 1200)}`,
    };
  }
  return { ok: true };
}

async function esmImportsOk(fixture, entrypoints) {
  const failures = [];
  const checks = entrypoints.map(
    (ep, i) =>
      `try { const ns${i} = await import('${ep.specifier}'); console.log('OK-${i} ' + Object.keys(ns${i}).join(',')); } catch (err) { console.log('ERR-${i} ' + String(err).split('\\n')[0]); }`,
  );
  const script = `${checks.join('\n')}\n`;
  const scriptPath = join(fixture, 'check-esm.mjs');
  writeFileSync(scriptPath, script);
  const result = spawn(process.execPath, [scriptPath], { cwd: fixture });
  const lines = (result.stdout + result.stderr).trim().split('\n').filter(Boolean);
  for (let i = 0; i < entrypoints.length; i += 1) {
    const line = lines.find((l) => l.startsWith(`OK-${i} `) || l.startsWith(`ERR-${i} `));
    if (!line) {
      failures.push({ ep: entrypoints[i], error: 'no output from ESM check' });
      continue;
    }
    if (line.startsWith('ERR-')) {
      failures.push({ ep: entrypoints[i], error: line.slice(`ERR-${i} `.length) });
    } else {
      console.log(
        `    ok   esm ${entrypoints[i].subpath} (${line.slice(`OK-${i} `.length)} exports)`,
      );
    }
  }
  return failures;
}

function typesOk(fixture, packageName, entrypoints) {
  const failures = [];
  const importLines = entrypoints.map((ep, i) => `import * as ns${i} from '${ep.specifier}';`);
  const useLine = `export const used = [${entrypoints.map((_, i) => `ns${i}`).join(', ')}];`;
  writeFileSync(join(fixture, 'consume-types.ts'), `${importLines.join('\n')}\n${useLine}\n`);

  const tsconfig = {
    compilerOptions: {
      module: 'esnext',
      moduleResolution: 'bundler',
      target: 'es2020',
      lib: ['es2020', 'dom'],
      noEmit: true,
      strict: false,
      skipLibCheck: true,
    },
    include: ['consume-types.ts'],
  };
  writeFileSync(join(fixture, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

  const result = spawn('pnpm', ['exec', 'tsc', '-p', join(fixture, 'tsconfig.json')], {
    cwd: repoRoot,
  });
  if (!result.ok) {
    const text = (result.stderr || result.stdout).trim();
    for (const ep of entrypoints) failures.push({ ep, error: text.split('\n')[0] });
    console.log(`    types: tsc reported errors:\n${text.slice(0, 1200)}`);
  } else {
    for (const ep of entrypoints) console.log(`    ok   types ${ep.subpath}`);
  }
  return failures;
}

function documentedExportsOk(pkgDir, entrypoints) {
  const failures = [];
  for (const ep of entrypoints) {
    for (const [field, rel] of Object.entries({
      types: ep.typesRel,
      import: ep.importRel,
      require: ep.requireRel,
    })) {
      if (!rel) continue;
      if (!existsSync(resolve(pkgDir, rel)))
        failures.push({ ep, error: `documented ${field} target missing on disk: ${rel}` });
    }
  }
  for (const f of failures) console.log(`    FAIL exports ${f.ep.subpath}: ${f.error}`);
  return failures;
}

function record(name, problems) {
  const status = problems.length === 0 ? 'pass' : 'fail';
  if (status === 'fail') failed += 1;
  results.push({ name, status, problems });
  console.log(
    `  ${status === 'pass' ? 'ok   ' : 'FAIL'} ${name}: ${
      status === 'pass' ? 'all checks passed' : problems.join('; ')
    }`,
  );
}

async function checkPackage(pkg, sharedPackDir) {
  const pkgDir = resolve(repoRoot, pkg.dir);
  const pkgJson = readPkgJson(pkgDir);
  console.log(`\n=== ${pkg.name} ===`);
  const problems = [];
  const entrypoints = entrypointsOf(pkgJson);

  // 0. Build the package so dist/ reflects current source (skip data-only pkgs).
  if (pkgJson.scripts?.build) {
    const build = spawn('pnpm', ['--filter', pkg.name, 'build'], { cwd: repoRoot });
    if (!build.ok) {
      problems.push(`build failed: ${(build.stderr || build.stdout).trim().split('\n')[0]}`);
      record(pkg.name, problems);
      return;
    }
  }

  // 1. Published file list (dry-run pack).
  const listing = dryRunPack(pkgDir);
  if (listing.error) {
    problems.push(`pack dry run: ${listing.error}`);
    record(pkg.name, problems);
    return;
  }
  problems.push(...checkFileList(pkgDir, pkgJson, listing.packed));

  // 2. Pack a real tarball for the target package.
  const packed = packTarball(pkgDir, sharedPackDir);
  if (packed.error) {
    problems.push(`pack: ${packed.error}`);
    record(pkg.name, problems);
    return;
  }

  // 2a. Assert no `workspace:` protocol survived into the packed manifest.
  problems.push(...noWorkspaceProtocolInPacked(packed.tarball));

  // 2b. Pack all transitive @wraith-protocol/* workspace dependencies so the
  //     fixture install can resolve them from local tarballs rather than npm.
  const wraith_dep_tarballs = packWraithDeps(pkg.name, sharedPackDir);

  // 3. Create a clean fixture and install everything via pnpm install so the
  //    resulting node_modules layout matches a real consumer install.
  const fixture = mkdtempSync(join(tmpdir(), 'wraith-pkg-smoke-'));

  const installed = installPackage(fixture, packed.tarball, pkgJson, wraith_dep_tarballs);
  if (!installed.ok) {
    problems.push(`fixture install: ${installed.error}`);
    try {
      rmSync(fixture, { recursive: true, force: true });
    } catch {
      /* fixture already removed or locked */
    }
    record(pkg.name, problems);
    return;
  }

  // Only packages with JS entry points get ESM/types/export checks.
  const hasEntryPoints = entrypoints.some((e) => e.importRel);

  let importFailures = [];
  let typeFailures = [];
  if (hasEntryPoints) {
    // 4. Documented exports exist on disk in the built package.
    problems.push(
      ...documentedExportsOk(pkgDir, entrypoints).map((f) => `exports ${f.ep.subpath}: ${f.error}`),
    );

    // 5. ESM imports from the installed package.
    importFailures = await esmImportsOk(fixture, entrypoints);

    // 6. Type declarations resolve when imported by package specifier.
    typeFailures = typesOk(fixture, pkgJson.name, entrypoints);

    for (const f of importFailures) problems.push(`esm ${f.ep.subpath}: ${f.error}`);
    for (const f of typeFailures) problems.push(`types ${f.ep.subpath}: ${f.error}`);
  } else {
    console.log(`  no JS entry points (data-only package); skipping ESM/types/exports checks`);
  }

  try {
    rmSync(fixture, { recursive: true, force: true });
  } catch {
    /* fixture already removed or locked */
  }

  record(pkg.name, problems);
}

async function main() {
  const sharedPackDir = mkdtempSync(join(tmpdir(), 'wraith-workspace-packs-'));
  try {
    for (const pkg of PACKAGES) {
      if (!existsSync(resolve(repoRoot, pkg.dir, 'package.json'))) {
        console.error(`FAIL: package directory missing: ${pkg.dir}`);
        failed += 1;
        continue;
      }
      await checkPackage(pkg, sharedPackDir);
    }
  } finally {
    rmSync(sharedPackDir, { recursive: true, force: true });
  }

  console.log(`\nCompanion package smoke tests: ${results.length} packages, ${failed} failed`);
  for (const r of results) {
    console.log(`  ${r.status === 'pass' ? 'ok   ' : 'FAIL'} ${r.name}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();
