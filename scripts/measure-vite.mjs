#!/usr/bin/env node
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

async function measure() {
  const result = await build({
    entryPoints: [join(root, 'src/chains/stellar/index.ts')],
    bundle: true,
    format: 'esm',
    outfile: '/dev/null',
    metafile: true,
    platform: 'browser',
    external: ['@stellar/stellar-sdk', '@solana/web3.js'],
  });

  const metafile = result.metafile;
  const output = Object.values(metafile.outputs)[0];
  const totalBytes = output.bytes;
  const totalGzip = estimateGzip(output.bytes);

  const inputs = Object.entries(metafile.inputs)
    .filter(([path]) => !path.includes('node_modules'))
    .map(([path, info]) => ({
      path,
      bytes: info.bytes,
      importedBy: info.importedBy.length,
      imports: info.imports.length,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const external = Object.entries(metafile.inputs)
    .filter(([path]) => path.includes('node_modules'))
    .map(([path, info]) => ({
      path,
      bytes: info.bytes,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const report = {
    bundler: 'esbuild (standalone — Vite-analogous)',
    totalBytes,
    totalGzip,
    sourceInputs: inputs,
    externalDeps: external,
  };

  writeFileSync(join(root, 'stats/vite-measurement.json'), JSON.stringify(report, null, 2));

  console.log('\n=== Stellar Entry Bundle Size (Vite-style bundling) ===\n');
  console.log(`Total bundle size: ${(totalBytes / 1024).toFixed(2)} KB`);
  console.log(`Estimated gzip:    ${(totalGzip / 1024).toFixed(2)} KB`);
  console.log(`\nSource files included (top 10 by size):`);
  inputs.slice(0, 10).forEach((f) => {
    console.log(`  ${(f.bytes / 1024).toFixed(2)} KB  ${f.path.replace(root + '/', '')}`);
  });
  console.log(`\nExternal dependencies:`);
  external.forEach((f) => {
    const pkg = f.path.match(/node_modules\/([^/]+)/)?.[1] || f.path;
    console.log(`  ${(f.bytes / 1024).toFixed(2)} KB  ${pkg}`);
  });
}

function estimateGzip(bytes) {
  return Math.round(bytes * 0.35);
}

measure().catch((err) => {
  console.error(err);
  process.exit(1);
});
