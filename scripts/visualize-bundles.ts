import { transformSync } from 'esbuild';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import type { Plugin } from 'rollup';
import { visualizer } from 'rollup-plugin-visualizer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const STATS_DIR = resolve(ROOT, 'dist/stats');
const require = createRequire(import.meta.url);

const EXTERNAL = ['@stellar/stellar-sdk', '@solana/web3.js'];

const ENTRIES = [
  { name: 'chains/evm', input: 'src/chains/evm/index.ts', output: 'dist/stats/chains-evm.html' },
  {
    name: 'chains/stellar',
    input: 'src/chains/stellar/index.ts',
    output: 'dist/stats/chains-stellar.html',
  },
  {
    name: 'chains/solana',
    input: 'src/chains/solana/index.ts',
    output: 'dist/stats/chains-solana.html',
  },
  { name: 'chains/ckb', input: 'src/chains/ckb/index.ts', output: 'dist/stats/chains-ckb.html' },
] as const;

function tsPlugin(): Plugin {
  function resolveFile(path: string): string | null {
    const candidates = [
      path,
      `${path}.ts`,
      `${path}.js`,
      resolve(path, 'index.ts'),
      resolve(path, 'index.js'),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  function resolvePackage(source: string, importer?: string): string {
    const searchPath = importer ? dirname(importer) : ROOT;
    const resolved = require
      .resolve(source, { paths: [searchPath] })
      .replace(/[/\\]_cjs[/\\]/, '/_esm/')
      .replace(/[/\\]dist[/\\]cjs[/\\]/, '/dist/esm/');

    const nobleEsm = resolved.replace(
      /([/\\]node_modules[/\\]@noble[/\\](?:curves|hashes)[/\\])(?!esm[/\\])(.+\.js)$/,
      '$1esm/$2',
    );

    return existsSync(nobleEsm) ? nobleEsm : resolved;
  }

  return {
    name: 'wraith-ts',
    resolveId(source, importer) {
      if (EXTERNAL.includes(source)) {
        return { id: source, external: true };
      }

      if (source.startsWith('node:')) {
        return { id: source, external: true };
      }

      if (isAbsolute(source)) {
        return source;
      }

      if (!source.startsWith('.')) {
        return resolvePackage(source, importer);
      }

      if (!importer) {
        return null;
      }

      const base = isAbsolute(importer) ? dirname(importer) : dirname(resolve(ROOT, importer));
      const resolved = resolve(base, source);
      return resolveFile(resolved);
    },
    load(id) {
      if (!id.endsWith('.ts')) {
        return null;
      }

      const source = readFileSync(id, 'utf8');
      const result = transformSync(source, {
        loader: 'ts',
        format: 'esm',
        sourcemap: false,
        target: 'es2022',
      });

      return result.code;
    },
  };
}

mkdirSync(STATS_DIR, { recursive: true });

const outputPaths: string[] = [];

for (const entry of ENTRIES) {
  const bundle = await rollup({
    input: resolve(ROOT, entry.input),
    plugins: [
      tsPlugin(),
      visualizer({
        filename: resolve(ROOT, entry.output),
        open: false,
      }),
    ],
    external: EXTERNAL,
  });

  await bundle.generate({ format: 'esm' });
  await bundle.close();
  outputPaths.push(entry.output);
}

console.log('Bundle visualizer files:');
for (const outputPath of outputPaths) {
  console.log(outputPath);
}
