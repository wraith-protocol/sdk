#!/usr/bin/env tsx
/**
 * Differential harness: runs every fixture in vectors/stellar.json through
 * two builds of @wraith-protocol/sdk — the pinned reference version named in
 * differential.config.json (vN-1) and the current workspace tip — and diffs
 * the outputs field by field.
 *
 * A version bump that silently changes cryptographic output for existing
 * inputs (the kind of regression semver numbers alone don't catch) shows up
 * here as a diff. Diffs must either not exist, or be explicitly waived with
 * a reason in differences.json — anything else fails the run.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = __dirname;
const VECTORS_PATH = join(PACKAGE_ROOT, 'vectors', 'stellar.json');
const RUNNER_SCRIPT = join(PACKAGE_ROOT, 'differential-runner.mjs');
const CONFIG_PATH = join(PACKAGE_ROOT, 'differential.config.json');
const DIFFERENCES_PATH = join(PACKAGE_ROOT, 'differences.json');
const SCRATCH_DIR = join(PACKAGE_ROOT, '.differential', 'reference');

interface DifferentialConfig {
  referenceVersion: string;
  referencePeerDependencies: Record<string, string>;
}

interface Waiver {
  category: string;
  field: string;
  reason: string;
}

interface DifferencesFile {
  waived: Waiver[];
}

type VectorResults = Record<string, Array<Record<string, unknown>>>;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function installReference(config: DifferentialConfig): void {
  rmSync(SCRATCH_DIR, { recursive: true, force: true });
  mkdirSync(SCRATCH_DIR, { recursive: true });

  const specs = [
    `@wraith-protocol/sdk@${config.referenceVersion}`,
    ...Object.entries(config.referencePeerDependencies).map(([name, range]) => `${name}@${range}`),
  ];

  console.log(`Installing reference @wraith-protocol/sdk@${config.referenceVersion}...`);
  execFileSync(
    'npm',
    ['install', '--prefix', SCRATCH_DIR, '--ignore-scripts', '--no-audit', '--no-fund', ...specs],
    { stdio: 'inherit' },
  );

  copyFileSync(RUNNER_SCRIPT, join(SCRATCH_DIR, 'differential-runner.mjs'));
}

function runVectorsThrough(runnerCwd: string): VectorResults {
  const runnerPath = join(runnerCwd, 'differential-runner.mjs');
  const stdout = execFileSync('node', [runnerPath, VECTORS_PATH], {
    cwd: runnerCwd,
    encoding: 'utf8',
  });
  return JSON.parse(stdout) as VectorResults;
}

interface Diff {
  category: string;
  index: number;
  field: string;
  reference: unknown;
  tip: unknown;
}

function diffResults(reference: VectorResults, tip: VectorResults): Diff[] {
  const diffs: Diff[] = [];
  for (const category of Object.keys(tip)) {
    const refEntries = reference[category] ?? [];
    const tipEntries = tip[category] ?? [];
    const length = Math.max(refEntries.length, tipEntries.length);

    for (let index = 0; index < length; index++) {
      const refEntry = refEntries[index] ?? {};
      const tipEntry = tipEntries[index] ?? {};
      const fields = new Set([...Object.keys(refEntry), ...Object.keys(tipEntry)]);

      for (const field of fields) {
        const refValue = refEntry[field];
        const tipValue = tipEntry[field];
        if (JSON.stringify(refValue) !== JSON.stringify(tipValue)) {
          diffs.push({ category, index, field, reference: refValue, tip: tipValue });
        }
      }
    }
  }
  return diffs;
}

function main(): void {
  const config = readJson<DifferentialConfig>(CONFIG_PATH);
  const differences = existsSync(DIFFERENCES_PATH)
    ? readJson<DifferencesFile>(DIFFERENCES_PATH)
    : { waived: [] };

  for (const waiver of differences.waived) {
    if (!waiver.reason || !waiver.reason.trim()) {
      console.error(
        `differences.json has a waiver for ${waiver.category}.${waiver.field} with no reason. Every waived difference must carry a comment explaining why it's safe.`,
      );
      process.exit(2);
    }
  }

  installReference(config);

  console.log('Running vectors through reference build...');
  const referenceResults = runVectorsThrough(SCRATCH_DIR);

  console.log('Running vectors through workspace tip...');
  const tipResults = runVectorsThrough(PACKAGE_ROOT);

  const diffs = diffResults(referenceResults, tipResults);

  const waivedDiffs: Diff[] = [];
  const unwaivedDiffs: Diff[] = [];
  for (const diff of diffs) {
    const waiver = differences.waived.find(
      (w) => w.category === diff.category && w.field === diff.field,
    );
    (waiver ? waivedDiffs : unwaivedDiffs).push(diff);
  }

  const usedWaivers = new Set(waivedDiffs.map((d) => `${d.category}.${d.field}`));
  const staleWaivers = differences.waived.filter(
    (w) => !usedWaivers.has(`${w.category}.${w.field}`),
  );

  console.log('');
  console.log(`Reference: @wraith-protocol/sdk@${config.referenceVersion}`);
  console.log(`Tip:       workspace build`);
  console.log(`Vectors compared: ${VECTORS_PATH}`);
  console.log(
    `Diffs found: ${diffs.length} (${waivedDiffs.length} waived, ${unwaivedDiffs.length} unwaived)`,
  );

  if (diffs.length > 0) {
    const byField = new Map<string, number>();
    for (const d of diffs) {
      const key = `${d.category}.${d.field}`;
      byField.set(key, (byField.get(key) ?? 0) + 1);
    }
    console.log('\nDiffs by category.field:');
    for (const [key, count] of [...byField.entries()].sort()) {
      console.log(`  - ${key}: ${count}`);
    }
  }

  if (waivedDiffs.length > 0) {
    console.log('\nWaived differences:');
    for (const w of differences.waived) {
      const count = waivedDiffs.filter(
        (d) => d.category === w.category && d.field === w.field,
      ).length;
      if (count > 0) {
        console.log(`  - ${w.category}.${w.field} (${count} vectors): ${w.reason}`);
      }
    }
  }

  if (staleWaivers.length > 0) {
    console.log('\nWarning: stale waivers in differences.json (no matching diff found):');
    for (const w of staleWaivers) {
      console.log(`  - ${w.category}.${w.field}`);
    }
  }

  if (unwaivedDiffs.length > 0) {
    console.log('\nUnwaived differences (this is a failure):');
    for (const d of unwaivedDiffs.slice(0, 20)) {
      console.log(
        `  - ${d.category}[${d.index}].${d.field}: reference=${JSON.stringify(d.reference)} tip=${JSON.stringify(d.tip)}`,
      );
    }
    if (unwaivedDiffs.length > 20) {
      console.log(`  ... and ${unwaivedDiffs.length - 20} more`);
    }
    console.log(
      '\nIf this diff is expected, add a { category, field, reason } entry to differences.json explaining why.',
    );
    process.exit(1);
  }

  console.log('\nDifferential harness passed.');
}

main();
