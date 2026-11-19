import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const fixture = join(here, 'fixtures', 'cloudflare-worker.mjs');
const workdir = mkdtempSync(join(tmpdir(), 'wraith-edge-worker-'));
const bundle = join(workdir, 'worker.mjs');

let miniflare;
try {
  await build({
    entryPoints: [fixture],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    absWorkingDir: repoRoot,
  });
  miniflare = new Miniflare({
    modules: true,
    script: readFileSync(bundle, 'utf8'),
    compatibilityDate: '2026-01-01',
  });
  const response = await miniflare.dispatchFetch('https://edge.test/smoke');
  const report = await response.json();
  console.log(JSON.stringify(report));
  if (!report?.ok) {
    throw new Error(report?.error ?? 'Miniflare fixture did not return a report');
  }
} finally {
  await miniflare?.dispose();
  rmSync(workdir, { recursive: true, force: true });
}
