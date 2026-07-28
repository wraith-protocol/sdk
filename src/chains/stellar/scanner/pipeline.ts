/** Resolvable/rejectable promise used to gate the producer and consumer loops. */
class Deferred<T = void> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}

/**
 * Pipelines an async iterable through a bounded in-memory queue so a slow
 * consumer (e.g. CPU-bound decryption) overlaps with a producer that is
 * mostly waiting on I/O (e.g. RPC pagination), instead of alternating
 * "await a full page, then process it" in lockstep.
 *
 * A background pump continuously pulls from `source` and buffers up to
 * `capacity` items ahead of what the consumer has read. Because pulling the
 * next item from `source` starts its I/O immediately, that I/O runs
 * concurrently with whatever synchronous work the consumer is doing on
 * already-buffered items — Node's event loop keeps the in-flight network
 * call progressing in the background while the main thread executes the
 * consumer's CPU-bound step.
 *
 * The pump pauses once the queue is full, so an adversarially fast producer
 * paired with a slow consumer cannot grow memory past O(capacity) items.
 *
 * Breaking out of the consumer's `for-await` loop (or calling `.return()`)
 * propagates to `source` via its `.return()`, matching plain async-generator
 * cancellation semantics.
 *
 * @param source Async iterable to pull from (e.g. {@link fetchAnnouncementsStream}).
 * @param capacity Max items buffered ahead of the consumer. Must be >= 1.
 */
export async function* pipeline<T>(source: AsyncIterable<T>, capacity: number): AsyncGenerator<T> {
  const cap = Math.max(1, capacity);
  const buffer: T[] = [];
  let producerDone = false;
  let producerErrored = false;
  let producerError: unknown;

  let itemAvailable = new Deferred();
  let spaceAvailable = new Deferred();
  spaceAvailable.resolve();

  const iter = source[Symbol.asyncIterator]();

  const pump = (async () => {
    try {
      while (true) {
        if (buffer.length >= cap) {
          await spaceAvailable.promise;
          spaceAvailable = new Deferred();
        }

        const next = await iter.next();
        if (next.done) break;

        buffer.push(next.value);
        itemAvailable.resolve();
      }
    } catch (err) {
      producerErrored = true;
      producerError = err;
    } finally {
      producerDone = true;
      itemAvailable.resolve();
    }
  })();

  try {
    while (true) {
      if (buffer.length === 0) {
        if (producerDone) {
          if (producerErrored) throw producerError;
          break;
        }
        await itemAvailable.promise;
        itemAvailable = new Deferred();
        continue;
      }

      const value = buffer.shift() as T;
      spaceAvailable.resolve();
      yield value;
    }
  } finally {
    await iter.return?.();
    await pump.catch(() => {});
  }
}
