import { describe, test, expect } from 'vitest';
import { pipeline } from '../../../../src/chains/stellar/scanner/pipeline';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('pipeline', () => {
  test('yields every item from the source in order', async () => {
    async function* source(): AsyncGenerator<number> {
      for (let i = 0; i < 100; i++) yield i;
    }

    const results: number[] = [];
    for await (const value of pipeline(source(), 8)) {
      results.push(value);
    }

    expect(results).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  test('overlaps producer I/O with consumer CPU work', async () => {
    const count = 15;
    const ioDelayMs = 20;
    const cpuDelayMs = 20;

    function makeMockRpc(): AsyncGenerator<number> {
      return (async function* () {
        for (let i = 0; i < count; i++) {
          await sleep(ioDelayMs);
          yield i;
        }
      })();
    }

    // Measure an actual sequential "fetch item, then process it" baseline on this
    // machine/OS instead of computing one from nominal delays, since timer
    // granularity varies enough (especially on Windows) to make a theoretical
    // estimate an unreliable comparison point.
    const sequentialStart = Date.now();
    for await (const _value of makeMockRpc()) {
      await sleep(cpuDelayMs);
    }
    const sequentialElapsed = Date.now() - sequentialStart;

    const pipelinedStart = Date.now();
    // Capacity covers the whole source so the producer can run as far ahead
    // as it wants, giving the best case for overlap and the least timer jitter.
    for await (const _value of pipeline(makeMockRpc(), count)) {
      await sleep(cpuDelayMs);
    }
    const pipelinedElapsed = Date.now() - pipelinedStart;

    // Assert at least a 25% improvement over the measured sequential baseline,
    // leaving margin for scheduler jitter beyond the theoretical ~50% ideal.
    expect(pipelinedElapsed).toBeLessThan(sequentialElapsed * 0.75);
  });

  test('backpressure bounds how far the producer can run ahead of a slow consumer', async () => {
    const capacity = 4;
    let produced = 0;

    async function* fastSource(): AsyncGenerator<number> {
      for (let i = 0; i < 50; i++) {
        produced++;
        yield i;
      }
    }

    let consumed = 0;
    let maxLead = 0;
    for await (const _value of pipeline(fastSource(), capacity)) {
      await sleep(2);
      consumed++;
      maxLead = Math.max(maxLead, produced - consumed);
    }

    expect(consumed).toBe(50);
    // Small slack above `capacity` for the one item already in flight when the
    // queue is measured, not unbounded growth from the fast producer.
    expect(maxLead).toBeLessThanOrEqual(capacity + 2);
  });

  test('propagates cancellation to the source generator', async () => {
    let sourceReturned = false;

    async function* infinite(): AsyncGenerator<number> {
      try {
        let i = 0;
        while (true) yield i++;
      } finally {
        sourceReturned = true;
      }
    }

    const results: number[] = [];
    for await (const value of pipeline(infinite(), 4)) {
      results.push(value);
      if (results.length === 3) break;
    }

    expect(results).toEqual([0, 1, 2]);
    expect(sourceReturned).toBe(true);
  });

  test('propagates source errors to the consumer', async () => {
    async function* failing(): AsyncGenerator<number> {
      yield 1;
      throw new Error('boom');
    }

    const results: number[] = [];
    await expect(async () => {
      for await (const value of pipeline(failing(), 4)) {
        results.push(value);
      }
    }).rejects.toThrow('boom');

    expect(results).toEqual([1]);
  });
});
