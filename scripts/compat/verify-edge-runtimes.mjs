// Bounded edge-runtime import, crypto, and cancellation smoke runner.
//
// Executes the edge fixtures in `scripts/compat/edge/` against four isolated
// non-Node environments without polyfilling Node `Buffer`, `process`, `fs`, or
// Node `crypto`:
//   - `cloudflare-workers` — Cloudflare `workerd` via Miniflare (no `nodejs_compat`)
//   - `browser-worker`     — standards-only Web Worker isolate (no DOM, no Node globals)
//   - `deno`               — Deno 2.x sandboxed runtime
//   - `bun`                — Bun 1.x with `Buffer` and `process` stripped
//
// Usage:
//   node scripts/compat/verify-edge-runtimes.mjs
//   node scripts/compat/verify-edge-runtimes.mjs --runtime=cloudflare-workers,browser-worker
//   node scripts/compat/verify-edge-runtimes.mjs --runtime=deno
//   node scripts/compat/verify-edge-runtimes.mjs --runtime=bun

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { loadEntrypoints, loadPackage, repoRoot } from './matrix.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const edgeDir = join(here, 'edge');
const RESULT_PREFIX = 'wraith-edge-result ';
const RUNTIME_TIMEOUT_MS = 30_000;

const ALL_RUNTIMES = ['cloudflare-workers', 'browser-worker', 'deno', 'bun'];
const DEFAULT_RUNTIMES = ['cloudflare-workers', 'browser-worker'];

const runtimeArg = process.argv.find((arg) => arg.startsWith('--runtime='));
const requestedRuntimes = runtimeArg
  ? runtimeArg
      .slice('--runtime='.length)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  : DEFAULT_RUNTIMES;

const requestedList = requestedRuntimes.includes('all') ? ALL_RUNTIMES : requestedRuntimes;

const pkg = loadPackage();
const entrypoints = loadEntrypoints();
const documentedSpecifiers = new Set(entrypoints.map((entry) => entry.specifier));
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((mod) => `node:${mod}`)]);

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
  return (
    String(error instanceof Error ? error.message : error)
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? 'unknown error'
  );
}

/**
 * Statically verifies every fixture file under `scripts/compat/edge/` imports
 * only documented `@wraith-protocol/sdk` subpaths (or `./suite.mjs`) and never
 * references a Node builtin or internal `dist/`/`src/` path.
 */
function checkFixtureImports() {
  const files = readdirSync(edgeDir).filter((name) => name.endsWith('.mjs'));
  const importPattern =
    /\b(?:from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\))/g;
  const problems = [];

  for (const file of files) {
    const code = readFileSync(join(edgeDir, file), 'utf8');
    let match;
    while ((match = importPattern.exec(code)) !== null) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier === './suite.mjs') continue;
      if (nodeBuiltins.has(specifier) || specifier.startsWith('node:')) {
        problems.push(`${file} imports forbidden Node builtin "${specifier}"`);
      } else if (specifier.startsWith('.')) {
        problems.push(`${file} imports non-package relative path "${specifier}"`);
      } else if (!documentedSpecifiers.has(specifier)) {
        problems.push(`${file} imports undocumented subpath "${specifier}"`);
      }
    }
  }

  report(
    problems.length === 0,
    `edge fixtures import only documented subpaths (${files.length} files)`,
    problems.join('; '),
  );
}

/**
 * Builds an isolated staging directory containing the built `@wraith-protocol/sdk`
 * package (`package.json` + `dist/`) and only its runtime dependencies
 * (`@noble/curves`, `@noble/hashes`, `viem`), with optional peers excluded so
 * missing-peer capability checks run deterministically.
 */
function createCleanStage() {
  const stage = mkdtempSync(join(tmpdir(), 'wraith-edge-stage-'));
  const fixtureDir = join(stage, 'fixture');
  mkdirSync(fixtureDir, { recursive: true });

  for (const file of readdirSync(edgeDir)) {
    if (file.endsWith('.mjs')) {
      cpSync(join(edgeDir, file), join(fixtureDir, file));
    }
  }

  writeFileSync(
    join(fixtureDir, 'package.json'),
    JSON.stringify({ name: 'wraith-edge-fixture', private: true, type: 'module' }, null, 2) + '\n',
  );

  const stageModules = join(fixtureDir, 'node_modules');
  const sdkStage = join(stageModules, '@wraith-protocol', 'sdk');
  mkdirSync(sdkStage, { recursive: true });
  cpSync(join(repoRoot, 'package.json'), join(sdkStage, 'package.json'));
  cpSync(join(repoRoot, 'dist'), join(sdkStage, 'dist'), { recursive: true });

  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  const runtimeDeps = ['@noble/curves', '@noble/hashes', 'viem'];
  for (const dep of runtimeDeps) {
    const source = join(repoRoot, 'node_modules', ...dep.split('/'));
    const target = join(stageModules, ...dep.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target, linkType);
  }

  return { stage, fixtureDir };
}

