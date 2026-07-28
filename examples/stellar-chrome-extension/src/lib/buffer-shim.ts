// Provide the global `Buffer` that @stellar/stellar-sdk expects at runtime.
// Import this first in every entry point (service worker + popup). The `buffer`
// package is aliased in vite.config.ts. Pure-crypto paths never touch Buffer,
// but the shim is tiny and harmless to load everywhere.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
