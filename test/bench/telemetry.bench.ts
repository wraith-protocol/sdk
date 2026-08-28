import { bench, describe } from 'vitest';
import { withSpan } from '../../src/telemetry';

const BENCH_OPTIONS = { time: 500 };

function work(x: number): number {
  return x * 2 + 1;
}

describe('telemetry: no-op tracer overhead', () => {
  bench(
    'uninstrumented call',
    () => {
      work(41);
    },
    BENCH_OPTIONS,
  );

  bench(
    'withSpan with the default no-op tracer',
    () => {
      withSpan('bench.op', { a: 1 }, () => work(41));
    },
    BENCH_OPTIONS,
  );
});