/** esbuild plugin that rejects any attempt to resolve a Node builtin or polyfill. */
function forbidNodeBuiltinsPlugin() {
  return {
    name: 'forbid-node-builtins',
    setup(buildApi) {
      buildApi.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith('node:') || nodeBuiltins.has(args.path)) {
          return {
            errors: [
              {
                text: `Forbidden Node builtin "${args.path}" referenced from ${args.importer}`,
              },
            ],
          };
        }
        return null;
      });
    },
  };
}

/** esbuild plugin that rejects `@solana/web3.js` / `@stellar/stellar-sdk` dynamically at runtime. */
function missingOptionalPeersPlugin() {
  const optionalPeers = new Set(['@solana/web3.js', '@stellar/stellar-sdk']);
  return {
    name: 'missing-optional-peers',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@(?:solana\/web3\.js|stellar\/stellar-sdk)$/ }, (args) => {
        if (optionalPeers.has(args.path)) {
          return { path: args.path, namespace: 'missing-optional-peer' };
        }
        return null;
      });
      buildApi.onLoad({ filter: /.*/, namespace: 'missing-optional-peer' }, (args) => ({
        contents: `throw new Error(${JSON.stringify(`Cannot find package '${args.path}'`)});`,
        loader: 'js',
      }));
    },
  };
}

