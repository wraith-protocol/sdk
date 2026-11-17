// Shared edge-runtime cryptographic and cancellation smoke suite.
//
// Imported by the Cloudflare Workers, Deno, Bun, and standards-only browser
// worker fixtures. Imports ONLY documented `@wraith-protocol/sdk` package
// subpaths and relies exclusively on WinterCG / Web-standard globals
// (`crypto.getRandomValues`, `crypto.subtle`, `TextEncoder`, `TextDecoder`,
// `AbortController`, `AbortSignal`, `DOMException`, `setTimeout`).

import {
  InvalidMetaAddressError,
  RPCAbortedError,
  UnsupportedCapabilityError,
  WraithError,
  WraithRuntimeError,
  isAbortError,
  scanAll,
} from '@wraith-protocol/sdk';
import * as ckb from '@wraith-protocol/sdk/chains/ckb';
import * as evm from '@wraith-protocol/sdk/chains/evm';
import * as solana from '@wraith-protocol/sdk/chains/solana';
import { installReactNativePolyfills } from '@wraith-protocol/sdk/compat/react-native';
import { KeyVault } from '@wraith-protocol/sdk/vault';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Edge smoke assertion failed: ${message}`);
  }
}

function assertTypedUnsupportedError(error, expectedCapability, contextLabel) {
  assert(
    error instanceof UnsupportedCapabilityError,
    `${contextLabel}: expected UnsupportedCapabilityError, got ${error?.constructor?.name ?? typeof error} (${error?.message ?? error})`,
  );
  assert(
    error instanceof WraithRuntimeError,
    `${contextLabel}: expected instanceof WraithRuntimeError`,
  );
  assert(error instanceof WraithError, `${contextLabel}: expected instanceof WraithError`);
  assert(
    error.code === 'WRAITH/RUNTIME/UNSUPPORTED_CAPABILITY',
    `${contextLabel}: unexpected code ${error.code}`,
  );
  assert(
    error.capability === expectedCapability,
    `${contextLabel}: expected capability "${expectedCapability}", got "${error.capability}"`,
  );
  const guidance = error.describe();
  assert(
    typeof guidance === 'string' && guidance.includes('Try:') && guidance.includes(error.docsLink),
    `${contextLabel}: describe() is not actionable: ${guidance}`,
  );
}

export async function runEdgeSmokeSuite(runtimeName) {
  // 1. Verify no Node `Buffer` global/polyfill is present, no `process` global
  //    exists in pure WinterCG/edge isolates, and Web-standard globals exist.
  assert(typeof globalThis.Buffer === 'undefined', `${runtimeName} exposed Node Buffer global`);
  if (runtimeName !== 'bun') {
    assert(typeof globalThis.process === 'undefined', `${runtimeName} exposed Node process global`);
  }
  assert(
    typeof globalThis.crypto?.getRandomValues === 'function',
    `${runtimeName} missing Web Crypto getRandomValues`,
  );
  assert(
    typeof globalThis.crypto?.subtle === 'object' && globalThis.crypto.subtle !== null,
    `${runtimeName} missing Web Crypto subtle`,
  );
  assert(
    typeof globalThis.AbortController === 'function',
    `${runtimeName} missing AbortController`,
  );
  assert(typeof globalThis.TextEncoder === 'function', `${runtimeName} missing TextEncoder`);
  assert(typeof globalThis.TextDecoder === 'function', `${runtimeName} missing TextDecoder`);
  assert(
    typeof installReactNativePolyfills === 'function',
    'missing installReactNativePolyfills export',
  );

  // 2. Key derivation + random ephemeral key generation (via Web Crypto RNG).
  const sigHex = `0x${'ab'.repeat(32)}${'cd'.repeat(32)}1b`;
  const sigBytes = new Uint8Array(64);
  globalThis.crypto.getRandomValues(sigBytes);

  const evmKeys = evm.deriveStealthKeys(sigHex);
  const solKeys = solana.deriveStealthKeys(sigBytes);
  const ckbKeys = ckb.deriveStealthKeys(sigHex);

  // 3. Meta-address encoding, parsing, and typed rejection on malformed input.
  const evmMeta = evm.encodeStealthMetaAddress(evmKeys.spendingPubKey, evmKeys.viewingPubKey);
  const evmParsed = evm.decodeStealthMetaAddress(evmMeta);
  assert(
    evmParsed.spendingPubKey === evmKeys.spendingPubKey,
    'EVM meta-address spend key mismatch',
  );
  assert(evmParsed.viewingPubKey === evmKeys.viewingPubKey, 'EVM meta-address view key mismatch');

  const solMeta = solana.encodeStealthMetaAddress(solKeys.spendingPubKey, solKeys.viewingPubKey);
  const solParsed = solana.decodeStealthMetaAddress(solMeta);
  assert(
    solParsed.spendingPubKey.length === 32 && solParsed.viewingPubKey.length === 32,
    'Solana meta-address key length mismatch',
  );

  const ckbMeta = ckb.encodeStealthMetaAddress(ckbKeys.spendingPubKey, ckbKeys.viewingPubKey);
  const ckbParsed = ckb.decodeStealthMetaAddress(ckbMeta);
  assert(
    ckbParsed.spendingPubKey === ckbKeys.spendingPubKey,
    'CKB meta-address spend key mismatch',
  );

  let invalidMetaCaught = null;
  try {
    evm.decodeStealthMetaAddress('st:eth:0xdeadbeef');
  } catch (error) {
    invalidMetaCaught = error;
  }
  assert(
    invalidMetaCaught instanceof InvalidMetaAddressError &&
      invalidMetaCaught instanceof WraithError &&
      invalidMetaCaught.code === 'WRAITH/INPUT/INVALID_META_ADDRESS' &&
      invalidMetaCaught.describe().includes('Try:'),
    'malformed meta-address did not throw typed actionable InvalidMetaAddressError',
  );

  // 4. Full announcement round-trip (sender generate -> announcement -> scan -> spend key).
  const evmStealth = evm.generateStealthAddress(evmParsed.spendingPubKey, evmParsed.viewingPubKey);
  const evmAnnouncement = {
    schemeId: evm.SCHEME_ID,
    stealthAddress: evmStealth.stealthAddress,
    caller: '0x0000000000000000000000000000000000000001',
    ephemeralPubKey: evmStealth.ephemeralPubKey,
    metadata: `0x${evmStealth.viewTag.toString(16).padStart(2, '0')}`,
  };
  const evmMatches = evm.scanAnnouncements(
    [evmAnnouncement],
    evmKeys.viewingKey,
    evmKeys.spendingPubKey,
    evmKeys.spendingKey,
  );
  assert(evmMatches.length === 1, `expected 1 EVM match, got ${evmMatches.length}`);
  const expectedEvmPriv = evm.deriveStealthPrivateKey(
    evmKeys.spendingKey,
    evmStealth.ephemeralPubKey,
    evmKeys.viewingKey,
  );
  assert(
    evmMatches[0].stealthPrivateKey === expectedEvmPriv,
    'EVM stealth private key round-trip mismatch',
  );

  const solStealth = solana.generateStealthAddress(
    solParsed.spendingPubKey,
    solParsed.viewingPubKey,
  );
  const ephHex = Array.from(solStealth.ephemeralPubKey, (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const solAnnouncement = {
    schemeId: solana.SCHEME_ID,
    stealthAddress: solStealth.stealthAddress,
    caller: solStealth.stealthAddress,
    ephemeralPubKey: ephHex,
    metadata: solStealth.viewTag.toString(16).padStart(2, '0'),
  };
  const solMatches = solana.scanAnnouncements(
    [solAnnouncement],
    solKeys.viewingKey,
    solKeys.spendingPubKey,
    solKeys.spendingScalar,
  );
  assert(solMatches.length === 1, `expected 1 Solana match, got ${solMatches.length}`);
  const expectedSolScalar = solana.deriveStealthPrivateScalar(
    solKeys.spendingScalar,
    solKeys.viewingKey,
    solStealth.ephemeralPubKey,
  );
  assert(
    solMatches[0].stealthPrivateScalar === expectedSolScalar,
    'Solana stealth scalar round-trip mismatch',
  );

  const ckbStealth = ckb.generateStealthAddress(ckbParsed.spendingPubKey, ckbParsed.viewingPubKey);
  const ckbCell = {
    outPoint: { txHash: `0x${'11'.repeat(32)}`, index: 0 },
    capacity: 10_000_000_000n,
    lockArgs: ckbStealth.lockArgs,
    ephemeralPubKey: ckbStealth.ephemeralPubKey,
    stealthPubKeyHash: ckbStealth.stealthPubKeyHash,
  };
  const ckbMatches = ckb.scanStealthCells(
    [ckbCell],
    ckbKeys.viewingKey,
    ckbKeys.spendingPubKey,
    ckbKeys.spendingKey,
  );
  assert(ckbMatches.length === 1, `expected 1 CKB match, got ${ckbMatches.length}`);

  // 5. Cancellation: abort an in-flight streaming scan with AbortController and
  //    verify prompt termination, iterator cleanup, and AbortError classification.
  const controller = new AbortController();
  let streamCleanedUp = false;
  let pendingTimer = null;

  async function* cancellableEvmSource(signal) {
    // Yield one full 64-item adapter batch so `scanAll` emits the first match,
    // then block on the next batch until `AbortController.abort()` fires.
    const decoyAnnouncement = {
      ...evmAnnouncement,
      metadata: `0x${((evmStealth.viewTag + 1) & 0xff).toString(16).padStart(2, '0')}`,
    };
    try {
      yield evmAnnouncement;
      for (let i = 1; i < 64; i += 1) {
        yield decoyAnnouncement;
      }
      await new Promise((_, reject) => {
        if (signal.aborted) {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          return;
        }
        const onAbort = () => {
          if (pendingTimer !== null) clearTimeout(pendingTimer);
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        pendingTimer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          reject(new Error('Cancellation timed out in edge smoke test'));
        }, 5_000);
      });
    } finally {
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      streamCleanedUp = true;
    }
  }

  const seenUnified = [];
  let abortCaught = null;
  try {
    for await (const matched of scanAll({
      evm: {
        source: cancellableEvmSource(controller.signal),
        viewingKey: evmKeys.viewingKey,
        spendingPubKey: evmKeys.spendingPubKey,
        spendingKey: evmKeys.spendingKey,
      },
    })) {
      seenUnified.push(matched);
      controller.abort(new DOMException('Cancelled by edge request', 'AbortError'));
    }
  } catch (error) {
    abortCaught = error;
  }

  assert(seenUnified.length === 1, `expected 1 match before abort, got ${seenUnified.length}`);
  assert(seenUnified[0].chain === 'evm', `unexpected chain ${seenUnified[0].chain}`);
  assert(streamCleanedUp, 'source generator finally block did not run on abort');
  assert(isAbortError(abortCaught), `expected AbortError on cancel, got ${abortCaught}`);

  const rpcAborted = new RPCAbortedError('https://soroban-testnet.stellar.org', {
    cause: controller.signal.reason,
  });
  assert(
    rpcAborted.code === 'WRAITH/NETWORK/RPC_ABORTED' && rpcAborted.describe().includes('Try:'),
    'RPCAbortedError missing code or actionable guidance',
  );

  // 6. Unsupported capabilities fail with a typed, actionable error.
  let vaultError = null;
  try {
    new KeyVault();
  } catch (error) {
    vaultError = error;
  }
  assertTypedUnsupportedError(vaultError, 'window', 'KeyVault in edge runtime');

  let solanaFetchError = null;
  try {
    await solana.fetchAnnouncements('solana', 'http://127.0.0.1:1');
  } catch (error) {
    solanaFetchError = error;
  }
  assertTypedUnsupportedError(
    solanaFetchError,
    '@solana/web3.js',
    'Solana fetchAnnouncements without optional peer',
  );

  return {
    ok: true,
    runtime: runtimeName,
    evmStealthAddress: evmStealth.stealthAddress,
    solanaStealthAddress: solStealth.stealthAddress,
    ckbLockArgsBytes: (ckbStealth.lockArgs.length - 2) / 2,
    cancelledMatches: seenUnified.length,
  };
}
