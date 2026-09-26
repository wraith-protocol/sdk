// Shared helpers for the supported runtime and peer dependency matrix.
//
// `compat/matrix.json` is the single source of truth for the runtimes this
// package claims to support and for the dependency ranges it accepts. The
// compat CLI in this directory validates that file against `package.json`,
// against the rendered `COMPAT.md`, and against the built package, so the
// published matrix cannot silently drift from the code that ships.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const require = createRequire(import.meta.url);

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const matrixPath = join(repoRoot, 'compat', 'matrix.json');
export const compatDocPath = join(repoRoot, 'COMPAT.md');

/** Check ids that `verify-runtime.mjs` knows how to execute. */
export const CHECK_IDS = ['node', 'bun', 'browser', 'react-native'];

/** Allowed values for a runtime's `status` field. */
export const STATUSES = ['supported', 'partial', 'untested'];

/** Marker names for the generated blocks inside COMPAT.md. */
export const DOC_SECTIONS = ['runtimes', 'peers', 'unsupported'];

export function loadMatrix() {
  return JSON.parse(readFileSync(matrixPath, 'utf8'));
}

export function loadPackage() {
  return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
}

/** Published entry points, derived from `package.json` `exports`. */
export function loadEntrypoints() {
  return require('../../test/smoke/exports.cjs').entrypoints;
}

/**
 * Validates the matrix against `package.json` and the published entry points.
 *
 * @returns {string[]} Human-readable problems; empty when the matrix is consistent.
 */
export function validateMatrix(matrix, pkg, entrypoints) {
  const problems = [];
  const subpaths = new Set(entrypoints.map((entry) => entry.subpath));

  if (matrix.package !== pkg.name) {
    problems.push(`matrix.package is "${matrix.package}" but package.json name is "${pkg.name}"`);
  }

  const enginesNode = pkg.engines?.node;
  const matrixNode = matrix.engines?.node;
  if (!enginesNode) {
    problems.push(
      `package.json has no "engines.node" but the matrix declares "${matrixNode ?? '(none)'}"`,
    );
  } else if (enginesNode !== matrixNode) {
    problems.push(
      `engines.node differs: matrix "${matrixNode ?? '(none)'}" vs package.json "${enginesNode}"`,
    );
  }
  if (matrixNode && !semver.validRange(matrixNode)) {
    problems.push(`engines.node "${matrixNode}" is not a valid semver range`);
  }

  const seenRuntimes = new Set();
  for (const runtime of matrix.runtimes ?? []) {
    const where = `runtime "${runtime.id}"`;
    if (seenRuntimes.has(runtime.id)) problems.push(`${where} is listed twice`);
    seenRuntimes.add(runtime.id);

    if (!STATUSES.includes(runtime.status)) {
      problems.push(`${where} has unknown status "${runtime.status}"`);
    }
    if (runtime.status === 'supported' && !runtime.check) {
      problems.push(`${where} is "supported" but declares no check`);
    }
    if (runtime.check && !CHECK_IDS.includes(runtime.check)) {
      problems.push(`${where} references unknown check "${runtime.check}"`);
    }
    if (runtime.minimumRange && !semver.validRange(runtime.minimumRange)) {
      problems.push(`${where} has an invalid minimumRange "${runtime.minimumRange}"`);
    }
    if (!runtime.notes) problems.push(`${where} has no notes`);

    if (runtime.id === 'node' && runtime.minimumRange) {
      if (matrixNode && runtime.minimumRange !== matrixNode) {
        problems.push(
          `Node.js minimumRange "${runtime.minimumRange}" differs from engines.node "${matrixNode}"`,
        );
      }
      for (const match of String(runtime.versions).matchAll(/(\d+)\.x/g)) {
        const probe = `${match[1]}.0.0`;
        if (!semver.satisfies(probe, runtime.minimumRange)) {
          problems.push(
            `Node.js ${match[1]}.x is listed as supported but ${probe} does not satisfy "${runtime.minimumRange}"`,
          );
        }
      }
    }
  }

  const seenPeers = new Set();
  for (const peer of matrix.peers ?? []) {
    const where = `peer "${peer.name}"`;
    if (seenPeers.has(peer.name)) problems.push(`${where} is listed twice`);
    seenPeers.add(peer.name);

    if (!semver.validRange(peer.range)) {
      problems.push(`${where} has an invalid range "${peer.range}"`);
    }
    if (!Array.isArray(peer.tested) || peer.tested.length === 0) {
      problems.push(`${where} lists no tested version`);
    }
    for (const version of peer.tested ?? []) {
      if (!semver.valid(version)) {
        problems.push(`${where} lists an invalid tested version "${version}"`);
      } else if (semver.validRange(peer.range) && !semver.satisfies(version, peer.range)) {
        problems.push(
          `${where} tested ${version} does not satisfy its declared range ${peer.range}`,
        );
      }
    }

    if (peer.kind === 'peer') {
      const declared = pkg.peerDependencies?.[peer.name];
      if (!declared) {
        problems.push(`${where} is not in package.json peerDependencies`);
      } else if (declared !== peer.range) {
        problems.push(`${where} range "${peer.range}" != peerDependencies "${declared}"`);
      }
      const optional = Boolean(pkg.peerDependenciesMeta?.[peer.name]?.optional);
      if (optional !== Boolean(peer.optional)) {
        problems.push(
          `${where} optional=${Boolean(peer.optional)} but peerDependenciesMeta says ${optional}`,
        );
      }
    } else if (peer.kind === 'dependency') {
      const declared = pkg.dependencies?.[peer.name];
      if (!declared) {
        problems.push(`${where} is not in package.json dependencies`);
      } else if (declared !== peer.range) {
        problems.push(`${where} range "${peer.range}" != dependencies "${declared}"`);
      }
      if (peer.optional) problems.push(`${where} is a dependency but the matrix marks it optional`);
    } else {
      problems.push(`${where} has unknown kind "${peer.kind}"`);
    }

    const requiredBy = peer.requiredBy ?? [];
    for (const subpath of requiredBy) {
      if (!subpaths.has(subpath))
        problems.push(`${where} references unknown entry point "${subpath}"`);
    }
    for (const subpath of peer.requiredAtImport ?? []) {
      if (!subpaths.has(subpath)) {
        problems.push(`${where} references unknown entry point "${subpath}"`);
      } else if (!requiredBy.includes(subpath)) {
        problems.push(
          `${where} requires "${subpath}" at import time but does not list it in requiredBy`,
        );
      }
    }
  }

  for (const entry of matrix.unsupported ?? []) {
    if (!entry.combination || !entry.failure) {
      problems.push('every "unsupported" entry needs both "combination" and "failure"');
    }
  }

  return problems;
}

