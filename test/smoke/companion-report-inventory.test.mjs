import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { reconcileCompanionReportInventory } from './companion-report-inventory.mjs';

test('removing a packed subpath requires an intentional report update', ({ onTestFinished }) => {
  const reportFolder = mkdtempSync(join(tmpdir(), 'companion-report-inventory-'));
  onTestFinished(() => rmSync(reportFolder, { recursive: true, force: true }));
  const packageName = '@wraith-protocol/sdk-react';
  const report = 'sdk-react.public.api.md';
  const removed = 'sdk-react-native.public.api.md';
  const renamed = 'sdk-react-mobile.public.api.md';
  const neighboring = 'sdk-react-tools.public.api.md';
  const core = 'sdk-react.api.md';
  const header = (name) => '## Public API Report File for "' + name + '"\n';
  writeFileSync(join(reportFolder, report), header(packageName));
  writeFileSync(join(reportFolder, removed), header(packageName));
  writeFileSync(join(reportFolder, neighboring), header('@wraith-protocol/sdk-react-tools'));
  writeFileSync(join(reportFolder, core), header(packageName));

  const options = { reportFolder, packageName, expectedReports: [report], update: false };
  assert.deepEqual(reconcileCompanionReportInventory(options), [
    'Stale companion API report: ' + removed,
  ]);
  assert.ok(existsSync(join(reportFolder, removed)));

  const rename = { ...options, expectedReports: [report, renamed], update: true };
  assert.deepEqual(reconcileCompanionReportInventory(rename), [
    'Missing companion API report: ' + renamed,
  ]);
  assert.ok(existsSync(join(reportFolder, removed)));
  writeFileSync(join(reportFolder, renamed), header(packageName));
  assert.deepEqual(reconcileCompanionReportInventory(rename), []);
  assert.equal(existsSync(join(reportFolder, removed)), false);
  for (const filename of [report, renamed, neighboring, core]) {
    assert.ok(existsSync(join(reportFolder, filename)));
  }
});
