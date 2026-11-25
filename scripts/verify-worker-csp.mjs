// Verifies the scanner worker entry point against a strict Content Security
// Policy that blocks dynamic code and blob workers.
//
// Checks:
//   1. Source fixtures for Vite, Next.js and a plain module worker contain no
//      eval, Function constructor, blob URL or createObjectURL usage.
//   2. esbuild bundles each fixture for the browser and the emitted code is
//      clean by the same rules.
//   3. Each worker bundle runs in a VM whose `eval` and `Function` throw, then
//      completes an empty scan through the real protocol. A bundle that relies
//      on dynamic code fails here rather than in a consumer's app.
//   4. The CSP fixtures disallow `unsafe-eval` and `blob:` workers.
//
// Requires `pnpm build` so `dist/` exists.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const fixtureRoot = join(repoRoot, 'test', 'fixtures', 'worker');

const FORBIDDEN = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/\bFunction\s*\(/, 'Function constructor'],
  [/URL\.createObjectURL\s*\(/, 'URL.createObjectURL()'],
  [/blob:/, 'blob URL'],
];

const WORKER_FIXTURES = ['vite.worker.ts', 'next.worker.ts', 'plain.worker.ts'];
const MAIN_FIXTURES = [
  ['vite.main.ts', /new Worker\(new URL\('\.\/vite\.worker\.ts', import\.meta\.url\)/],
  ['next.main.ts', /new Worker\(new URL\('\.\/next\.worker\.ts', import\.meta\.url\)/],
  ['plain.main.ts', /new Worker\('\.\/plain\.worker\.js', \{ type: 'module' \}\)/],
];

const sdkAlias = {
  name: 'wraith-sdk-alias',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^@wraith-protocol\/sdk(\/scanner\/worker)?$/ }, (args) => {
      if (args.path === '@wraith-protocol/sdk/scanner/worker') {
        return { path: join(repoRoot, 'dist', 'scanner', 'worker.js') };
      }
      if (args.path === '@wraith-protocol/sdk') {
        return { path: join(repoRoot, 'dist', 'index.js') };
      }
      return null;
    });
  },
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

function forbiddenTokens(code) {
  const found = [];
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(code)) found.push(label);
  }
  return found;
}

async function bundle(entryPoint, format) {
  const result = await build({
    entryPoints: [join(fixtureRoot, entryPoint)],
    bundle: true,
    write: false,
    platform: 'browser',
    format,
    target: 'es2022',
    logLevel: 'silent',
    plugins: [sdkAlias],
  });
  return result.outputFiles[0].text;
}

function checkSources() {
  for (const [file, workerCall] of MAIN_FIXTURES) {
    const code = readFileSync(join(fixtureRoot, file), 'utf8');
    const tokens = forbiddenTokens(code);
    report(tokens.length === 0, `source ${file} has no dynamic code`, tokens.join(', '));
    report(workerCall.test(code), `source ${file} loads a static worker module`);
  }

  for (const file of WORKER_FIXTURES) {
    const code = readFileSync(join(fixtureRoot, file), 'utf8');
    const tokens = forbiddenTokens(code);
    report(tokens.length === 0, `source ${file} has no dynamic code`, tokens.join(', '));
    report(
      code.includes('@wraith-protocol/sdk/scanner/worker'),
      `source ${file} imports the worker entry point`,
    );
  }

  const html = readFileSync(join(fixtureRoot, 'index.html'), 'utf8');
  report(
    html.includes("worker-src 'self'") && !html.includes('unsafe-eval') && !html.includes('blob:'),
    'plain fixture CSP disallows unsafe-eval and blob workers',
  );

  const nextConfig = readFileSync(join(fixtureRoot, 'next.config.mjs'), 'utf8');
  report(
    nextConfig.includes('worker-src') &&
      nextConfig.includes("'self'") &&
      !nextConfig.includes('unsafe-eval') &&
      !nextConfig.includes('blob:'),
    'Next.js fixture CSP disallows unsafe-eval and blob workers',
  );
}

async function waitForTerminal(messages, requestId, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const terminal = messages.find(
      (message) => message.requestId === requestId && message.type !== 'progress',
    );
    if (terminal) return terminal;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1));
  }
  return undefined;
}

async function runWorkerBundle(file) {
  const code = await bundle(file, 'iife');
  const tokens = forbiddenTokens(code);
  report(tokens.length === 0, `bundle ${file} has no dynamic code`, tokens.join(', '));

  const messages = [];
  let listener;
  const scope = {
    postMessage(message) {
      messages.push(message);
    },
    addEventListener(type, next) {
      if (type === 'message') listener = next;
    },
    removeEventListener(type, next) {
      if (type === 'message' && listener === next) listener = undefined;
    },
  };

  const context = createContext({
    self: scope,
    console,
    AbortController,
    DOMException,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    structuredClone: globalThis.structuredClone,
    setTimeout,
    clearTimeout,
    queueMicrotask,
  });
  context.eval = () => {
    throw new Error('CSP violation: eval is not allowed');
  };
  context.Function = function CspFunction() {
    throw new Error('CSP violation: Function constructor is not allowed');
  };

  try {
    runInContext(code, context);
  } catch (error) {
    report(false, `bundle ${file} runs without dynamic code`, firstLine(error));
    return;
  }

  if (typeof listener !== 'function') {
    report(false, `bundle ${file} runs without dynamic code`, 'worker handler did not install');
    return;
  }

  const requestId = `csp-${file}`;
  listener({
    data: {
      version: SCANNER_WORKER_PROTOCOL_VERSION,
      type: 'start',
      requestId,
      input: {},
    },
  });
  const terminal = await waitForTerminal(messages, requestId);

  if (!terminal) {
    report(false, `bundle ${file} runs without dynamic code`, 'no terminal response');
    return;
  }

  report(
    terminal.type === 'result' && terminal.matches.length === 0,
    `bundle ${file} runs without dynamic code`,
    terminal.type === 'failure' ? terminal.failure.message : undefined,
  );
}

if (!existsSync(join(repoRoot, 'dist'))) {
  console.error('dist/ not found. Run `pnpm build` before the worker CSP checks.');
  process.exit(1);
}

const { SCANNER_WORKER_PROTOCOL_VERSION } = await import(
  pathToFileURL(join(repoRoot, 'dist', 'scanner', 'worker.js')).href
);

checkSources();

for (const file of WORKER_FIXTURES) {
  await runWorkerBundle(file);
}

for (const [file] of MAIN_FIXTURES) {
  try {
    const code = await bundle(file, 'esm');
    const tokens = forbiddenTokens(code);
    report(tokens.length === 0, `bundle ${file} has no dynamic code`, tokens.join(', '));
  } catch (error) {
    report(false, `bundle ${file}`, firstLine(error));
  }
}

console.log(failed === 0 ? '\nworker CSP checks passed' : '\nworker CSP checks FAILED');
process.exit(failed === 0 ? 0 : 1);
