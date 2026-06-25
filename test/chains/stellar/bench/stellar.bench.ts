import { bench, describe, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { deriveStealthKeys } from '../../../../src/chains/stellar/keys';
import { generateStealthAddress } from '../../../../src/chains/stellar/stealth';
import { scanAnnouncements, checkStealthAddress } from '../../../../src/chains/stellar/scan';
import { deriveStealthPrivateScalar } from '../../../../src/chains/stellar/spend';
import { encodeStealthMetaAddress, decodeStealthMetaAddress } from '../../../../src/chains/stellar/meta-address';
import { signWithScalar } from '../../../../src/chains/stellar/scalar';
import { fetchAnnouncements } from '../../../../src/chains/stellar/announcements';
import { bytesToHex } from '../../../../src/chains/stellar/utils';
import type { Announcement } from '../../../../src/chains/stellar/types';

/**
 * Stellar Stealth Address Benchmarks
 *
 * Measures performance of core cryptographic operations used in the stealth
 * address system: key derivation, address generation, announcement scanning,
 * and transaction signing.
 */

describe('Stellar Stealth Benchmarks', () => {
  // Fixed: Generate 64-byte signature as expected by deriveStealthKeys
  const testSignature = ed25519.utils.randomPrivateKey().concat(ed25519.utils.randomPrivateKey());
  const keys = deriveStealthKeys(testSignature);
  const ephemeralSeed = ed25519.utils.randomPrivateKey();
  const ephemeralPubKey = ed25519.getPublicKey(ephemeralSeed);
  const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey, ephemeralSeed);
  const messageHash = new Uint8Array(32).fill(42);

  const generateAnnouncements = (count: number): Announcement[] => {
    const announcements: Announcement[] = [];
    for (let i = 0; i < count; i++) {
      const ephSeed = ed25519.utils.randomPrivateKey();
      const ephPub = ed25519.getPublicKey(ephSeed);
      const viewTag = i % 256;

      announcements.push({
        schemeId: 1,
        stealthAddress: stealth.stealthAddress,
        caller: stealth.stealthAddress,
        ephemeralPubKey: bytesToHex(ephPub),
        metadata: viewTag.toString(16).padStart(2, '0'),
      });
    }
    return announcements;
  };

  // Pre-generate announcements for scanning benchmarks to isolate scan performance
  const announcements10 = generateAnnouncements(10);
  const announcements100 = generateAnnouncements(100);
  const announcements1000 = generateAnnouncements(1000);
  const announcements10000 = generateAnnouncements(10000);
  const announcements100000 = generateAnnouncements(100000);

  describe('Key Derivation', () => {
    bench('deriveStealthKeys (from 64-byte signature)', () => {
      deriveStealthKeys(testSignature);
    });
  });

  describe('Address Generation', () => {
    bench('generateStealthAddress', () => {
      generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);
    });
  });

  describe('Meta-address Encoding/Decoding', () => {
    const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

    bench('encodeStealthMetaAddress', () => {
      encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    });

    bench('decodeStealthMetaAddress', () => {
      decodeStealthMetaAddress(metaAddress);
    });

    bench('encode + decode round-trip', () => {
      const encoded = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
      decodeStealthMetaAddress(encoded);
    });
  });

  describe('Private Key Derivation', () => {
    bench('deriveStealthPrivateScalar', () => {
      deriveStealthPrivateScalar(keys.spendingScalar, keys.viewingKey, ephemeralPubKey);
    });
  });

  describe('Signing', () => {
    bench('signWithScalar', () => {
      signWithScalar(messageHash, keys.spendingScalar, keys.spendingPubKey);
    });
  });

  describe('Announcement Scanning', () => {
    bench('checkStealthAddress (single match check)', () => {
      checkStealthAddress(ephemeralPubKey, keys.viewingKey, keys.spendingPubKey, stealth.viewTag);
    });

    bench('scanAnnouncements - 10 announcements', () => {
      scanAnnouncements(announcements10, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
    });

    bench('scanAnnouncements - 100 announcements', () => {
      scanAnnouncements(announcements100, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
    });

    bench('scanAnnouncements - 1,000 announcements', () => {
      scanAnnouncements(announcements1000, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
    });

    bench('scanAnnouncements - 10,000 announcements', () => {
      scanAnnouncements(announcements10000, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
    });

    bench('scanAnnouncements - 100,000 announcements', () => {
      scanAnnouncements(announcements100000, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar);
    });
  });

  describe('HTTP / Network', () => {
    bench('fetchAnnouncements (mocked RPC response)', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          if (body?.params?.pagination?.limit === 1) {
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: 0,
                error: { message: 'range: 1 - 120000' },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }

          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              result: {
                events: [],
                cursor: undefined,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        });

      try {
        await fetchAnnouncements('stellar', 'https://localhost:8000/soroban/rpc');
      } finally {
        fetchMock.mockRestore();
      }
    });
  });
});
