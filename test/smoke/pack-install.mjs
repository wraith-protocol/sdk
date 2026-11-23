// Clean-fixture tarball installation smoke tests for `@wraith-protocol/sdk`.
//
// Packs the built core SDK into a real `.tgz` tarball and installs it in four
// isolated temporary fixtures outside the repository workspace:
//   - npm  + ESM ("type": "module")
//   - npm  + CJS ("type": "commonjs")
//   - pnpm + ESM ("type": "module")
//   - pnpm + CJS ("type": "commonjs")
//
// In every fixture it verifies:
//   1. Clean `npm install` / `pnpm install` of the packed tarball succeeds.
//   2. The installed dependency tree contains only intentional runtime
//      dependencies (`@noble/curves`, `@noble/hashes`, `viem` and their own
//      transitive runtime deps) — no self-dependency, no `pnpm`/`rg`/dev tools,
//      and no workspace links.
//   3. No runtime import or `require()` resolves through the repository
//      workspace tree (`realpathSync` of every loaded module stays inside the
//      clean fixture).
//   4. Published ESM and CJS entry points load and execute stealth crypto flows.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { entrypoints, packageName, repoRoot } = require('./exports.cjs');
const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const repoRootReal = realpathSync(repoRoot);

const INTENTIONAL_DIRECT_DEPS = ['@noble/curves', '@noble/hashes', 'viem'];
// Accidental runtime deps removed in #265 plus repo-only build/test tools and
// companion workspace packages that must never be pulled in by the core SDK.
// (`typescript` is omitted here because `viem` / `abitype` declares it as a
// peerDependency that npm >=7 may auto-install transitively; we separately
// assert `@wraith-protocol/sdk` itself declares only INTENTIONAL_DIRECT_DEPS.)
const FORBIDDEN_PACKAGES = new Set([
  'pnpm',
  'rg',
  'tsup',
  'vitest',
  'esbuild',
  'prettier',
  'husky',
  'size-limit',
  '@microsoft/api-extractor',
  '@wraith-protocol/sdk-agent',
  '@wraith-protocol/sdk-react',
  '@wraith-protocol/sdk-vue',
  '@wraith-protocol/sdk-solid',
  '@wraith-protocol/sdk-svelte',
  '@wraith-protocol/codemod',
  '@wraith-protocol/test-vectors',
]);

// `./chains/stellar` declares optional peer `@stellar/stellar-sdk` as required
// at import time (see compat/matrix.json). In a clean core-only install without
// optional peers, its subpath resolves inside the fixture and fails specifically
// when loading `@stellar/stellar-sdk`.
const PEER_REQUIRED_AT_IMPORT = new Map([['./chains/stellar', '@stellar/stellar-sdk']]);

let failed = 0;

function report(ok, label, detail) {
  if (ok) {
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

function firstLine(text) {
  return (
    String(text ?? '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? 'unknown error'
  );
}

function runTool(tool, args, cwd) {
  const isWin = process.platform === 'win32';
  const useCmd = isWin && tool === 'npm';
  const command = useCmd ? `${tool}.cmd` : tool;
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: useCmd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true' },
    maxBuffer: 50 * 1024 * 1024,
  });
}

function packCoreTarball(packDir) {
  const res = runTool('pnpm', ['pack', '--pack-destination', packDir], repoRoot);
  if (res.error || res.status !== 0) {
    throw new Error(
      `pnpm pack failed: ${firstLine(res.error?.message ?? res.stderr ?? res.stdout)}`,
    );
  }
  const filename = `${packageName.replace(/^@/, '').replace(/\//g, '-')}-${rootPkg.version}.tgz`;
  const tarball = join(packDir, filename);
  if (!existsSync(tarball)) {
    throw new Error(`packed tarball not found at ${tarball}`);
  }
  return tarball;
}

function collectInstalledNodeModulesNames(nodeModulesDir) {
  const names = new Set();
  if (!existsSync(nodeModulesDir)) return names;
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      const scopeDir = join(nodeModulesDir, entry.name);
      for (const child of readdirSync(scopeDir, { withFileTypes: true })) {
        if (!child.name.startsWith('.')) names.add(`${entry.name}/${child.name}`);
      }
    } else {
      names.add(entry.name);
    }
  }
  return names;
}

