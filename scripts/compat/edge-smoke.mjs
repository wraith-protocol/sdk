import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const edgeDir = join(here, 'edge');
const fixtures = join(edgeDir, 'fixtures');
const TIMEOUT_MS = 20000;

if (!existsSync(join(repoRoot, 'dist'))) {
  console.error('dist/ not found. Run `pnpm build` before the edge smoke suite.');
  process.exit(1);
}

function available(command) {
  const probe = spawnSync(command, ['--version'], { stdio: 'ignore', timeout: 5000 });
  return probe.status === 0;
}

const steps = [
  {
    name: 'Browser worker (standards-only scope)',
    command: process.execPath,
    args: [join(edgeDir, 'standard-scope.mjs'), join(fixtures, 'browser-worker.mjs')],
  },
  {
    name: 'Cloudflare Worker fetch handler (standards-only scope)',
    command: process.execPath,
    args: [join(edgeDir, 'standard-scope.mjs'), join(fixtures, 'cloudflare-worker.mjs')],
  },
  {
    name: 'Cloudflare Workers (Miniflare)',
    command: process.execPath,
    args: [join(edgeDir, 'miniflare.mjs')],
  },
  {
    name: 'Bun',
    command: 'bun',
    args: [join(fixtures, 'bun.mjs')],
    when: () => available('bun'),
    skip: 'Bun is not installed',
  },
  {
    name: 'Deno',
    command: 'deno',
    args: [
      'run',
      '--allow-all',
      '--no-prompt',
      '--no-lock',
      `--import-map=${join(edgeDir, 'deno-import-map.json')}`,
      join(fixtures, 'deno.ts'),
    ],
    when: () => available('deno'),
    skip: 'Deno is not installed',
  },
];

let failed = false;

for (const step of steps) {
  if (step.when && !step.when()) {
    console.log(`\nskip ${step.name}: ${step.skip}`);
    continue;
  }
  console.log(`\n=== ${step.name} ===`);
  const started = Date.now();
  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    stdio: 'inherit',
    timeout: TIMEOUT_MS,
    killSignal: 'SIGTERM',
  });
  const elapsed = Date.now() - started;
  if (result.error || result.status !== 0) {
    failed = true;
    console.error(
      `FAIL ${step.name} (${elapsed} ms): ${result.error?.message ?? `exit ${result.status}`}`,
    );
  } else {
    console.log(`ok   ${step.name} (${elapsed} ms)`);
  }
}

console.log(failed ? '\nedge smoke suite FAILED' : '\nedge smoke suite passed');
process.exit(failed ? 1 : 0);
