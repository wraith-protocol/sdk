import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  fetchAnnouncements,
  fetchAnnouncementsPage,
} from '../../../src/chains/solana/announcements';
import {
  AnnouncementBudgetExceededError,
  AnnouncementCursorError,
  AnnouncementProviderError,
  RPCAbortedError,
  RPCTimeoutError,
} from '../../../src/errors';

const mocks = vi.hoisted(() => ({
  getSignatures: vi.fn(),
  getTransaction: vi.fn(),
  constructed: vi.fn(),
}));

vi.mock('@solana/web3.js', () => {
  class PublicKey {
    constructor(_value: unknown) {}
    toBase58(): string {
      return '11111111111111111111111111111111';
    }
  }
  class Connection {
    constructor(url: string) {
      mocks.constructed(url);
    }
    getSignaturesForAddress = mocks.getSignatures;
    getTransaction = mocks.getTransaction;
  }
  return { Connection, PublicKey };
});

const SIG_A = '1'.repeat(64);
const SIG_B = '2'.repeat(64);

function announcementLog(): string {
  const metadata = new Uint8Array([0xde, 0xad]);
  const bytes = new Uint8Array(8 + 4 + 32 + 32 + 32 + 4 + metadata.length);
  [0xfa, 0xb0, 0x2a, 0xef, 0x3c, 0xad, 0x36, 0x88].forEach((b, i) => {
    bytes[i] = b;
  });
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 1, true);
  bytes.fill(0x01, 12, 44);
  bytes.fill(0x02, 44, 76);
  bytes.fill(0x03, 76, 108);
  view.setUint32(108, metadata.length, true);
  bytes.set(metadata, 112);
  return `Program data: ${Buffer.from(bytes).toString('base64')}`;
}

const TX_WITH_ANNOUNCEMENT = { meta: { logMessages: [announcementLog()] } };

beforeEach(() => {
  mocks.getSignatures.mockReset();
  mocks.getTransaction.mockReset();
  mocks.constructed.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Solana fetchAnnouncements resilience', () => {
  test('walks both programs and parses announcement logs', async () => {
    mocks.getSignatures.mockResolvedValueOnce([{ signature: SIG_A }]).mockResolvedValueOnce([]);
    mocks.getTransaction.mockResolvedValueOnce(TX_WITH_ANNOUNCEMENT);

    const result = await fetchAnnouncements('solana');

    expect(result).toHaveLength(1);
    expect(result[0]?.schemeId).toBe(1);
    expect(mocks.getSignatures).toHaveBeenCalledTimes(2);
  });

  test('times out an RPC call that never answers', async () => {
    mocks.getSignatures.mockReturnValue(new Promise(() => {}));

    await expect(
      fetchAnnouncements('solana', {
        timeouts: { requestMs: 25 },
        retry: { maxRetries: 0 },
      }),
    ).rejects.toBeInstanceOf(RPCTimeoutError);
  });

  test('rejects an already-aborted signal without calling the RPC', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchAnnouncements('solana', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(RPCAbortedError);
    expect(mocks.getSignatures).not.toHaveBeenCalled();
  });

  test('aborts an in-flight RPC call', async () => {
    mocks.getSignatures.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();

    const promise = fetchAnnouncements('solana', { signal: controller.signal });
    const assertion = expect(promise).rejects.toBeInstanceOf(RPCAbortedError);
    controller.abort();
    await assertion;
  });

  test('retries rate-limited RPC calls with backoff', async () => {
    mocks.getSignatures
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await fetchAnnouncements('solana', {
      retry: { maxRetries: 1, baseDelayMs: 0 },
    });

    expect(result).toEqual([]);
    expect(mocks.getSignatures).toHaveBeenCalledTimes(3);
  });

  test('reports a non-retryable RPC failure as AnnouncementProviderError', async () => {
    mocks.getSignatures.mockRejectedValue(new Error('invalid account data'));

    await expect(fetchAnnouncements('solana')).rejects.toBeInstanceOf(AnnouncementProviderError);
  });

  test('rejects malformed cursors before calling the RPC', async () => {
    await expect(fetchAnnouncements('solana', { cursor: 'not-json' })).rejects.toMatchObject({
      name: 'AnnouncementCursorError',
      reason: 'malformed',
    } satisfies Partial<AnnouncementCursorError>);

    await expect(
      fetchAnnouncements('solana', { cursor: JSON.stringify({ v: 2, program: 0 }) }),
    ).rejects.toBeInstanceOf(AnnouncementCursorError);
    expect(mocks.getSignatures).not.toHaveBeenCalled();
  });

  test('stops at the maximum-page budget and keeps partial progress', async () => {
    mocks.getSignatures
      .mockResolvedValueOnce([{ signature: SIG_A }])
      .mockResolvedValueOnce([{ signature: SIG_B }]);
    mocks.getTransaction.mockResolvedValue(TX_WITH_ANNOUNCEMENT);

    const error = await fetchAnnouncements('solana', { pageSize: 1, maxPages: 2 }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(AnnouncementBudgetExceededError);
    const budgetError = error as AnnouncementBudgetExceededError;
    expect(budgetError.budget).toBe('pages');
    expect(budgetError.fetched).toBe(2);
    expect(budgetError.partial).toHaveLength(2);
    expect(typeof budgetError.cursor).toBe('string');
    expect(mocks.getSignatures).toHaveBeenCalledTimes(2);
  });

  test('fetches one page and resumes from its signature cursor', async () => {
    mocks.getSignatures.mockResolvedValueOnce([{ signature: SIG_A }]);
    mocks.getTransaction.mockResolvedValueOnce(TX_WITH_ANNOUNCEMENT);

    const first = await fetchAnnouncementsPage('solana', { pageSize: 1 });

    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeDefined();

    mocks.getSignatures.mockResolvedValueOnce([]);
    const second = await fetchAnnouncementsPage('solana', {
      pageSize: 1,
      cursor: first.cursor,
    });

    const options = mocks.getSignatures.mock.calls[1]?.[1] as { before?: string };
    expect(options.before).toBe(SIG_A);
    expect(second.announcements).toEqual([]);
  });
});
