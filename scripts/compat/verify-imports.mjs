// Representative import checks for the runtime executing this process.
//
// The check detects the runtime, refuses to continue with the documented
// message when it is outside the supported matrix, then imports every published
// entry point and drives one representative operation per chain module so a
// runtime that cannot execute the crypto fails here rather than in a consumer's
// app. It also confirms the peer dependency versions installed in this
// workspace satisfy the ranges the matrix publishes.
//
// Modes:
//   --mode=auto          (default) the detected runtime
//   --mode=react-native  simulate a Hermes-style React Native global scope
//                        (no atob/btoa/TextEncoder/TextDecoder), install the
//                        package polyfills, then run the same checks

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkRuntimeVersion,
  detectRuntime,
  loadEntrypoints,
  loadMatrix,
  loadPackage,
  optionalPeers,
  repoRoot,
  unsupportedRuntimeMessage,
} from './matrix.mjs';
import semver from 'semver';

const mode = (process.argv.find((arg) => arg.startsWith('--mode=')) ?? '--mode=auto').split('=')[1];

const SIGNATURE_HEX = `0x${'aa'.repeat(32)}${'bb'.repeat(32)}1b`;
const SIGNATURE_BYTES = new Uint8Array(64).fill(0xaa);

const matrix = loadMatrix();
const pkg = loadPackage();
const entrypoints = loadEntrypoints();

let failed = 0;

function report(ok, label, detail) {
  if (ok) {
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

function fn(mod, name) {
  if (typeof mod[name] !== 'function') throw new Error(`"${name}" is not exported as a function`);
}

/** Derive keys, round-trip a meta-address, and generate a stealth address. */
function runChainFlow(mod, signature) {
  const keys = mod.deriveStealthKeys(signature);
  const metaAddress = mod.encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
  const decoded = mod.decodeStealthMetaAddress(metaAddress);
  const stealth = mod.generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
  if (!stealth?.stealthAddress) {
    throw new Error('generateStealthAddress returned no stealthAddress');
  }
  return stealth.stealthAddress;
}

/** CKB has no account address: the generated result is a 53-byte lock script arg. */
function runCkbFlow(mod) {
  const keys = mod.deriveStealthKeys(SIGNATURE_HEX);
  const metaAddress = mod.encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
  const decoded = mod.decodeStealthMetaAddress(metaAddress);
  const stealth = mod.generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
  if (typeof stealth?.lockArgs !== 'string' || stealth.lockArgs.length !== 2 + 53 * 2) {
    throw new Error(`generateStealthAddress returned unexpected lockArgs: ${stealth?.lockArgs}`);
  }
  return `${(stealth.lockArgs.length - 2) / 2}-byte lock args`;
}

const ENTRY_CHECKS = {
  './': (mod) => {
    for (const name of ['scanAll', 'setTracer', 'getTracer', 'installReactNativePolyfills']) {
      fn(mod, name);
    }
  },
  './vault': (mod) => fn(mod, 'KeyVault'),
  './compat/react-native': (mod) => fn(mod, 'installReactNativePolyfills'),
  './chains/evm': (mod) => runChainFlow(mod, SIGNATURE_HEX),
  './chains/ckb': (mod) => runCkbFlow(mod),
  './chains/stellar': (mod) => runChainFlow(mod, SIGNATURE_BYTES),
  './chains/solana': (mod) => runChainFlow(mod, SIGNATURE_BYTES),
};

/** Reads a package version straight off disk, without going through `exports`. */
function installedVersion(name) {
  try {
    const manifest = join(repoRoot, 'node_modules', name, 'package.json');
    return JSON.parse(readFileSync(manifest, 'utf8')).version;
  } catch {
    return null;
  }
}

async function main() {
  const detected =
    mode === 'react-native'
      ? { id: 'react-native', name: 'React Native', version: process.versions.node }
      : detectRuntime();

  const verdict = checkRuntimeVersion(matrix, detected);
  if (!verdict.supported) {
    console.error(unsupportedRuntimeMessage(pkg, detected, verdict.reason));
    process.exit(1);
  }
  console.log(`ok   runtime ${detected.name} ${detected.version} (${mode})`);

  if (mode === 'react-native') {
    // Hermes does not provide these globals; a React Native app supplies
    // `react-native-get-random-values` and the package's polyfill helper.
    for (const key of ['atob', 'btoa', 'TextEncoder', 'TextDecoder']) {
      delete globalThis[key];
    }
    const { installReactNativePolyfills } = await import(
      new URL(`file://${join(repoRoot, 'dist', 'compat', 'react-native.js')}`)
    );
    installReactNativePolyfills();
    for (const key of ['atob', 'btoa', 'TextEncoder', 'TextDecoder']) {
      if (typeof globalThis[key] === 'undefined') {
        report(false, `polyfill ${key}`, 'installReactNativePolyfills() did not install it');
      }
    }
  }

  for (const entry of entrypoints) {
    const label = `import ${entry.subpath} (${detected.name})`;
    try {
      const mod = await import(new URL(`file://${entry.import}`));
      if (Object.keys(mod).length === 0) throw new Error('module resolved but has no exports');
      const check = ENTRY_CHECKS[entry.subpath];
      const detail = check ? check(mod) : undefined;
      report(true, detail ? `${label} -> ${detail}` : label);
    } catch (error) {
      report(false, label, error instanceof Error ? error.message : String(error));
    }
  }

  for (const peer of matrix.peers) {
    const version = installedVersion(peer.name);
    const label = `peer range ${peer.name}@${peer.range}`;
    if (!version) {
      // An absent optional peer is fine — the entry point that needs it is
      // covered by the optional-peer isolation check in verify-package.mjs.
      console.log(`skip ${label} (not installed in this workspace)`);
    } else {
      report(
        semver.satisfies(version, peer.range),
        `${label} accepts installed ${version}`,
        `${version} does not satisfy ${peer.range}`,
      );
    }
  }

  // Surface how many optional peers this workspace actually ships so the
  // log makes the isolation check meaningful.
  const optional = optionalPeers(matrix);
  if (optional.length > 0) {
    console.log(`info optional peers declared: ${optional.map((peer) => peer.name).join(', ')}`);
  }
}

await main();
process.exit(failed === 0 ? 0 : 1);
