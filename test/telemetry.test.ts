import { describe, test, expect, afterEach } from 'vitest';
import {
  setTracer,
  getTracer,
  withSpan,
  NOOP_TRACER,
  type Tracer,
  type Span,
} from '../src/telemetry';

function makeRecordingTracer() {
  const spans: Array<{
    name: string;
    attributes: Record<string, string | number | boolean> | undefined;
    ended: boolean;
    exceptions: unknown[];
    extraAttributes: Record<string, string | number | boolean>;
  }> = [];

  const tracer: Tracer = {
    startSpan(name, attributes) {
      const record = {
        name,
        attributes,
        ended: false,
        exceptions: [] as unknown[],
        extraAttributes: {},
      };
      spans.push(record);
      const span: Span = {
        setAttribute(key, value) {
          record.extraAttributes[key] = value;
        },
        recordException(error) {
          record.exceptions.push(error);
        },
        end() {
          record.ended = true;
        },
      };
      return span;
    },
  };

  return { tracer, spans };
}

describe('telemetry', () => {
  afterEach(() => {
    setTracer(null);
  });

  test('getTracer defaults to NOOP_TRACER', () => {
    expect(getTracer()).toBe(NOOP_TRACER);
  });

  test('NOOP_TRACER spans are safe no-ops', () => {
    const span = NOOP_TRACER.startSpan('anything', { a: 1 });
    expect(() => {
      span.setAttribute('x', 'y');
      span.recordException(new Error('boom'));
      span.end();
    }).not.toThrow();
  });

  test('setTracer configures the global tracer used by getTracer', () => {
    const { tracer } = makeRecordingTracer();
    setTracer(tracer);
    expect(getTracer()).toBe(tracer);
  });

  test('setTracer(null) resets to the no-op tracer', () => {
    const { tracer } = makeRecordingTracer();
    setTracer(tracer);
    setTracer(null);
    expect(getTracer()).toBe(NOOP_TRACER);
  });

  test('withSpan runs a sync function and ends the span with its result', () => {
    const { tracer, spans } = makeRecordingTracer();
    setTracer(tracer);

    const result = withSpan('op', { a: 1 }, () => 42);

    expect(result).toBe(42);
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('op');
    expect(spans[0].attributes).toEqual({ a: 1 });
    expect(spans[0].ended).toBe(true);
    expect(spans[0].exceptions).toHaveLength(0);
  });

  test('withSpan records and rethrows a sync exception, still ending the span', () => {
    const { tracer, spans } = makeRecordingTracer();
    setTracer(tracer);
    const err = new Error('sync boom');

    expect(() =>
      withSpan('op', undefined, () => {
        throw err;
      }),
    ).toThrow(err);

    expect(spans[0].ended).toBe(true);
    expect(spans[0].exceptions).toEqual([err]);
  });

  test('withSpan awaits an async function and ends the span once it resolves', async () => {
    const { tracer, spans } = makeRecordingTracer();
    setTracer(tracer);

    const result = await withSpan('op', undefined, async () => {
      expect(spans[0].ended).toBe(false);
      return 'done';
    });

    expect(result).toBe('done');
    expect(spans[0].ended).toBe(true);
  });

  test('withSpan records and rethrows an async rejection, still ending the span', async () => {
    const { tracer, spans } = makeRecordingTracer();
    setTracer(tracer);
    const err = new Error('async boom');

    await expect(
      withSpan('op', undefined, async () => {
        throw err;
      }),
    ).rejects.toThrow(err);

    expect(spans[0].ended).toBe(true);
    expect(spans[0].exceptions).toEqual([err]);
  });

  test('withSpan uses a per-call tracer override instead of the global one', () => {
    const global = makeRecordingTracer();
    const override = makeRecordingTracer();
    setTracer(global.tracer);

    withSpan('op', undefined, () => 1, override.tracer);

    expect(global.spans).toHaveLength(0);
    expect(override.spans).toHaveLength(1);
  });

  test('span.setAttribute inside the callback is visible on the recorded span', () => {
    const { tracer, spans } = makeRecordingTracer();
    setTracer(tracer);

    withSpan('op', undefined, (span) => {
      span.setAttribute('count', 3);
    });

    expect(spans[0].extraAttributes).toEqual({ count: 3 });
  });
});