/** Optional peers that the built package may need when an entry point is imported. */
export function optionalPeers(matrix) {
  return (matrix.peers ?? []).filter((peer) => peer.kind === 'peer' && peer.optional);
}

/** Runtime ids the matrix marks as supported. */
export function supportedRuntimeIds(matrix) {
  return (matrix.runtimes ?? [])
    .filter((runtime) => runtime.status === 'supported')
    .map((r) => r.id);
}

/**
 * Identifies the runtime executing this process.
 *
 * @returns {{ id: string, name: string, version: string }}
 */
export function detectRuntime() {
  const g = globalThis;
  if (g.Bun?.version) return { id: 'bun', name: 'Bun', version: g.Bun.version };
  if (g.Deno?.version?.deno) return { id: 'deno', name: 'Deno', version: g.Deno.version.deno };
  if (g.navigator?.product === 'ReactNative') {
    return {
      id: 'react-native',
      name: 'React Native',
      version: g.navigator.appVersion ?? 'unknown',
    };
  }
  if (typeof g.window !== 'undefined' && typeof g.document !== 'undefined') {
    return { id: 'browser', name: 'Browser', version: g.navigator?.userAgent ?? 'unknown' };
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    return { id: 'node', name: 'Node.js', version: process.versions.node };
  }
  return { id: 'unknown', name: 'Unknown runtime', version: 'unknown' };
}

/**
 * Decides whether a detected runtime version is inside the matrix.
 *
 * @returns {{ supported: boolean, reason: string | null }}
 */
export function checkRuntimeVersion(matrix, runtime) {
  const entry = (matrix.runtimes ?? []).find((candidate) => candidate.id === runtime.id);
  if (!entry) return { supported: false, reason: `runtime "${runtime.id}" is not in the matrix` };
  if (entry.status !== 'supported') {
    return { supported: false, reason: `"${entry.name}" is documented as ${entry.status}` };
  }
  if (!entry.minimumRange) return { supported: true, reason: null };
  if (!semver.valid(runtime.version)) return { supported: true, reason: null };
  if (semver.satisfies(runtime.version, entry.minimumRange))
    return { supported: true, reason: null };
  return {
    supported: false,
    reason: `@wraith-protocol/sdk requires ${entry.name} ${entry.minimumRange}`,
  };
}