async function runCloudflareWorkers(fixtureDir) {
  const bundled = await build({
    entryPoints: [join(fixtureDir, 'cloudflare-worker.mjs')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser', 'import'],
    plugins: [forbidNodeBuiltinsPlugin(), missingOptionalPeersPlugin()],
    logLevel: 'silent',
  });

  const workerCode = bundled.outputFiles[0].text;
  const { Miniflare } = await import('miniflare');
  const mf = new Miniflare({
    modules: true,
    script: workerCode,
    compatibilityDate: '2025-01-01',
  });

  try {
    const response = await mf.dispatchFetch('http://edge.wraith.local/smoke');
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${firstLine(text)}`);
    }
    const payload = await response.json();
    if (!payload?.ok) {
      throw new Error(`Worker returned non-ok payload: ${JSON.stringify(payload)}`);
    }
    return `Cloudflare Workers / Miniflare (${payload.evmStealthAddress.slice(0, 10)}...)`;
  } finally {
    await mf.dispose();
  }
}

async function runBrowserWorker(fixtureDir) {
  const bundled = await build({
    entryPoints: [join(fixtureDir, 'browser-worker.mjs')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    conditions: ['worker', 'browser', 'import'],
    plugins: [forbidNodeBuiltinsPlugin(), missingOptionalPeersPlugin()],
    logLevel: 'silent',
  });

  const iifeCode = bundled.outputFiles[0].text;
  const harnessSource = `
    import { parentPort } from 'node:worker_threads';

    const port = parentPort;
    globalThis.self = globalThis;
    globalThis.postMessage = (data) => port.postMessage(data);
    port.on('message', (data) => {
      if (typeof globalThis.onmessage === 'function') {
        globalThis.onmessage({ data });
      }
    });

    delete globalThis.Buffer;
    delete globalThis.process;
    delete globalThis.global;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.indexedDB;

    ${iifeCode}
  `;

  const result = await new Promise((resolve, reject) => {
    const dataUrl = new URL(
      `data:text/javascript;charset=utf-8,${encodeURIComponent(harnessSource)}`,
    );
    const esmWorker = new Worker(dataUrl);
    const timer = setTimeout(() => {
      esmWorker.terminate().catch(() => {});
      reject(new Error(`browser worker timed out after ${RUNTIME_TIMEOUT_MS}ms`));
    }, RUNTIME_TIMEOUT_MS);

    esmWorker.once('message', (msg) => {
      clearTimeout(timer);
      esmWorker.terminate().catch(() => {});
      resolve(msg);
    });
    esmWorker.once('error', (err) => {
      clearTimeout(timer);
      esmWorker.terminate().catch(() => {});
      reject(err);
    });
    esmWorker.postMessage({ type: 'run' });
  });

  if (!result?.ok) {
    throw new Error(result?.error ?? 'browser worker returned failure');
  }
  return `Browser Web Worker (${result.summary.evmStealthAddress.slice(0, 10)}...)`;
}

function runDeno(fixtureDir) {
  const isWin = process.platform === 'win32';
  const denoCmd = isWin ? 'deno.cmd' : 'deno';
  const ver = spawnSync(denoCmd, ['--version'], {
    encoding: 'utf8',
    shell: isWin,
    timeout: 10_000,
  });
  if (ver.error || ver.status !== 0) {
    // Fallback to bare `deno` binary on Windows if installed directly on PATH.
    const fallback = spawnSync('deno', ['--version'], { encoding: 'utf8', timeout: 10_000 });
    if (fallback.error || fallback.status !== 0) {
      throw new Error('deno binary is not installed on PATH');
    }
    return executeDeno('deno', false, fixtureDir, firstLine(fallback.stdout));
  }
  return executeDeno(denoCmd, isWin, fixtureDir, firstLine(ver.stdout));
}

function executeDeno(cmd, useShell, fixtureDir, versionLine) {
  const res = spawnSync(
    cmd,
    [
      'run',
      '--node-modules-dir=manual',
      '--no-config',
      '--no-lock',
      `--allow-read=${fixtureDir},${repoRoot}`,
      join(fixtureDir, 'deno-edge.mjs'),
    ],
    {
      cwd: fixtureDir,
      encoding: 'utf8',
      shell: useShell,
      timeout: RUNTIME_TIMEOUT_MS,
    },
  );
  if (res.error || res.status !== 0) {
    const errText = (res.stderr || res.stdout || res.error?.message || '').trim();
    throw new Error(errText.split('\n').slice(-4).join(' | '));
  }
  const line = (res.stdout ?? '').split('\n').find((entry) => entry.startsWith(RESULT_PREFIX));
  if (!line) {
    throw new Error(`Deno printed no result marker: ${firstLine(res.stdout || res.stderr)}`);
  }
  const summary = JSON.parse(line.slice(RESULT_PREFIX.length));
  if (!summary?.ok) throw new Error('Deno summary ok=false');
  return `${versionLine} (${summary.evmStealthAddress.slice(0, 10)}...)`;
}

function runBun(fixtureDir) {
  const isWin = process.platform === 'win32';
  const bunCmd = isWin ? 'bun.cmd' : 'bun';
  const ver = spawnSync(bunCmd, ['--version'], {
    encoding: 'utf8',
    shell: isWin,
    timeout: 10_000,
  });
  if (ver.error || ver.status !== 0) {
    throw new Error('bun binary is not installed on PATH');
  }
  const bunVersion = ver.stdout.trim();
  const res = spawnSync(bunCmd, ['run', join(fixtureDir, 'bun-edge.mjs')], {
    cwd: fixtureDir,
    encoding: 'utf8',
    shell: isWin,
    timeout: RUNTIME_TIMEOUT_MS,
  });
  if (res.error || res.status !== 0) {
    const errText = (res.stderr || res.stdout || res.error?.message || '').trim();
    throw new Error(errText.split('\n').slice(-4).join(' | '));
  }
  const line = (res.stdout ?? '').split('\n').find((entry) => entry.startsWith(RESULT_PREFIX));
  if (!line) {
    throw new Error(`Bun printed no result marker: ${firstLine(res.stdout || res.stderr)}`);
  }
  const summary = JSON.parse(line.slice(RESULT_PREFIX.length));
  if (!summary?.ok) throw new Error('Bun summary ok=false');
  return `Bun ${bunVersion} (${summary.evmStealthAddress.slice(0, 10)}...)`;
}

async function main() {
  if (!existsSync(join(repoRoot, 'dist'))) {
    report(false, 'edge smoke prerequisites', 'dist/ not found — run `pnpm build` first');
    process.exit(1);
  }

  checkFixtureImports();

  const { stage, fixtureDir } = createCleanStage();
  try {
    for (const runtime of requestedList) {
      try {
        let detail;
        if (runtime === 'cloudflare-workers') {
          detail = await runCloudflareWorkers(fixtureDir);
        } else if (runtime === 'browser-worker') {
          detail = await runBrowserWorker(fixtureDir);
        } else if (runtime === 'deno') {
          detail = runDeno(fixtureDir);
        } else if (runtime === 'bun') {
          detail = runBun(fixtureDir);
        } else {
          throw new Error(
            `Unknown --runtime value "${runtime}" (expected ${ALL_RUNTIMES.join(', ')})`,
          );
        }
        report(true, `edge smoke ${runtime} -> ${detail}`);
      } catch (error) {
        report(false, `edge smoke ${runtime}`, firstLine(error));
      }
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }

  process.exit(failed === 0 ? 0 : 1);
}

await main();
