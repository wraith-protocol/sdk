import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStealthKeys } from '../src/primitives/createStealthKeys';

const mockKeys = vi.hoisted(() => ({
  spendingKey: new Uint8Array(32),
  spendingScalar: 1n,
  viewingKey: new Uint8Array(32),
  viewingScalar: 2n,
  spendingPubKey: new Uint8Array(32),
  viewingPubKey: new Uint8Array(32),
}));

const mockAddress = vi.hoisted(() => ({
  stealthAddress: 'GABCDEF1234567890',
  ephemeralPubKey: new Uint8Array(32),
  viewTag: 42,
}));

// A simple async generator that yields nothing, representing an empty stream
async function* emptyStream() {}

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  deriveStealthKeys: vi.fn().mockReturnValue(mockKeys),
  generateStealthAddress: vi.fn().mockReturnValue(mockAddress),
  checkStealthAddress: vi.fn().mockReturnValue({
    isMatch: true,
    stealthAddress: 'GABCDEF1234567890',
    hashScalar: 3n,
    stealthPubKeyBytes: new Uint8Array(32),
  }),
  scanAnnouncements: vi.fn().mockReturnValue([]),
  deriveStealthPrivateScalar: vi.fn().mockReturnValue(3n),
  encodeStealthMetaAddress: vi.fn().mockReturnValue('st:xlm:abc...'),
  decodeStealthMetaAddress: vi.fn().mockReturnValue({
    prefix: 'st:xlm:',
    spendingPubKey: new Uint8Array(32),
    viewingPubKey: new Uint8Array(32),
  }),
  fetchAnnouncementsStream: vi.fn().mockImplementation(() => emptyStream()),
}));

describe('createStealthKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the function', () => {
    expect(typeof createStealthKeys).toBe('function');
  });

  it('initialises with null reactive state', () => {
    const primitive = createStealthKeys();
    expect(primitive.keys()).toBeNull();
    expect(primitive.stealthAddress()).toBeNull();
    expect(primitive.metaAddress()).toBeNull();
    expect(primitive.loading()).toBe(false);
    expect(primitive.error()).toBeNull();
    expect(primitive.announcements()).toEqual([]);
    expect(primitive.matched()).toEqual([]);
  });

  it('derives keys and updates the keys signal', () => {
    const primitive = createStealthKeys();
    const sig = new Uint8Array(64);
    const result = primitive.deriveKeys(sig);

    expect(result).toEqual(mockKeys);
    expect(primitive.keys()).toEqual(mockKeys);
  });

  it('loading is false after a synchronous operation completes', () => {
    const primitive = createStealthKeys();
    primitive.deriveKeys(new Uint8Array(64));
    expect(primitive.loading()).toBe(false);
  });

  it('generates stealth address and updates the stealthAddress signal', () => {
    const primitive = createStealthKeys();
    const result = primitive.generateAddress(new Uint8Array(32), new Uint8Array(32));

    expect(result).toEqual(mockAddress);
    expect(primitive.stealthAddress()).toEqual(mockAddress);
  });

  it('checks a stealth address', () => {
    const primitive = createStealthKeys();
    const result = primitive.checkAddress(
      new Uint8Array(32),
      new Uint8Array(32),
      new Uint8Array(32),
      42,
    );
    expect(result.isMatch).toBe(true);
  });

  it('encodes meta address and updates the metaAddress signal', () => {
    const primitive = createStealthKeys();
    const result = primitive.encodeMetaAddress(new Uint8Array(32), new Uint8Array(32));

    expect(result).toBe('st:xlm:abc...');
    expect(primitive.metaAddress()).toBe('st:xlm:abc...');
  });

  it('decodes meta address', () => {
    const primitive = createStealthKeys();
    const result = primitive.decodeMetaAddress('st:xlm:abc...');

    expect(result.prefix).toBe('st:xlm:');
  });

  it('scans announcements and updates the matched signal', () => {
    const primitive = createStealthKeys();
    const result = primitive.scanAnnouncements([], new Uint8Array(32), new Uint8Array(32), 1n);

    expect(Array.isArray(result)).toBe(true);
    expect(primitive.matched()).toEqual([]);
  });

  it('derives private scalar', () => {
    const primitive = createStealthKeys();
    const result = primitive.derivePrivateScalar(1n, new Uint8Array(32), new Uint8Array(32));
    expect(result).toBe(3n);
  });

  it('fetchAnnouncements collects from the stream', async () => {
    const { fetchAnnouncementsStream: mockStream } = vi.mocked(
      await import('@wraith-protocol/sdk/chains/stellar'),
    );
    // Already mocked to return an empty async generator
    const primitive = createStealthKeys();
    const result = await primitive.fetchAnnouncements('testnet');
    expect(result).toEqual([]);
    expect(primitive.announcements()).toEqual([]);
    expect(mockStream).toHaveBeenCalledWith('testnet', undefined);
  });

  it('sets error signal when key derivation throws', async () => {
    const { deriveStealthKeys: mockDeriveStealthKeys } = vi.mocked(
      await import('@wraith-protocol/sdk/chains/stellar'),
    );
    mockDeriveStealthKeys.mockImplementationOnce(() => {
      throw new Error('derivation error');
    });

    const primitive = createStealthKeys();
    expect(() => primitive.deriveKeys(new Uint8Array(64))).toThrow('derivation error');
    expect(primitive.error()).toBe('derivation error');
    expect(primitive.loading()).toBe(false);
  });
});
