import { describe, it, expect, vi } from 'vitest';
import { createAnnouncementStream, withAbortSignal } from '../packages/sdk-svelte/src/primitives/useStellarAnnouncementScan.ts';

describe('AbortSignal support for announcement streams', () => {
  it('should throw AbortError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const fetcher = vi.fn().mockResolvedValue([]);
    const stream = createAnnouncementStream(fetcher, { signal: controller.signal });

    await expect(stream.next()).rejects.toThrow('aborted');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('should stop yielding when signal is aborted mid-stream', async () => {
    const controller = new AbortController();
    let callCount = 0;

    const fetcher = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount >= 2) controller.abort();
      return [{ id: callCount }];
    });

    const stream = createAnnouncementStream(fetcher, {
      signal: controller.signal,
      intervalMs: 10,
    });

    const results: any[] = [];
    try {
      for await (const item of stream) {
        results.push(item);
      }
    } catch (e: any) {
      expect(e.name).toBe('AbortError');
    }

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