/** The message printed when an unsupported runtime tries to run the compat checks. */
export function unsupportedRuntimeMessage(pkg, runtime, reason) {
  return (
    `Unsupported runtime: ${runtime.name} ${runtime.version}. ${reason}. ` +
    `See ${pkg.name} package.json "engines" and COMPAT.md for the supported matrix.`
  );
}

// ---------------------------------------------------------------------------
// COMPAT.md rendering
// ---------------------------------------------------------------------------

const TITLE_CASE = { supported: 'Supported', partial: 'Partial', untested: 'Untested' };

function runtimeCoverage(matrix, runtime) {
  if (!runtime.check) return 'Not covered by the compat job';
  if (runtime.check === 'node' || runtime.check === 'bun') {
    return '`pnpm test:compat` in the `compat` CI job';
  }
  if (runtime.check === 'browser') return '`pnpm test:compat` browser bundle check';
  if (runtime.check === 'react-native') return '`pnpm test:compat` React Native check';
  return runtime.check;
}

export function renderRuntimes(matrix) {
  const lines = [
    '| Runtime | Tested versions | Status | Covered by |',
    '| --- | --- | --- | --- |',
  ];
  for (const runtime of matrix.runtimes ?? []) {
    lines.push(
      `| ${runtime.name} | ${runtime.versions} | ${TITLE_CASE[runtime.status] ?? runtime.status} | ${runtimeCoverage(matrix, runtime)} |`,
    );
  }
  lines.push('', '**Notes**', '');
  for (const runtime of matrix.runtimes ?? []) {
    lines.push(`- **${runtime.name}** — ${runtime.notes}`);
  }
  return lines.join('\n');
}

export function renderPeers(matrix) {
  const lines = [
    '| Package | Kind | Supported range | Optional | Required by | Tested version |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const peer of matrix.peers ?? []) {
    lines.push(
      `| \`${peer.name}\` | ${peer.kind} | \`${peer.range}\` | ${peer.optional ? 'yes' : 'no'} | ${(
        peer.requiredBy ?? []
      )
        .map((subpath) => `\`${subpath}\``)
        .join(', ')} | ${(peer.tested ?? []).map((version) => `\`${version}\``).join(', ')} |`,
    );
  }
  lines.push('', '**Notes**', '');
  for (const peer of matrix.peers ?? []) {
    lines.push(`- **\`${peer.name}\`** — ${peer.notes}`);
  }
  return lines.join('\n');
}

export function renderUnsupported(matrix) {
  const lines = [];
  for (const entry of matrix.unsupported ?? []) {
    lines.push(`#### ${entry.combination}`, '', '```', entry.failure, '```', '');
  }
  return lines.join('\n').trimEnd();
}

export function renderSection(matrix, section) {
  if (section === 'runtimes') return renderRuntimes(matrix);
  if (section === 'peers') return renderPeers(matrix);
  if (section === 'unsupported') return renderUnsupported(matrix);
  throw new Error(`Unknown COMPAT.md section "${section}"`);
}

export function beginMarker(section) {
  return `<!-- compat:${section}:begin -->`;
}

export function endMarker(section) {
  return `<!-- compat:${section}:end -->`;
}

/**
 * Renders COMPAT.md and formats it the way Prettier formats it, so
 * `pnpm compat:doc` and `pnpm format:check` agree on the committed file.
 */
export async function renderFormattedDoc(currentDoc, matrix) {
  // Imported lazily so the runtime checks, which never render the doc, do not
  // need to load Prettier.
  const { default: prettier } = await import('prettier');
  const rendered = renderDoc(currentDoc, matrix);
  const config = (await prettier.resolveConfig(compatDocPath)) ?? {};
  return prettier.format(rendered, { ...config, parser: 'markdown' });
}

/** Replaces the generated block for a section, preserving the surrounding prose. */
export function renderDoc(currentDoc, matrix) {
  let doc = currentDoc;
  for (const section of DOC_SECTIONS) {
    const begin = beginMarker(section);
    const end = endMarker(section);
    const start = doc.indexOf(begin);
    const stop = doc.indexOf(end);
    if (start === -1 || stop === -1 || stop < start) {
      throw new Error(`COMPAT.md is missing the "${section}" block (${begin} ... ${end})`);
    }
    const body = `\n${renderSection(matrix, section)}\n`;
    doc = `${doc.slice(0, start + begin.length)}\n${body}${doc.slice(stop)}`;
  }
  return doc;
}
