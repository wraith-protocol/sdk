// Checks that the built package behaves the way the compatibility matrix says.
//
// Three checks run against `dist/` (so run `pnpm build` first):
//   1. Browser: every entry point bundles for `platform: browser`. Optional
//      peers are left external because the app bundler supplies them; anything
//      the SDK itself pulls in — including its regular dependencies — must
//      resolve without a Node builtin.
//   2. Optional peers: every entry point is imported from a synthetic install
//      that has the optional peers removed, and the entries that fail must be
//      exactly the ones the matrix marks as `requiredAtImport`.
//   3. Publish: every file the `exports` map points at is present in the npm
//      tarball, so a consumer's install can resolve every entry point.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { loadEntrypoints, loadMatrix, optionalPeers, repoRoot } from './matrix.mjs';

const matrix = loadMatrix();
const entrypoints = loadEntrypoints();
const optional = optionalPeers(matrix);
const optionalNames = optional.map((peer) => peer.name);

let failed = 0;

function report(ok, label, detail) {
  if (ok) {
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

/** Squashes a build error into one readable line. */
function firstLine(error) {
  return String(error instanceof Error ? error.message : error)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0];
}

async function checkBrowserBundles() {
  if (!existsSync(join(repoRoot, 'dist'))) {
    report(false, 'browser bundles', 'dist/ not found — run `pnpm build` first');
    return;
  }
  for (const entry of entrypoints) {
    const label = `browser bundle ${entry.subpath}`;
    try {
      await build({
        entryPoints: [entry.import],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        write: false,
        logLevel: 'silent',
        external: optionalNames,
      });
      report(true, label);
    } catch (error) {
      report(false, label, firstLine(error));
    }
  }
}

/**
 * Builds a throwaway `node_modules` that mirrors this workspace minus the
 * optional peers, copies `dist/` next to it, and returns the directory. The
 * copy (rather than a symlink) is deliberate: Node resolves a symlinked module
 * to its real path, which would walk back into the workspace `node_modules`
 * and defeat the isolation.
 */
function createIsolatedInstall(hiddenNames) {
  const root = mkdtempSync(join(tmpdir(), 'wraith-compat-install-'));
  const modules = join(root, 'node_modules');
  mkdirSync(modules, { recursive: true });

  const sourceModules = join(repoRoot, 'node_modules');
  for (const name of readdirSync(sourceModules)) {
    if (name.startsWith('.')) continue;
    if (name.startsWith('@')) {
      const scopeSource = join(sourceModules, name);
      const scopeTarget = join(modules, name);
      mkdirSync(scopeTarget, { recursive: true });
      for (const child of readdirSync(scopeSource)) {
        if (hiddenNames.has(`${name}/${child}`)) continue;
        symlinkSync(join(scopeSource, child), join(scopeTarget, child), 'dir');
      }
    } else if (!hiddenNames.has(name)) {
      symlinkSync(join(sourceModules, name), join(modules, name), 'dir');
    }
  }

  cpSync(join(repoRoot, 'dist'), join(root, 'dist'), { recursive: true });
  return root;
}

function checkOptionalPeerIsolation() {
  if (optional.length === 0) return;

  const expectedFailures = new Set();
  for (const peer of optional) {
    for (const subpath of peer.requiredAtImport ?? []) expectedFailures.add(subpath);
  }

  const root = createIsolatedInstall(new Set(optionalNames));
  try {
    for (const [index, entry] of entrypoints.entries()) {
      const target = join(root, 'dist', relative(join(repoRoot, 'dist'), entry.import));
      // A probe file rather than `-e` so the same script runs under both Node
      // and Bun, which format `--eval` differently.
      const probe = join(root, `probe-${index}.mjs`);
      writeFileSync(
        probe,
        `import(${JSON.stringify(pathToFileURL(target).href)}).then(\n` +
          `  () => process.exit(0),\n` +
          `  (error) => { console.error(error?.code ?? error?.message ?? String(error)); process.exit(2); },\n` +
          `);\n`,
      );
      const result = spawnSync(process.execPath, [probe], { cwd: root, encoding: 'utf8' });
      const imported = result.status === 0;
      const shouldFail = expectedFailures.has(entry.subpath);
      const label = `without optional peers: ${entry.subpath}`;
      if (shouldFail) {
        report(
          !imported,
          label,
          'the matrix declares this entry point needs a peer at import time',
        );
      } else {
        report(imported, label, (result.stderr ?? '').trim().split('\n')[0]);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function checkPublishContents() {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.error) {
    report(false, 'publish contents', `could not run npm pack: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    report(false, 'publish contents', firstLine(result.stderr || 'npm pack failed'));
    return;
  }

  let packed;
  try {
    [packed] = JSON.parse(result.stdout);
  } catch (error) {
    report(false, 'publish contents', `could not parse npm pack output: ${firstLine(error)}`);
    return;
  }

  const files = new Set(packed.files.map((file) => file.path));
  const targets = new Set();
  for (const entry of entrypoints) {
    for (const target of [entry.types, entry.import, entry.require]) {
      if (target)
        targets.add(
          target
            .slice(repoRoot.length + 1)
            .split(sep)
            .join('/'),
        );
    }
  }
  targets.add('package.json');

  const missing = [...targets].filter((target) => !files.has(target));
  report(
    missing.length === 0,
    `publish contents (${packed.entryCount} files)`,
    missing.length > 0 ? `missing from the tarball: ${missing.join(', ')}` : undefined,
  );
}

await checkBrowserBundles();
checkOptionalPeerIsolation();
checkPublishContents();

process.exit(failed === 0 ? 0 : 1);
