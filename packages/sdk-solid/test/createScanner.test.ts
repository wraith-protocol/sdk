import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScanner } from '../src/primitives/createScanner';

const mockAnnouncements = vi.hoisted(() => [
  {
    ephemeralPubKey: new Uint8Array(32),
    viewTag: 42,
    stealthAddress: 'GABCDEF1234567890',
  },
]);

const mockMatched = vi.hoisted(() => [
  {
    stealthAddress: 'GABCDEF1234567890',
    ephemeralPubKey: new Uint8Array(32),
    viewTag: 42,
    stealthPrivateScalar: 99n,
    stealthPubKeyBytes: new Uint8Array(32),
  },
]);

// Async generator that yields mock announcements
async function* mockStream() {
  for (const a of mockAnnouncements) {
    yield a;
  }
}

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  fetchAnnouncementsStream: vi.fn().mockImplementation(() => mockStream()),
  scanAnnouncements: vi.fn().mockReturnValue(mockMatched),
}));

describe('createScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports the function', () => {
    expect(typeof createScanner).toBe('function');
  });

  it('initialises with empty reactive state', () => {
    const primitive = createScanner();
    expect(primitive.announcements()).toEqual([]);
    expect(primitive.matched()).toEqual([]);
    expect(primitive.scanning()).toBe(false);
    expect(primitive.error()).toBeNull();
  });

  it('scan fetches announcements and updates signals', async () => {
    const primitive = createScanner();
    const result = await primitive.scan('testnet');

    expect(result).toEqual(mockAnnouncements);
    expect(primitive.announcements()).toEqual(mockAnnouncements);
    expect(primitive.scanning()).toBe(false);
    expect(primitive.error()).toBeNull();
  });

  it('match filters announcements for matching keys', () => {
    const primitive = createScanner();
    const result = primitive.match(
      mockAnnouncements as any,
      new Uint8Array(32),
      new Uint8Array(32),
      1n,
    );

    expect(result).toEqual(mockMatched);
    expect(primitive.matched()).toEqual(mockMatched);
  });

  it('scanAndMatch performs fetch then match', async () => {
    const primitive = createScanner();
    const result = await primitive.scanAndMatch(
      new Uint8Array(32),
      new Uint8Array(32),
      1n,
      'testnet',
    );

    expect(result).toEqual(mockMatched);
    expect(primitive.announcements()).toEqual(mockAnnouncements);
    expect(primitive.matched()).toEqual(mockMatched);
  });

  it('sets error signal when scan throws', async () => {
    const { fetchAnnouncementsStream: mockFetch } = vi.mocked(
      await import('@wraith-protocol/sdk/chains/stellar'),
    );
    mockFetch.mockImplementationOnce(async function* () {
      throw new Error('network error');
    });

    const primitive = createScanner();
    await expect(primitive.scan('testnet')).rejects.toThrow('network error');
    expect(primitive.error()).toBeInstanceOf(Error);
    expect(primitive.error()!.message).toBe('network error');
    expect(primitive.scanning()).toBe(false);
  });
});
