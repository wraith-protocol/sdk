import {
  redactString,
  sanitizeTelemetryAttributes,
  sanitizeTelemetryAttributeValue,
  sanitizeTelemetryException,
} from './redaction';

/**
 * A single unit of traced work, as emitted by a {@link Tracer}.
 *
 * Implementations typically wrap a tracer-specific span object (an
 * OpenTelemetry `Span`, a Sentry span, a Datadog span, ...). SDK call sites
 * never depend on any tracer package directly, only on this shape.
 *
 * Safe telemetry shape guarantee:
 * - `setAttribute(key, value)` receives primitive `string | number | boolean`
 *   values after applying the central secret redaction policy (sensitive keys,
 *   URL credentials, bearer tokens, seeds, signatures, envelopes, and metadata
 *   are replaced with `[REDACTED]`).
 * - `recordException(error)` receives a sanitized `Error` instance containing
 *   only `name`, redacted `message` (and redacted `stack` when present), plus
 *   optional `code`, `docsLink`, and redacted `context` — never raw provider
 *   `cause` chains, auth headers, or private key material.
 */
export interface Span {
  /** Attaches or overwrites one sanitized primitive attribute on the span. */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Records a sanitized `Error` on the span. Does not end the span. */
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
 * User-provided telemetry hooks invoked through {@link withSpan},
 * {@link startSafeSpan}, or {@link createSafeTracer} receive only the
 * documented safe shape: redacted span names, sanitized primitive attributes,
 * and sanitized `Error` instances on `recordException`.
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
 * call sites carry negligible overhead (zero span wrapper allocations, no-op
 * method calls) when nobody has configured tracing.
 */
export const NOOP_TRACER: Tracer = {
  startSpan() {
    return NOOP_SPAN;
  },
};

let globalTracer: Tracer = NOOP_TRACER;

function wrapSafeSpan(rawSpan: Span): Span {
  if (rawSpan === NOOP_SPAN) {
    return NOOP_SPAN;
  }
  let ended = false;
  return {
    setAttribute(key: string, value: string | number | boolean): void {
      if (!key) return;
      rawSpan.setAttribute(key, sanitizeTelemetryAttributeValue(key, value));
    },
    recordException(error: unknown): void {
      rawSpan.recordException(sanitizeTelemetryException(error));
    },
    end(): void {
      if (ended) return;
      ended = true;
      rawSpan.end();
    },
  };
}

/**
 * Wraps a user-provided {@link Tracer} so every span it creates enforces the
 * central secret redaction policy on initial attributes, dynamic attributes,
 * and recorded exceptions.
 */
export function createSafeTracer(tracer: Tracer): Tracer {
  if (tracer === NOOP_TRACER) {
    return NOOP_TRACER;
  }
  return {
    startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span {
      const safeName = redactString(name);
      const safeAttributes = sanitizeTelemetryAttributes(attributes);
      return wrapSafeSpan(tracer.startSpan(safeName, safeAttributes));
    },
  };
}

/**
 * Starts a redacted, safe-shape {@link Span} on `tracer` (or the global tracer
 * when omitted). Returns {@link NOOP_SPAN} with zero allocations when tracing
 * is not configured.
 */
export function startSafeSpan(
  name: string,
  attributes?: Record<string, string | number | boolean>,
  tracer?: Tracer,
): Span {
  const activeTracer = tracer ?? globalTracer;
  if (activeTracer === NOOP_TRACER) {
    return NOOP_SPAN;
  }
  const safeName = redactString(name);
  const safeAttributes = sanitizeTelemetryAttributes(attributes);
  return wrapSafeSpan(activeTracer.startSpan(safeName, safeAttributes));
}

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
 * Initial attributes, `span.setAttribute` calls, and `span.recordException`
 * payloads are automatically sanitized through the central redaction policy
 * before reaching user-provided telemetry hooks.
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
  const activeTracer = tracer ?? globalTracer;
  if (activeTracer === NOOP_TRACER) {
    return fn(NOOP_SPAN);
  }

  const span = startSafeSpan(name, attributes, activeTracer);

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
