import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
// @ts-expect-error -- no published types for this entry point
import { run as runJscodeshift } from 'jscodeshift/src/Runner.js';
import { loadFixture, normalize, packageRoot } from './helpers.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-codemod-'));
  const appDir = path.join(tempDir, 'app');
  fs.mkdirSync(appDir, { recursive: true });

  fs.writeFileSync(path.join(appDir, 'errors.ts'), loadFixture('typed-error-catch', 'input.ts'));
  fs.writeFileSync(
    path.join(appDir, 'index.tsx'),
    loadFixture('install-react-native-polyfills', 'input.tsx'),
  );
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const runnerOptions = {
  babel: true,
  extensions: 'ts,tsx,js,jsx',
  parser: 'tsx',
  silent: true,
  runInBand: true,
};

async function runAllV1Transforms(target: string) {
  const transformsDir = path.join(packageRoot, 'transforms', 'v1');
  const transformFiles = fs
    .readdirSync(transformsDir)
    .filter((f) => f.endsWith('.cjs'))
    .sort()
    .map((f) => path.join(transformsDir, f));

  const results = [];
  for (const transformFile of transformFiles) {
    results.push(await runJscodeshift(transformFile, [target], runnerOptions));
  }
  return results;
}

describe('CLI end-to-end (via jscodeshift Runner, as bin/cli.mjs uses it)', () => {
  test('produces the expected diff against a fixture app', async () => {
    const appDir = path.join(tempDir, 'app');

    const results = await runAllV1Transforms(appDir);

    // Each transform should have modified exactly one of the two files.
    const totalOk = results.reduce((sum, r) => sum + r.ok, 0);
    expect(totalOk).toBe(2);
    const totalErrors = results.reduce((sum, r) => sum + r.error, 0);
    expect(totalErrors).toBe(0);

    const errorsOut = fs.readFileSync(path.join(appDir, 'errors.ts'), 'utf8');
    const indexOut = fs.readFileSync(path.join(appDir, 'index.tsx'), 'utf8');

    expect(normalize(errorsOut)).toBe(normalize(loadFixture('typed-error-catch', 'output.ts')));
    expect(normalize(indexOut)).toBe(
      normalize(loadFixture('install-react-native-polyfills', 'output.tsx')),
    );
  }, 30000);

  test('produces the expected diff against a fixture app', async () => {
    const appDir = path.join(tempDir, 'app');

    await runAllV1Transforms(appDir);
    const afterFirstRun = {
      errors: fs.readFileSync(path.join(appDir, 'errors.ts'), 'utf8'),
      index: fs.readFileSync(path.join(appDir, 'index.tsx'), 'utf8'),
    };

    const secondRunResults = await runAllV1Transforms(appDir);

    const afterSecondRun = {
      errors: fs.readFileSync(path.join(appDir, 'errors.ts'), 'utf8'),
      index: fs.readFileSync(path.join(appDir, 'index.tsx'), 'utf8'),
    };

    expect(afterSecondRun).toEqual(afterFirstRun);
    const totalOkOnSecondPass = secondRunResults.reduce((sum, r) => sum + r.ok, 0);
    expect(totalOkOnSecondPass).toBe(0);
  }, 30000);
});
