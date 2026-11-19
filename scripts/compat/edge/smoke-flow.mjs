import {
  assertRuntimeCapabilities,
  detectRuntimeCapabilities,
  isAbortError,
  WraithError,
} from '@wraith-protocol/sdk';
import {
  SCHEME_ID,
  decodeStealthMetaAddress,
  deriveStealthKeys,
  encodeStealthMetaAddress,
  generateStealthAddress,
  scanAnnouncements,
} from '@wraith-protocol/sdk/chains/evm';

const SIGNATURE = `0x${'aa'.repeat(32)}${'bb'.repeat(32)}1b`;

function expectThrow(fn, label) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error(`${label}: expected an error but none was thrown`);
}

export async function runEdgeSmokeFlow(runtime) {
  const steps = [];
  const check = (condition, label) => {
    if (!condition) throw new Error(`${label}: assertion failed`);
    steps.push(label);
  };

  assertRuntimeCapabilities();
  const capabilities = detectRuntimeCapabilities();
  check(capabilities.missing.length === 0, 'capability guard accepts the runtime');

  const error = expectThrow(
    () => assertRuntimeCapabilities(['edge-smoke/missing-capability']),
    'capability guard',
  );
  check(error instanceof WraithError, 'unsupported capability error is a WraithError');
  check(
    error.name === 'UnsupportedCapabilityError',
    'unsupported capability error has a typed name',
  );
  check(
    error.code === 'WRAITH/COMPAT/UNSUPPORTED_CAPABILITY',
    'unsupported capability error has a stable code',
  );
  check(
    typeof error.describe === 'function' && error.describe().includes('COMPAT.md'),
    'unsupported capability error is actionable',
  );

  const random = crypto.getRandomValues(new Uint8Array(16));
  check(random instanceof Uint8Array && random.byteLength === 16, 'crypto.getRandomValues');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('wraith-edge'));
  check(digest.byteLength === 32, 'crypto.subtle.digest');

  const keys = deriveStealthKeys(SIGNATURE);
  check(keys.spendingKey?.length === 66 && keys.viewingKey?.length === 66, 'key generation');

  const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
  const decoded = decodeStealthMetaAddress(metaAddress);
  check(
    decoded.spendingPubKey === keys.spendingPubKey && decoded.viewingPubKey === keys.viewingPubKey,
    'meta-address parsing round trip',
  );

  const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
  check(typeof stealth.stealthAddress === 'string', 'stealth address generation');
  const announcement = {
    schemeId: SCHEME_ID,
    stealthAddress: stealth.stealthAddress,
    caller: `0x${'11'.repeat(20)}`,
    ephemeralPubKey: stealth.ephemeralPubKey,
    metadata: `0x${stealth.viewTag.toString(16).padStart(2, '0')}`,
  };
  const matched = scanAnnouncements(
    [announcement],
    keys.viewingKey,
    keys.spendingPubKey,
    keys.spendingKey,
  );
  check(
    matched.length === 1 &&
      matched[0].stealthAddress === stealth.stealthAddress &&
      typeof matched[0].stealthPrivateKey === 'string',
    'announcement round trip',
  );

  const controller = new AbortController();
  controller.abort();
  let abortError;
  try {
    if (typeof controller.signal.throwIfAborted === 'function') {
      controller.signal.throwIfAborted();
    } else {
      throw new DOMException('This operation was aborted', 'AbortError');
    }
  } catch (thrown) {
    abortError = thrown;
  }
  check(isAbortError(abortError), 'cancellation is a typed AbortError');

  return { ok: true, runtime, capabilities: capabilities.available, steps };
}

export function serializeFlowError(runtime, thrown) {
  return {
    ok: false,
    runtime,
    error: thrown instanceof Error ? thrown.message : String(thrown),
  };
}
