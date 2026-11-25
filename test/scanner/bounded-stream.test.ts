import { describe, expect, it } from 'vitest';
import { BoundedAnnouncementStream } from '../../src/scanner/boundedStream';

interface ManualCall<T> {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
}

function manualSource<T>() {
  const calls: Array<ManualCall<T>> = [];
  const source: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          return new Promise<IteratorResult<T>>((resolve, reject) => {
            calls.push({ resolve, reject });
          });
        },
        return: async (): Promise<IteratorResult<T>> => ({ done: true, value: undefined }),
      };
    },
  };
  return { source, calls };
}

const budget = { maxInFlightRequests: 2, maxBufferedAnnouncements: 8 };

describe('BoundedAnnouncementStream source ordering', () => {
  it('keeps values in source-call order when later pulls settle first', async () => {
    const { source, calls } = manualSource<number>();
    const stream = new BoundedAnnouncementStream(source, { chain: 'evm', budget });

    expect(calls).toHaveLength(2);
    calls[1]?.resolve({ done: false, value: 2 });
    await Promise.resolve();
    calls[0]?.resolve({ done: false, value: 1 });

    await expect(stream.next()).resolves.toEqual({ done: false, value: 1 });
    await expect(stream.next()).resolves.toEqual({ done: false, value: 2 });
    await stream.return();
  });

  it('does not report completion before an earlier value settles', async () => {
    const { source, calls } = manualSource<number>();
    const stream = new BoundedAnnouncementStream(source, { chain: 'evm', budget });

    expect(calls).toHaveLength(2);
    calls[1]?.resolve({ done: true, value: undefined });
    await Promise.resolve();

    const pending = stream.next();
    calls[0]?.resolve({ done: false, value: 1 });

    await expect(pending).resolves.toEqual({ done: false, value: 1 });
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
  });
});
