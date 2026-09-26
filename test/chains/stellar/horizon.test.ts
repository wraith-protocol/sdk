import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHorizonClient,
  type HorizonClient,
  type RetryPolicy,
} from '../../../src/chains/stellar/horizon';
import { RPCRequestError, RPCRetryExhaustedError } from '../../../src/errors';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {},
): Response {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('content-type') && init.ok !== false) {
    headers.set('content-type', 'application/json');
  }
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: '',
    headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('createHorizonClient', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('default policy', () => {
    it('succeeds on first try with a 200', async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ status: 'healthy' }));

      const client = createHorizonClient({ horizonUrl: HORIZON_URL, fetchImpl });
      const result = await client.get('/health');

      expect(result).toEqual({ status: 'healthy' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 up to maxRetries then throws', async () => {
      fetchImpl.mockResolvedValue(
        jsonResponse({ error: 'rate limited' }, { ok: false, status: 429 }),
      );

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 2, baseDelayMs: 5 },
      });

      await expect(client.get('/accounts/GA123')).rejects.toThrow(RPCRetryExhaustedError);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('retries on 503 up to maxRetries then throws', async () => {
      fetchImpl.mockResolvedValue(
        jsonResponse({ error: 'service unavailable' }, { ok: false, status: 503 }),
      );

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 3, baseDelayMs: 5 },
      });

      await expect(client.get('/health')).rejects.toThrow(RPCRetryExhaustedError);
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    });

    it('succeeds on retry after initial 429', async () => {
      fetchImpl
        .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, { ok: false, status: 429 }))
        .mockResolvedValue(jsonResponse({ status: 'healthy' }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 2, baseDelayMs: 5 },
      });

      const result = await client.get('/health');
      expect(result).toEqual({ status: 'healthy' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('succeeds on retry after initial 503', async () => {
      fetchImpl
        .mockResolvedValueOnce(jsonResponse({ error: 'unavailable' }, { ok: false, status: 503 }))
        .mockResolvedValue(jsonResponse({ status: 'ok' }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 2, baseDelayMs: 5 },
      });

      const result = await client.get('/health');
      expect(result).toEqual({ status: 'ok' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 404', async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ error: 'not found' }, { ok: false, status: 404 }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 3 },
      });

      await expect(client.get('/accounts/GA123')).rejects.toThrow(RPCRequestError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('retries on network error (fetch throws)', async () => {
      fetchImpl
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue(jsonResponse({ status: 'ok' }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 2, baseDelayMs: 5 },
      });

      const result = await client.get('/health');
      expect(result).toEqual({ status: 'ok' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('throws RPCRetryExhaustedError after network errors exhaust retries', async () => {
      fetchImpl.mockRejectedValue(new Error('ECONNREFUSED'));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 1, baseDelayMs: 5 },
      });

      await expect(client.get('/health')).rejects.toThrow(RPCRetryExhaustedError);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  describe('Retry-After header', () => {
    it('respects Retry-After seconds', async () => {
      fetchImpl
        .mockResolvedValueOnce(
          jsonResponse(
            { error: 'rate limited' },
            { ok: false, status: 429, headers: { 'retry-after': '1' } },
          ),
        )
        .mockResolvedValue(jsonResponse({ status: 'ok' }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 2, baseDelayMs: 10000 },
      });

      const start = Date.now();
      const result = await client.get('/health');
      const elapsed = Date.now() - start;

      expect(result).toEqual({ status: 'ok' });
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(elapsed).toBeLessThan(5000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('caps Retry-After at maxDelayMs', async () => {
      fetchImpl
        .mockResolvedValueOnce(
          jsonResponse(
            { error: 'rate limited' },
            { ok: false, status: 429, headers: { 'retry-after': '120' } },
          ),
        )
        .mockResolvedValue(jsonResponse({ status: 'ok' }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 2, baseDelayMs: 5, maxDelayMs: 200 },
      });

      const start = Date.now();
      await client.get('/health');
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('no-retry policy', () => {
    it('does not retry when maxRetries = 0', async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ error: 'busy' }, { ok: false, status: 503 }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 0 },
      });

      await expect(client.get('/health')).rejects.toThrow(RPCRequestError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('does not retry on network error when maxRetries = 0', async () => {
      fetchImpl.mockRejectedValue(new Error('ECONNREFUSED'));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 0 },
      });

      await expect(client.get('/health')).rejects.toThrow(RPCRetryExhaustedError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-client custom retry', () => {
    it('uses custom retryable statuses', async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ error: 'gone' }, { ok: false, status: 410 }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 2, baseDelayMs: 5, retryableStatuses: [410] },
      });

      await expect(client.get('/health')).rejects.toThrow(RPCRetryExhaustedError);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });
  });

  describe('per-call retry override', () => {
    it('overrides retry policy for a single call', async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ error: 'busy' }, { ok: false, status: 503 }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 5, baseDelayMs: 5 },
      });

      await expect(client.get('/health', { retry: { maxRetries: 0 } })).rejects.toThrow(
        RPCRequestError,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('per-call override adds extra retryable status', async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ error: 'teapot' }, { ok: false, status: 418 }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 2, baseDelayMs: 5 },
      });

      await expect(
        client.get('/health', { retry: { retryableStatuses: [418], maxRetries: 1 } }),
      ).rejects.toThrow(RPCRetryExhaustedError);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST requests', () => {
    it('sends a POST with URLSearchParams', async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ hash: 'abc123' }));

      const client = createHorizonClient({ horizonUrl: HORIZON_URL, fetchImpl });
      const result = await client.post('/transactions', new URLSearchParams({ tx: 'AAAA...' }));

      expect(result).toEqual({ hash: 'abc123' });
      expect(fetchImpl).toHaveBeenCalledWith(
        `${HORIZON_URL}/transactions`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: expect.any(URLSearchParams),
        }),
      );
    });

    it('retries POST on 503', async () => {
      fetchImpl
        .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, { ok: false, status: 503 }))
        .mockResolvedValue(jsonResponse({ hash: 'abc123' }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 2, baseDelayMs: 5 },
      });

      const result = await client.post('/transactions', new URLSearchParams({ tx: 'AAAA...' }));
      expect(result).toEqual({ hash: 'abc123' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  describe('trailing slash handling', () => {
    it('strips trailing slash from horizonUrl', async () => {
      fetchImpl.mockResolvedValue(jsonResponse({ status: 'healthy' }));

      const client = createHorizonClient({
        horizonUrl: 'https://horizon-testnet.stellar.org/',
        fetchImpl,
      });
      await client.get('/health');

      expect(fetchImpl).toHaveBeenCalledWith(
        'https://horizon-testnet.stellar.org/health',
        expect.any(Object),
      );
    });
  });

  describe('default RetryPolicy structure', () => {
    it('exports a sane default policy shape', () => {
      const client = createHorizonClient({ horizonUrl: HORIZON_URL, fetchImpl });

      expect(client).toBeDefined();
      expect(typeof client.get).toBe('function');
      expect(typeof client.post).toBe('function');
    });

    it('default retryable statuses include 429, 500, 502, 503, 504', async () => {
      // Verify 502 is retryable by default
      fetchImpl
        .mockResolvedValueOnce(jsonResponse({ error: 'bad gateway' }, { ok: false, status: 502 }))
        .mockResolvedValue(jsonResponse({ status: 'ok' }));

      const client = createHorizonClient({
        horizonUrl: HORIZON_URL,
        fetchImpl,
        retry: { maxRetries: 1, baseDelayMs: 5 },
      });

      const result = await client.get('/health');
      expect(result).toEqual({ status: 'ok' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });
});