function collectTreePackagesFromNpm(treeNode, out = new Set(), isSdkRoot = false) {
  const deps = treeNode?.dependencies ?? {};
  const nestedSelf = [];
  for (const [name, child] of Object.entries(deps)) {
    if (isSdkRoot && name === packageName) nestedSelf.push(name);
    out.add(name);
    const subNested = collectTreePackagesFromNpm(child, out, name === packageName);
    nestedSelf.push(...subNested);
  }
  return nestedSelf;
}

function collectTreePackagesFromPnpm(nodes, out = new Set(), isSdkRoot = false) {
  const nestedSelf = [];
  for (const [name, child] of Object.entries(nodes ?? {})) {
    if (isSdkRoot && name === packageName) nestedSelf.push(name);
    out.add(name);
    nestedSelf.push(...collectTreePackagesFromPnpm(child?.dependencies, out, name === packageName));
  }
  return nestedSelf;
}

function verifyDependencyTree(manager, fixture, labelPrefix) {
  const installedSdkDir = join(fixture, 'node_modules', '@wraith-protocol', 'sdk');
  if (!existsSync(installedSdkDir)) {
    report(false, `${labelPrefix}: installed package directory`, 'missing from node_modules');
    return;
  }

  const fixtureReal = realpathSync(fixture);
  const sdkReal = realpathSync(installedSdkDir);
  report(
    sdkReal.startsWith(fixtureReal) && !sdkReal.startsWith(repoRootReal),
    `${labelPrefix}: package resolves inside clean fixture (no workspace symlink)`,
    `resolved to ${sdkReal}`,
  );

  const installedPkg = JSON.parse(readFileSync(join(installedSdkDir, 'package.json'), 'utf8'));
  const directDeps = Object.keys(installedPkg.dependencies ?? {}).sort();
  const expectedDirect = [...INTENTIONAL_DIRECT_DEPS].sort();
  report(
    JSON.stringify(directDeps) === JSON.stringify(expectedDirect),
    `${labelPrefix}: manifest declares only intentional runtime deps`,
    `got [${directDeps.join(', ')}]`,
  );

  const discovered = collectInstalledNodeModulesNames(join(fixture, 'node_modules'));
  let nestedSelf = [];

  if (manager === 'npm') {
    const ls = runTool('npm', ['ls', '--all', '--omit=dev', '--json'], fixture);
    let parsed;
    try {
      parsed = JSON.parse(ls.stdout || '{}');
    } catch (error) {
      report(false, `${labelPrefix}: npm ls tree parse`, firstLine(error.message));
      return;
    }
    const sdkNode = parsed?.dependencies?.[packageName];
    const sdkTreeDeps = Object.keys(sdkNode?.dependencies ?? {}).sort();
    report(
      expectedDirect.every((dep) => sdkTreeDeps.includes(dep) || discovered.has(dep)),
      `${labelPrefix}: intentional runtime deps resolved`,
      `sdk deps: [${sdkTreeDeps.join(', ')}]`,
    );
    nestedSelf = collectTreePackagesFromNpm(parsed, discovered, false);
  } else {
    const ls = runTool('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json'], fixture);
    if (ls.error || ls.status !== 0) {
      report(false, `${labelPrefix}: pnpm list`, firstLine(ls.error?.message ?? ls.stderr));
      return;
    }
    const [rootNode] = JSON.parse(ls.stdout || '[]');
    const sdkNode = rootNode?.dependencies?.[packageName];
    const sdkTreeDeps = Object.keys(sdkNode?.dependencies ?? {}).sort();
    report(
      JSON.stringify(sdkTreeDeps) === JSON.stringify(expectedDirect),
      `${labelPrefix}: pnpm resolved exact direct runtime deps`,
      `got [${sdkTreeDeps.join(', ')}]`,
    );
    nestedSelf = collectTreePackagesFromPnpm(rootNode?.dependencies, discovered, false);
  }

  report(
    nestedSelf.length === 0,
    `${labelPrefix}: no self-dependency in dependency tree`,
    nestedSelf.join(', '),
  );

  const forbiddenFound = [...discovered].filter((pkg) => FORBIDDEN_PACKAGES.has(pkg)).sort();
  report(
    forbiddenFound.length === 0,
    `${labelPrefix}: no accidental build/dev or companion packages in tree`,
    `found [${forbiddenFound.join(', ')}]`,
  );
}

