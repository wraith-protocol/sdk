/**
 * A single unit of traced work, as emitted by a {@link Tracer}.
 *
 * Implementations typically wrap a tracer-specific span object (an
 * OpenTelemetry `Span`, a Sentry span, a Datadog span, ...). SDK call sites
 * never depend on any tracer package directly, only on this shape.
 */
export interface Span {
  /** Attaches or overwrites one attribute on the span. */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Records an exception on the span. Does not end the span. */
  recordException(error: unknown): void;
  /** Ends the span. Call exactly once, regardless of success or failure. */
  end(): void;
}

/**
 * Pluggable tracer interface instrumented SDK call sites use to create spans.
 *
 * Adapt any tracing library (OpenTelemetry, Sentry, Datadog, a custom logger)
 * to this shape and pass it to {@link setTracer}, or as a per-call `tracer`
 * option on an instrumented function — the SDK has no runtime dependency on
 * any specific tracing package.
 *
 * @see {@link setTracer}
 * @see {@link NOOP_TRACER}
 *
 * @example
 * ```ts
 * import { setTracer, type Tracer, type Span } from '@wraith-protocol/sdk';
 * import { trace, type Span as OtelSpan } from '@opentelemetry/api';
 *
 * const otelTracer = trace.getTracer('wraith-sdk');
 *
 * const tracer: Tracer = {
 *   startSpan(name, attributes) {
 *     const otelSpan: OtelSpan = otelTracer.startSpan(name, { attributes });
 *     const span: Span = {
 *       setAttribute: (key, value) => void otelSpan.setAttribute(key, value),
 *       recordException: (error) => void otelSpan.recordException(error as Error),
 *       end: () => otelSpan.end(),
 *     };
 *     return span;
 *   },
 * };
 *
 * setTracer(tracer);
 * ```
 */
export interface Tracer {
  /** Starts (and returns) a new span. `attributes` seeds its initial attributes. */
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span;
}

const NOOP_SPAN: Span = {
  setAttribute() {},
  recordException() {},
  end() {},
};

/**
 * Tracer that creates no-op spans.
 *
 * This is the default tracer until {@link setTracer} is called, so instrumented
 * call sites carry negligible overhead (one object allocation, no-op method
 * calls) when nobody has configured tracing.
 */
export const NOOP_TRACER: Tracer = {
  startSpan() {
    return NOOP_SPAN;
  },
};

let globalTracer: Tracer = NOOP_TRACER;

/**
 * Sets the tracer instrumented SDK call sites use by default.
 *
 * Pass `null` (or omit) to reset to the no-op tracer. Instrumented functions
 * that accept a `tracer` option override this global for that call only.
 *
 * @see {@link getTracer}
 */
export function setTracer(tracer?: Tracer | null): void {
  globalTracer = tracer ?? NOOP_TRACER;
}

/** Returns the currently configured tracer — the one set via {@link setTracer}, or the no-op tracer. */
export function getTracer(): Tracer {
  return globalTracer;
}

/**
 * Runs `fn` inside a span named `name`, recording any thrown or rejected error
 * and always ending the span exactly once. Instrumented call sites use this so
 * span lifecycle handling isn't duplicated at every call site.
 *
 * `fn` may return a plain value or a promise; either way the span ends when
 * the work finishes (synchronously, or once the returned promise settles).
 *
 * @param tracer Per-call override. Falls back to {@link getTracer} when omitted.
 */
export function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean> | undefined,
  fn: (span: Span) => T,
  tracer?: Tracer,
): T {
  const span = (tracer ?? globalTracer).startSpan(name, attributes);

  let result: T;
  try {
    result = fn(span);
  } catch (err) {
    span.recordException(err);
    span.end();
    throw err;
  }

  if (result instanceof Promise) {
    return result.then(
      (value) => {
        span.end();
        return value;
      },
      (err) => {
        span.recordException(err);
        span.end();
        throw err;
      },
    ) as T;
  }

  span.end();
  return result;
}
