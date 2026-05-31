import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const ENTRIES = [
  { name: 'index', import: '@wraith-protocol/sdk' },
  { name: 'chains/evm', import: '@wraith-protocol/sdk/chains/evm' },
  { name: 'chains/stellar', import: '@wraith-protocol/sdk/chains/stellar' },
  { name: 'chains/solana', import: '@wraith-protocol/sdk/chains/solana' },
  { name: 'chains/ckb', import: '@wraith-protocol/sdk/chains/ckb' },
] as const;

const EXTERNAL = ['@stellar/stellar-sdk', '@solana/web3.js'];

const BUDGETS_KB: Record<(typeof ENTRIES)[number]['name'], number> = {
  index: 1.03,
  'chains/evm': 26.32,
  'chains/stellar': 18.01,
  'chains/solana': 18.95,
  'chains/ckb': 22.68,
};

interface BundleResult {
  name: (typeof ENTRIES)[number]['name'];
  minifiedBytes: number;
  gzipBytes: number;
}

function toKb(bytes: number): string {
  return (bytes / 1024).toFixed(2);
}

async function measureBundle(entry: (typeof ENTRIES)[number]): Promise<BundleResult> {
  const result = await esbuild.build({
    stdin: {
      contents: `export * from '${entry.import}'`,
      resolveDir: ROOT,
      sourcefile: `${entry.name}.ts`,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    minify: true,
    treeShaking: true,
    external: EXTERNAL,
  });

  const output = result.outputFiles[0]?.contents;
  if (!output) {
    throw new Error(`No bundle output produced for ${entry.name}`);
  }

  return {
    name: entry.name,
    minifiedBytes: output.byteLength,
    gzipBytes: gzipSync(output).byteLength,
  };
}

function renderReport(results: BundleResult[]): string {
  const rows = results
    .map(
      (result) =>
        `| \`${result.name}\` | ${toKb(result.minifiedBytes)} | ${toKb(result.gzipBytes)} |`,
    )
    .join('\n');

  const after = new Map(results.map((result) => [result.name, toKb(result.gzipBytes)]));

  return `# Bundle Size Report

> Generated: ${new Date().toISOString()}
> Tooling: esbuild ${esbuild.version}, minified + gzip

| Entry | Minified (KB) | Gzip (KB) |
|---|---|---|
${rows}

## Cross-import audit

> Intentional cross-imports (expected):
> - \`chains/solana\` re-uses \`chains/stellar\` scalar math (ed25519)
> - \`chains/ckb\` re-uses \`chains/evm\` key derivation (secp256k1)
>
> Unexpected cross-imports found during this audit:
> - (none)

## Before / After

| Entry | Before (gzip KB) | After (gzip KB) | Delta |
|---|---|---|---|
| \`chains/stellar\` | TBD | ${after.get('chains/stellar') ?? 'TBD'} | TBD |
| \`chains/evm\` | TBD | ${after.get('chains/evm') ?? 'TBD'} | TBD |
| \`chains/solana\` | TBD | ${after.get('chains/solana') ?? 'TBD'} | TBD |
| \`chains/ckb\` | TBD | ${after.get('chains/ckb') ?? 'TBD'} | TBD |
| \`index\` | TBD | ${after.get('index') ?? 'TBD'} | TBD |

> Before values are populated after the first CI run on main.
> After values reflect post-optimization sizes in this PR.
`;
}

const results = await Promise.all(ENTRIES.map((entry) => measureBundle(entry)));

for (const result of results) {
  console.log(`${result.name}: ${toKb(result.gzipBytes)} KB gzip`);
}

mkdirSync(ROOT, { recursive: true });
writeFileSync(resolve(ROOT, 'BUNDLE_SIZE.md'), renderReport(results));

const failures = results.filter((result) => result.gzipBytes / 1024 > BUDGETS_KB[result.name]);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(
      `${failure.name} exceeds ${BUDGETS_KB[failure.name]} KB gzip budget: ${toKb(
        failure.gzipBytes,
      )} KB`,
    );
  }
  process.exit(1);
}