function buildEsmProbeSource() {
  const specs = entrypoints.map((ep) => ({
    subpath: ep.subpath,
    specifier: ep.specifier,
    peerRequired: PEER_REQUIRED_AT_IMPORT.get(ep.subpath) ?? null,
  }));

  return `import { realpathSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const fixtureReal = realpathSync(process.argv[2]);
const repoRootReal = realpathSync(process.argv[3]);
const specs = ${JSON.stringify(specs)};
const directDeps = ['@noble/curves/secp256k1', '@noble/curves/ed25519', '@noble/hashes/sha256', 'viem'];

if (typeof Module.register === 'function') {
  const hookCode = \`
    import { realpathSync } from 'node:fs';
    import { fileURLToPath } from 'node:url';
    const fixtureReal = \${JSON.stringify(fixtureReal)};
    const repoRootReal = \${JSON.stringify(repoRootReal)};
    export async function load(url, context, nextLoad) {
      if (url.startsWith('file://')) {
        const real = realpathSync(fileURLToPath(url));
        if (real.startsWith(repoRootReal) || !real.startsWith(fixtureReal)) {
          throw new Error('Workspace leak in ESM load: ' + real);
        }
      }
      return nextLoad(url, context);
    }
  \`;
  Module.register('data:text/javascript;charset=utf-8,' + encodeURIComponent(hookCode));
}

function assertPathInsideFixture(filePath, label) {
  const real = realpathSync(filePath);
  if (real.startsWith(repoRootReal) || !real.startsWith(fixtureReal)) {
    throw new Error(\`\${label} resolved outside clean fixture: \${real}\`);
  }
}

function assertInsideFixture(fileUrl, label) {
  assertPathInsideFixture(fileURLToPath(fileUrl), label);
}

const sdkEntryUrl = import.meta.resolve('@wraith-protocol/sdk');
assertInsideFixture(sdkEntryUrl, '@wraith-protocol/sdk');
const sdkRequire = createRequire(sdkEntryUrl);
for (const dep of directDeps) {
  assertPathInsideFixture(sdkRequire.resolve(dep), dep);
}

for (const ep of specs) {
  assertInsideFixture(import.meta.resolve(ep.specifier), ep.specifier);
  if (ep.peerRequired) {
    let threw = false;
    try {
      await import(ep.specifier);
    } catch (err) {
      threw = true;
      const msg = String(err?.message ?? err);
      if (!msg.includes(ep.peerRequired)) {
        throw new Error(\`\${ep.specifier} failed with unexpected error: \${msg}\`);
      }
    }
    if (!threw) {
      throw new Error(\`\${ep.specifier} unexpectedly resolved optional peer \${ep.peerRequired} from workspace\`);
    }
    continue;
  }

  const mod = await import(ep.specifier);
  if (Object.keys(mod).length === 0) {
    throw new Error(\`\${ep.specifier} exposed zero exports\`);
  }
}

const sigHex = '0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b';
const sigBytes = new Uint8Array(64).fill(0xaa);

const evm = await import('@wraith-protocol/sdk/chains/evm');
const evmKeys = evm.deriveStealthKeys(sigHex);
const evmMeta = evm.encodeStealthMetaAddress(evmKeys.spendingPubKey, evmKeys.viewingPubKey);
const evmDecoded = evm.decodeStealthMetaAddress(evmMeta);
const evmStealth = evm.generateStealthAddress(evmDecoded.spendingPubKey, evmDecoded.viewingPubKey);
if (!evmStealth.stealthAddress) throw new Error('EVM stealthAddress missing');

const sol = await import('@wraith-protocol/sdk/chains/solana');
const solKeys = sol.deriveStealthKeys(sigBytes);
const solMeta = sol.encodeStealthMetaAddress(solKeys.spendingPubKey, solKeys.viewingPubKey);
const solDecoded = sol.decodeStealthMetaAddress(solMeta);
const solStealth = sol.generateStealthAddress(solDecoded.spendingPubKey, solDecoded.viewingPubKey);
if (!solStealth.stealthAddress) throw new Error('Solana stealthAddress missing');

const ckb = await import('@wraith-protocol/sdk/chains/ckb');
const ckbKeys = ckb.deriveStealthKeys(sigHex);
const ckbMeta = ckb.encodeStealthMetaAddress(ckbKeys.spendingPubKey, ckbKeys.viewingPubKey);
const ckbDecoded = ckb.decodeStealthMetaAddress(ckbMeta);
const ckbStealth = ckb.generateStealthAddress(ckbDecoded.spendingPubKey, ckbDecoded.viewingPubKey);
if (!ckbStealth.lockArgs) throw new Error('CKB lockArgs missing');
`;
}

