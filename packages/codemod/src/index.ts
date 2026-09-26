import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- jscodeshift's Runner has no published types for this entry point
import { run as runJscodeshift } from 'jscodeshift/src/Runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

export interface RunCodemodOptions {
  /** Transform set to run, e.g. "v1". Matches a folder under transforms/. */
  version: string;
  /** File or directory to transform. */
  target: string;
  /** Run without writing changes to disk. */
  dry?: boolean;
  /** Print transformed output to stdout. */
  print?: boolean;
  /** Comma-separated list of extensions. Defaults to "ts,tsx,js,jsx". */
  extensions?: string;
}

export interface RunCodemodResult {
  transform: string;
  ok: number;
  nochange: number;
  skip: number;
  error: number;
}

/** List the transform-set names (e.g. ["v1"]) available in this package. */
export function listTransformSets(): string[] {
  const transformsRoot = path.join(packageRoot, 'transforms');
  return fs
    .readdirSync(transformsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** List the individual transform file names within a transform set. */
export function listTransforms(version: string): string[] {
  const dir = path.join(packageRoot, 'transforms', version);
  if (!fs.existsSync(dir)) {
    throw new Error(`Unknown transform set "${version}" (no directory at ${dir}).`);
  }
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.cjs') || file.endsWith('.js'))
    .sort();
}

/**
 * Run every transform in the given transform set against the target path,
 * in file-name order. Mirrors the CLI's behavior, for callers that want to
 * invoke the codemod programmatically instead of shelling out.
 */
export async function runCodemod(options: RunCodemodOptions): Promise<RunCodemodResult[]> {
  const dir = path.join(packageRoot, 'transforms', options.version);
  if (!fs.existsSync(dir)) {
    throw new Error(`Unknown transform set "${options.version}" (no directory at ${dir}).`);
  }

  const transformFiles = listTransforms(options.version).map((file) => path.join(dir, file));
  const target = path.resolve(options.target);

  const results: RunCodemodResult[] = [];

  for (const transformFile of transformFiles) {
    const result = await runJscodeshift(transformFile, [target], {
      dry: Boolean(options.dry),
      print: Boolean(options.print),
      verbose: 0,
      babel: true,
      extensions: options.extensions || 'ts,tsx,js,jsx',
      parser: 'tsx',
      ignorePattern: ['**/node_modules/**'],
      silent: true,
      runInBand: false,
    });
    results.push({ transform: path.basename(transformFile), ...result });
  }

  return results;
}
