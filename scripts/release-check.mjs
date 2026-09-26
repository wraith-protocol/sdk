#!/usr/bin/env node
/**
 * Release alignment checks (issue #210).
 *
 * The release checklist has three parts that are checkable from the repository
 * itself: the version, the changelog entry for it, and the API report matching
 * the built declarations. This enforces the checkable ones on every PR so a
 * release cannot be cut from a commit whose changelog or API report is stale.
 *
 *   error   - structural problems that always indicate a broken release
 *   warning - the current package version is not documented in CHANGELOG.md
 *
 * The version warning is deliberately not fatal: this repository develops on
 * main ahead of the released version (package.json can legitimately sit behind
 * the "Upcoming" section), so failing on it would block unrelated pulls. The
 * release checklist in RELEASING.md tells the releaser to resolve it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const errors = [];
const warnings = [];

// --- changelog --------------------------------------------------------------
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const released = [...changelog.matchAll(/^##\s+\[?(\d+\.\d+\.\d+)\]?/gm)].map((m) => m[1]);

if (released.length === 0) {
  errors.push('CHANGELOG.md has no released version heading (expected e.g. "## [1.5.0] - 2026-05-31")');
}
const hasUpcoming = /^##\s+Upcoming/im.test(changelog);
if (!hasUpcoming && !released.includes(pkg.version)) {
  errors.push(
    `CHANGELOG.md has neither an "## Upcoming" section nor a "## [${pkg.version}]" heading, so nothing documents work in progress`,
  );
}
if (!released.includes(pkg.version)) {
  warnings.push(
    `package.json version ${pkg.version} has no "## [${pkg.version}]" heading in CHANGELOG.md (latest released: ${released[0] ?? 'none'})`,
  );
}

// --- API reports ------------------------------------------------------------
const apiConfigs = [
  'api-extractor.json',
  'api-extractor-ckb.json',
  'api-extractor-evm.json',
  'api-extractor-solana.json',
  'api-extractor-stellar.json',
  'api-extractor-vault.json',
].filter((file) => existsSync(file));

if (apiConfigs.length === 0) {
  errors.push('no api-extractor configuration found, so the API report cannot be checked');
}

let reportsChecked = 0;
for (const config of apiConfigs) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(config, 'utf8'));
  } catch (error) {
    errors.push(`${config} is not valid JSON (${error.message})`);
    continue;
  }
  const report = parsed.apiReport ?? {};
  if (report.enabled === false) continue;

  const folder = (report.reportFolder ?? '<projectFolder>/etc').replace('<projectFolder>', '.').replace(/^\.\//, '');
  const file = report.reportFileName;
  if (!file) {
    errors.push(`${config}: apiReport.reportFileName is missing, so no report can be located`);
    continue;
  }

  const reportPath = resolve(dirname(config) === '.' ? '.' : dirname(config), folder, file);
  if (!existsSync(reportPath)) {
    errors.push(
      `${config}: API report ${folder}/${file} does not exist — run "pnpm api:check" and commit the report`,
    );
    continue;
  }

  const body = readFileSync(reportPath, 'utf8');
  if (!/^## API Report File for/m.test(body)) {
    errors.push(`${folder}/${file} is not an api-extractor report (missing its header)`);
    continue;
  }
  reportsChecked += 1;
}

// --- report -----------------------------------------------------------------
for (const warning of warnings) console.warn(`warning: ${warning}`);
for (const error of errors) console.error(`error: ${error}`);

if (errors.length > 0) {
  console.error(`\nrelease alignment failed: ${errors.length} error(s).`);
  process.exit(1);
}

console.log(
  `release alignment OK: ${released.length} released changelog entries, ${reportsChecked}/${apiConfigs.length} API report(s) present, package ${pkg.name}@${pkg.version}.`,
);
if (warnings.length > 0) {
  console.log(`(${warnings.length} warning(s) above — resolve before tagging a release, see RELEASING.md.)`);
}
