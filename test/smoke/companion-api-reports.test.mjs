import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { checkCompanionReports } from './companion-api-reports.mjs';

test('reports changes to reachable aliases and excludes internal and unused declarations', ({
  onTestFinished,
}) => {
  const packageDir = mkdtempSync(join(tmpdir(), 'companion-api-'));
  onTestFinished(() => rmSync(packageDir, { recursive: true, force: true }));
  const manifest = { name: '@wraith-protocol/sdk-vue', version: '0.0.0' };
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify(manifest));
  const entry = join(packageDir, 'index.d.ts');
  const declarations = `
type ActivityChain = 'evm' | 'stellar';
type Unused = number;
/** @internal */
interface _InternalEvent { timestamp: number }
/** @public */
interface ActivityEvent { chain: ActivityChain }
export type { ActivityEvent, _InternalEvent };
`;
  writeFileSync(entry, declarations);

  const reportFolder = join(packageDir, 'reports');
  const options = {
    packageDir,
    manifest,
    entrypoints: [{ subpath: '.', typesRel: 'index.d.ts' }],
    reportFolder,
    tempFolder: join(packageDir, 'scratch'),
  };
  expect(checkCompanionReports({ ...options, update: true })).toEqual([]);
  const report = readFileSync(join(reportFolder, 'sdk-vue.public.api.md'), 'utf8');
  expect(report).toContain("type ActivityChain = 'evm' | 'stellar'");
  expect(report).not.toMatch(/Unused|_InternalEvent/);
  expect(checkCompanionReports({ ...options, update: false })).toEqual([]);

  writeFileSync(entry, declarations.replace("'evm' | 'stellar'", "'evm'"));
  expect(checkCompanionReports({ ...options, update: false })).toContain(
    'API .: check sdk-vue.public.api.md',
  );
});

test('test-vectors tracks both JSON files and typed entry points', ({ onTestFinished }) => {
  const packageDir = mkdtempSync(join(tmpdir(), 'companion-vectors-'));
  onTestFinished(() => rmSync(packageDir, { recursive: true, force: true }));
  const manifest = { name: '@wraith-protocol/test-vectors', version: '0.0.0', types: 'index.d.ts' };
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(packageDir, 'sample.json'), '{}');
  writeFileSync(join(packageDir, manifest.types), 'export declare const count: number;');
  // Keep reports outside the package, as they are in the tarball smoke test.
  const fixture = mkdtempSync(join(tmpdir(), 'companion-vectors-reports-'));
  onTestFinished(() => rmSync(fixture, { recursive: true, force: true }));
  const reportFolder = join(fixture, 'reports');
  const options = {
    packageDir,
    manifest,
    entrypoints: [{ subpath: '.', typesRel: manifest.types }],
    reportFolder,
    tempFolder: join(fixture, 'scratch'),
  };
  expect(checkCompanionReports({ ...options, update: true })).toEqual([]);
  expect(readFileSync(join(reportFolder, 'test-vectors.api.md'), 'utf8')).toContain('sample.json');
  writeFileSync(join(packageDir, manifest.types), 'export declare const count: string;');
  expect(checkCompanionReports({ ...options, update: false })).toContain(
    'API .: check test-vectors.public.api.md',
  );
});
