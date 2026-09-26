import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  CHECK_IDS,
  DOC_SECTIONS,
  beginMarker,
  checkRuntimeVersion,
  compatDocPath,
  detectRuntime,
  endMarker,
  loadEntrypoints,
  loadMatrix,
  loadPackage,
  optionalPeers,
  renderFormattedDoc,
  validateMatrix,
} from '../../scripts/compat/matrix.mjs';

const matrix = loadMatrix();
const pkg = loadPackage();
const entrypoints = loadEntrypoints();

const cloneMatrix = () => JSON.parse(JSON.stringify(matrix));

describe('compat/matrix.json', () => {
  test('is consistent with package.json and the published entry points', () => {
    expect(validateMatrix(matrix, pkg, entrypoints)).toEqual([]);
  });

  test('declares engines.node that package.json also declares', () => {
    expect(pkg.engines.node).toBe(matrix.engines.node);
  });

  test('every supported runtime points at a check the CLI implements', () => {
    const supported = matrix.runtimes.filter(
      (runtime: { status: string }) => runtime.status === 'supported',
    );
    expect(supported.length).toBeGreaterThan(0);
    for (const runtime of supported) {
      expect(CHECK_IDS).toContain(runtime.check);
    }
  });

  test('peer ranges match package.json exactly', () => {
    for (const peer of matrix.peers) {
      const declared =
        peer.kind === 'peer' ? pkg.peerDependencies[peer.name] : pkg.dependencies[peer.name];
      expect(declared).toBe(peer.range);
    }
  });

  test('no optional peer is required at import time by the package root', () => {
    for (const peer of optionalPeers(matrix)) {
      expect(peer.requiredAtImport ?? []).not.toContain('.');
    }
  });

  test('every unsupported combination documents a failure message', () => {
    expect(matrix.unsupported.length).toBeGreaterThan(0);
    for (const entry of matrix.unsupported) {
      expect(entry.combination.length).toBeGreaterThan(0);
      expect(entry.failure.length).toBeGreaterThan(0);
    }
  });
});

describe('validateMatrix', () => {
  test('reports drift between the matrix and engines.node', () => {
    const drifted = cloneMatrix();
    drifted.engines.node = '>=18';
    expect(validateMatrix(drifted, pkg, entrypoints)).toContainEqual(
      expect.stringContaining('engines.node differs'),
    );
  });

  test('reports a runtime version the declared minimum does not accept', () => {
    const drifted = cloneMatrix();
    const node = drifted.runtimes.find((runtime: { id: string }) => runtime.id === 'node');
    node.versions = '18.x, 20.x';
    expect(validateMatrix(drifted, pkg, entrypoints)).toContainEqual(
      expect.stringContaining('Node.js 18.x is listed as supported'),
    );
  });

  test('reports a tested peer version outside its declared range', () => {
    const drifted = cloneMatrix();
    drifted.peers[0].tested = ['12.0.0'];
    expect(validateMatrix(drifted, pkg, entrypoints)).toContainEqual(
      expect.stringContaining('does not satisfy its declared range'),
    );
  });

  test('reports an entry point that does not exist', () => {
    const drifted = cloneMatrix();
    drifted.peers[0].requiredAtImport = ['./chains/nope'];
    drifted.peers[0].requiredBy = ['./chains/nope'];
    expect(validateMatrix(drifted, pkg, entrypoints)).toContainEqual(
      expect.stringContaining('unknown entry point'),
    );
  });

  test('reports a supported runtime with no check', () => {
    const drifted = cloneMatrix();
    drifted.runtimes[0].check = null;
    expect(validateMatrix(drifted, pkg, entrypoints)).toContainEqual(
      expect.stringContaining('declares no check'),
    );
  });
});

describe('runtime detection', () => {
  test('identifies Node.js', () => {
    expect(detectRuntime()).toMatchObject({ id: 'node' });
  });

  test('accepts the running Node.js version', () => {
    expect(checkRuntimeVersion(matrix, detectRuntime())).toEqual({ supported: true, reason: null });
  });

  test('rejects a Node.js version below the declared minimum', () => {
    const verdict = checkRuntimeVersion(matrix, {
      id: 'node',
      name: 'Node.js',
      version: '18.20.4',
    });
    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain('>=20');
  });
});

describe('COMPAT.md', () => {
  test('declares every generated block', () => {
    const doc = readFileSync(compatDocPath, 'utf8');
    for (const section of DOC_SECTIONS) {
      expect(doc).toContain(beginMarker(section));
      expect(doc).toContain(endMarker(section));
    }
  });

  test('is in sync with compat/matrix.json', async () => {
    const doc = readFileSync(compatDocPath, 'utf8');
    await expect(renderFormattedDoc(doc, matrix)).resolves.toBe(doc);
  });
});
