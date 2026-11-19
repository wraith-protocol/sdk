import { UnsupportedCapabilityError } from '../errors';

export type RuntimeCapability =
  | 'crypto.getRandomValues'
  | 'crypto.subtle'
  | 'TextEncoder'
  | 'TextDecoder'
  | 'AbortController'
  | 'fetch'
  | 'setTimeout';

export const DEFAULT_RUNTIME_CAPABILITIES: readonly RuntimeCapability[] = [
  'crypto.getRandomValues',
  'TextEncoder',
  'TextDecoder',
  'AbortController',
  'setTimeout',
];

export const CAPABILITY_HINT =
  'This is a standard web API available in Cloudflare Workers, Deno, Bun and evergreen browsers. ' +
  'Do not polyfill Node.js Buffer, process, fs or crypto. Check the runtime support table in ' +
  'COMPAT.md and upgrade the runtime or supply the native web API.';

const CHECKS: Record<RuntimeCapability, () => boolean> = {
  'crypto.getRandomValues': () =>
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function',
  'crypto.subtle': () =>
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle !== 'undefined',
  TextEncoder: () => typeof globalThis.TextEncoder === 'function',
  TextDecoder: () => typeof globalThis.TextDecoder === 'function',
  AbortController: () => typeof globalThis.AbortController === 'function',
  fetch: () => typeof globalThis.fetch === 'function',
  setTimeout: () => typeof globalThis.setTimeout === 'function',
};

export interface RuntimeCapabilityReport {
  available: string[];
  missing: string[];
}

export function detectRuntimeCapabilities(
  capabilities: readonly string[] = DEFAULT_RUNTIME_CAPABILITIES,
): RuntimeCapabilityReport {
  const available: string[] = [];
  const missing: string[] = [];
  for (const capability of capabilities) {
    const check = CHECKS[capability as RuntimeCapability];
    if (check ? check() : false) {
      available.push(capability);
    } else {
      missing.push(capability);
    }
  }
  return { available, missing };
}

export function assertRuntimeCapabilities(
  capabilities: readonly string[] = DEFAULT_RUNTIME_CAPABILITIES,
): void {
  const { missing } = detectRuntimeCapabilities(capabilities);
  if (missing.length > 0) {
    throw new UnsupportedCapabilityError(missing, CAPABILITY_HINT);
  }
}
