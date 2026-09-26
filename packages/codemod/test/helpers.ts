import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import jscodeshiftCore from 'jscodeshift/src/core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const packageRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const j = jscodeshiftCore.withParser('tsx');

export function loadFixture(name: string, file: string): string {
  const fixturePath = path.join(packageRoot, 'fixtures', name, file);
  return fs.readFileSync(fixturePath, 'utf8');
}

export function loadTransform(version: string, transformName: string) {
  const transformPath = path.join(packageRoot, 'transforms', version, transformName);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(transformPath);
  return mod.default || mod;
}

export function applyTransform(
  transform: (fileInfo: unknown, api: unknown, options: unknown) => string,
  source: string,
  filePath = 'test.tsx',
): string {
  const fileInfo = { source, path: filePath };
  const api = {
    jscodeshift: j,
    j,
    stats: () => undefined,
    report: () => undefined,
  };
  return transform(fileInfo, api, { printOptions: { quote: 'single' } });
}
/**
 * Normalizes recast/jscodeshift output for comparison across environments:
 * strips trailing whitespace per line and collapses blank lines. Different
 * recast versions format blank lines between inserted nodes slightly
 * differently -- this keeps tests focused on actual content, not that noise.
 */
export function normalize(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