function buildCjsProbeSource() {
  const specs = entrypoints.map((ep) => ({
    subpath: ep.subpath,
    specifier: ep.specifier,
    peerRequired: PEER_REQUIRED_AT_IMPORT.get(ep.subpath) ?? null,
  }));

  return `'use strict';
const { realpathSync } = require('node:fs');
const Module = require('node:module');
const { isBuiltin } = Module;

const fixtureReal = realpathSync(process.argv[2]);
const repoRootReal = realpathSync(process.argv[3]);
const specs = ${JSON.stringify(specs)};
const directDeps = ['@noble/curves/secp256k1', '@noble/curves/ed25519', '@noble/hashes/sha256', 'viem'];

const resolvedFiles = new Set();
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
  if (!isBuiltin(resolved)) {
    resolvedFiles.add(resolved);
  }
  return resolved;
};

function assertPathInsideFixture(filePath, label) {
  const real = realpathSync(filePath);
  if (real.startsWith(repoRootReal) || !real.startsWith(fixtureReal)) {
    throw new Error(label + ' resolved outside clean fixture: ' + real);
  }
}

const sdkEntryPath = require.resolve('@wraith-protocol/sdk');
assertPathInsideFixture(sdkEntryPath, '@wraith-protocol/sdk');
const sdkRequire = Module.createRequire(sdkEntryPath);
for (const dep of directDeps) {
  assertPathInsideFixture(sdkRequire.resolve(dep), dep);
}

for (const ep of specs) {
  assertPathInsideFixture(require.resolve(ep.specifier), ep.specifier);
  if (ep.peerRequired) {
    let threw = false;
    try {
      require(ep.specifier);
    } catch (err) {
      threw = true;
      const msg = String((err && err.message) || err);
      if (!msg.includes(ep.peerRequired)) {
        throw new Error(ep.specifier + ' failed with unexpected error: ' + msg);
      }
    }
    if (!threw) {
      throw new Error(ep.specifier + ' unexpectedly resolved optional peer ' + ep.peerRequired + ' from workspace');
    }
    continue;
  }

  const mod = require(ep.specifier);
  if (Object.keys(mod).length === 0) {
    throw new Error(ep.specifier + ' exposed zero exports');
  }
}

const sigHex = '0x' + 'aa'.repeat(32) + 'bb'.repeat(32) + '1b';
const sigBytes = new Uint8Array(64).fill(0xaa);

const evm = require('@wraith-protocol/sdk/chains/evm');
const evmKeys = evm.deriveStealthKeys(sigHex);
const evmMeta = evm.encodeStealthMetaAddress(evmKeys.spendingPubKey, evmKeys.viewingPubKey);
const evmDecoded = evm.decodeStealthMetaAddress(evmMeta);
const evmStealth = evm.generateStealthAddress(evmDecoded.spendingPubKey, evmDecoded.viewingPubKey);
if (!evmStealth.stealthAddress) throw new Error('EVM stealthAddress missing');

const sol = require('@wraith-protocol/sdk/chains/solana');
const solKeys = sol.deriveStealthKeys(sigBytes);
const solMeta = sol.encodeStealthMetaAddress(solKeys.spendingPubKey, solKeys.viewingPubKey);
const solDecoded = sol.decodeStealthMetaAddress(solMeta);
const solStealth = sol.generateStealthAddress(solDecoded.spendingPubKey, solDecoded.viewingPubKey);
if (!solStealth.stealthAddress) throw new Error('Solana stealthAddress missing');

const ckb = require('@wraith-protocol/sdk/chains/ckb');
const ckbKeys = ckb.deriveStealthKeys(sigHex);
const ckbMeta = ckb.encodeStealthMetaAddress(ckbKeys.spendingPubKey, ckbKeys.viewingPubKey);
const ckbDecoded = ckb.decodeStealthMetaAddress(ckbMeta);
const ckbStealth = ckb.generateStealthAddress(ckbDecoded.spendingPubKey, ckbDecoded.viewingPubKey);
if (!ckbStealth.lockArgs) throw new Error('CKB lockArgs missing');

for (const filePath of [...resolvedFiles, ...Object.keys(require.cache)]) {
  assertPathInsideFixture(filePath, 'CJS runtime module');
}
`;
}

