// Server-side import checks for the framework companion packages.
//
// verify-imports.mjs covers the core package. This covers every
// `packages/sdk-*` companion: each one is imported in its own server-only Node
// process (no DOM, no jsdom), with browser globals booby-trapped for the
// duration of the import, and then its minimal SSR path is rendered or
// instantiated. A companion that reads `window`, `document`, storage, or
// browser crypto at import time fails here instead of in a consumer's SSR
// build.
//
// The companion's own source is bundled with esbuild into its node_modules, so
// the check needs no per-package build and its dependencies (`react`, `vue`,
// `svelte`, `solid-js`, and `@wraith-protocol/sdk` itself) resolve from the
// companion package the way they do in an app's server. `@wraith-protocol/sdk`
// resolves to this repo's dist/, so run `pnpm build` first.
//
// Only each companion's `.` entry is checked: `@wraith-protocol/sdk-react/native`
// is the React Native entry and is never loaded by a server.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { repoRoot } from './matrix.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RESULT_PREFIX = 'wraith-ssr-result ';

// The SSR scenario in ssr-probe.mjs for each companion. A new `packages/sdk-*`
// package fails this check until it is given one.
const SCENARIOS = {
  '@wraith-protocol/sdk-agent': 'agent',
  '@wraith-protocol/sdk-react': 'react',
  '@wraith-protocol/sdk-solid': 'solid',
  '@wraith-protocol/sdk-svelte': 'svelte',
  '@wraith-protocol/sdk-vue': 'vue',
};

// Companions whose server import is already broken, with the error it fails
// with. `Wraith`, `WraithAgent` and `Chain` moved from `@wraith-protocol/sdk` to
// `@wraith-protocol/sdk-agent` in #193, but these packages still import them
// from the core, so Node refuses to link them. An entry must keep failing with
// its message: once the import is fixed this check fails until the entry is
// removed, which turns the SSR render back on for that package.
const KNOWN_IMPORT_FAILURES = {
  '@wraith-protocol/sdk-solid': /does not provide an export named '(Wraith|WraithAgent|Chain)'/,
  '@wraith-protocol/sdk-svelte': /does not provide an export named '(Wraith|WraithAgent|Chain)'/,
  '@wraith-protocol/sdk-vue': /does not provide an export named '(Wraith|WraithAgent|Chain)'/,
};

let failed = 0;

function report(ok, label, detail) {
  if (ok) {
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

function firstLine(error) {
  return String(error instanceof Error ? error.message : error)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0];
}

/** Every `packages/sdk-*` workspace package. */
function loadCompanions() {
  const packagesDir = join(repoRoot, 'packages');
  return readdirSync(packagesDir)
    .filter((dir) => dir.startsWith('sdk-'))
    .map((dir) => {
      const root = join(packagesDir, dir);
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      return { name: pkg.name, root, entry: join(root, 'src', 'index.ts') };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Path prefixes whose code counts as authored here, as both paths and file URLs. */
function authoredPaths(companion, bundle) {
  const paths = [join(companion.root, 'src') + sep, join(repoRoot, 'dist') + sep, bundle];
  return paths.flatMap((path) => [path, pathToFileURL(path).href]);
}

async function checkCompanion(companion) {
  const scenario = SCENARIOS[companion.name];
  if (!scenario) {
    report(false, `ssr ${companion.name}`, 'no SSR scenario; add one to verify-ssr-imports.mjs');
    return;
  }

  const workDir = join(companion.root, 'node_modules', '.cache', 'wraith-ssr-smoke');
  const bundle = join(workDir, 'companion.mjs');
  const probe = join(workDir, 'ssr-probe.mjs');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  try {
    try {
      await build({
        entryPoints: [companion.entry],
        outfile: bundle,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        packages: 'external',
        // Some companion tsconfigs map `@wraith-protocol/sdk` to ../../src for
        // type-checking. Keep it external anyway so the built core is what loads.
        external: ['@wraith-protocol/sdk', '@wraith-protocol/sdk/*'],
        sourcemap: 'inline',
        logLevel: 'silent',
      });
    } catch (error) {
      report(false, `ssr bundle ${companion.name}`, firstLine(error));
      return;
    }
    copyFileSync(join(here, 'ssr-probe.mjs'), probe);

    const run = spawnSync(
      process.execPath,
      ['--enable-source-maps', probe, scenario, JSON.stringify(authoredPaths(companion, bundle))],
      { cwd: workDir, encoding: 'utf8', timeout: 60_000 },
    );
    const line = (run.stdout ?? '')
      .split('\n')
      .reverse()
      .find((entry) => entry.startsWith(RESULT_PREFIX));
    if (!line) {
      const detail = firstLine(run.stderr || run.error || `exited with ${run.status}`);
      report(false, `ssr import ${companion.name}`, detail);
      return;
    }
    const result = JSON.parse(line.slice(RESULT_PREFIX.length));

    for (const access of result.browserGlobals) {
      report(false, `ssr import ${companion.name}`, `reads browser global ${relativeTo(access)}`);
    }

    const known = KNOWN_IMPORT_FAILURES[companion.name];
    if (known) {
      if (!result.imported && known.test(result.importError)) {
        console.log(`xfail ssr import ${companion.name} (known): ${result.importError}`);
      } else {
        report(
          false,
          `ssr import ${companion.name}`,
          result.imported
            ? 'imports cleanly now; remove it from KNOWN_IMPORT_FAILURES'
            : `fails with a different error than the known one: ${result.importError}`,
        );
      }
    } else if (!result.imported) {
      // A guarded read already failed above and is why the import threw.
      if (result.browserGlobals.length === 0) {
        report(false, `ssr import ${companion.name}`, relativeTo(result.importError));
      }
      return;
    } else if (result.browserGlobals.length === 0) {
      report(true, `ssr import ${companion.name}`);
    }

    if (result.imported) {
      report(
        result.html !== null,
        `ssr render ${companion.name} (${scenario})`,
        relativeTo(result.ssrError ?? ''),
      );
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Shortens absolute paths and file URLs in a message to repo-relative ones. */
function relativeTo(text) {
  const rootUrl = pathToFileURL(repoRoot).href;
  return String(text)
    .replaceAll(rootUrl + '/', '')
    .replaceAll(repoRoot + sep, '');
}

if (!existsSync(join(repoRoot, 'dist'))) {
  report(false, 'ssr imports', 'dist/ not found — run `pnpm build` first');
} else {
  for (const companion of loadCompanions()) {
    await checkCompanion(companion);
  }
}

process.exit(failed === 0 ? 0 : 1);
