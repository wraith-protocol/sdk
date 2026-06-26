/**
 * Integration tests: resolveStellarFederation against live Stellar testnet.
 *
 * Makes real HTTP requests to:
 *   - https://testanchor.stellar.org/.well-known/stellar.toml
 *   - https://testanchor.stellar.org/federation  (discovered from the TOML)
 *
 * Run with:
 *   INTEGRATION=1 pnpm exec vitest run test/chains/stellar/federation.integration.test.ts
 *
 * Skipped by default in CI unless INTEGRATION=1 is set.
 */

import { describe, it, expect } from 'vitest';
import { FederationResolver, FederationError } from '../../../src/chains/stellar/federation';

const SKIP = process.env['INTEGRATION'] !== '1';

describe('Integration: federation resolution (testanchor.stellar.org)', { skip: SKIP }, () => {
  it('discovers FEDERATION_SERVER from stellar.toml', async () => {
    const resp = await fetch('https://testanchor.stellar.org/.well-known/stellar.toml');
    expect(resp.ok).toBe(true);
    const toml = await resp.text();
    expect(toml).toMatch(/FEDERATION_SERVER/);
    console.log('[Integration] stellar.toml (first 400 chars):\n', toml.slice(0, 400));
  }, 10_000);

  it('resolves demo*testanchor.stellar.org to a valid Stellar account ID', async () => {
    const resolver = new FederationResolver({ cacheTtl: 0 });
    const result = await resolver.resolve('demo*testanchor.stellar.org');
    // Stellar account IDs start with G and are 56 chars (base32)
    expect(result.accountId).toMatch(/^G[A-Z2-7]{55}$/);
    console.log('[Integration] demo*testanchor.stellar.org →', result);
  }, 15_000);

  it('returns cached result on second call (no extra HTTP calls)', async () => {
    const calls: string[] = [];
    const resolver = new FederationResolver({
      cacheTtl: 60_000,
      fetch: async (url) => {
        calls.push(url);
        return globalThis.fetch(url);
      },
    });
    await resolver.resolve('demo*testanchor.stellar.org');
    const callsAfterFirst = calls.length;
    await resolver.resolve('demo*testanchor.stellar.org');
    // Second resolve must not add any new calls
    expect(calls.length).toBe(callsAfterFirst);
  }, 15_000);

  it('throws NOT_FOUND or FEDERATION_FETCH_FAILED for a non-existent address', async () => {
    const resolver = new FederationResolver({ cacheTtl: 0 });
    const err = await resolver
      .resolve('nonexistent-user-zzzzzzzz*testanchor.stellar.org')
      .catch((e) => e);
    expect(err).toBeInstanceOf(FederationError);
    expect(['NOT_FOUND', 'FEDERATION_FETCH_FAILED']).toContain(err.code);
    console.log('[Integration] Expected error for non-existent address:', err.code, err.message);
  }, 15_000);
});