function runCleanFixture({ manager, format, tarball }) {
  const labelPrefix = `${manager} ${format.toUpperCase()} fixture`;
  const fixture = mkdtempSync(join(tmpdir(), `wraith-core-${manager}-${format}-`));
  try {
    const tarballSpec = `file:${tarball.replace(/\\/g, '/')}`;
    const manifest = {
      name: `wraith-core-smoke-${manager}-${format}`,
      version: '0.0.0',
      private: true,
      type: format === 'esm' ? 'module' : 'commonjs',
      dependencies: {
        [packageName]: tarballSpec,
      },
    };
    writeFileSync(join(fixture, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');

    let installResult;
    if (manager === 'npm') {
      installResult = runTool(
        'npm',
        ['install', '--prefer-offline', '--no-audit', '--no-fund', '--ignore-scripts'],
        fixture,
      );
    } else {
      // Disable peer auto-install and workspace linking so pnpm treats this
      // temp directory as a standalone consumer project.
      writeFileSync(
        join(fixture, '.npmrc'),
        'auto-install-peers=false\nlink-workspace-packages=false\n',
      );
      installResult = runTool(
        'pnpm',
        ['install', '--prefer-offline', '--no-lockfile', '--ignore-scripts'],
        fixture,
      );
    }

    if (installResult.error || installResult.status !== 0) {
      report(
        false,
        `${labelPrefix}: install`,
        firstLine(installResult.error?.message ?? installResult.stderr ?? installResult.stdout),
      );
      return;
    }
    report(true, `${labelPrefix}: install succeeded`);

    verifyDependencyTree(manager, fixture, labelPrefix);

    const probeFile = join(fixture, format === 'esm' ? 'probe.mjs' : 'probe.cjs');
    writeFileSync(probeFile, format === 'esm' ? buildEsmProbeSource() : buildCjsProbeSource());
    const probe = spawnSync(process.execPath, [probeFile, fixture, repoRoot], {
      cwd: fixture,
      encoding: 'utf8',
    });
    report(
      !probe.error && probe.status === 0,
      `${labelPrefix}: all subpaths + crypto resolve without workspace links`,
      probe.status === 0 ? undefined : firstLine(probe.stderr || probe.stdout || probe.error),
    );
  } finally {
    try {
      rmSync(fixture, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup on Windows file locks.
    }
  }
}

const packDir = mkdtempSync(join(tmpdir(), 'wraith-core-pack-'));
try {
  const tarball = packCoreTarball(packDir);
  report(true, 'packed core SDK tarball');

  for (const manager of ['npm', 'pnpm']) {
    for (const format of ['esm', 'cjs']) {
      runCleanFixture({ manager, format, tarball });
    }
  }
} catch (error) {
  report(false, 'pack core SDK tarball', firstLine(error instanceof Error ? error.message : error));
} finally {
  rmSync(packDir, { recursive: true, force: true });
}

process.exit(failed === 0 ? 0 : 1);
