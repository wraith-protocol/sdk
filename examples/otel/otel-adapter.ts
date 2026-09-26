import type { Span, Tracer } from '@wraith-protocol/sdk';

/**
 * Structural shape of `@opentelemetry/api`'s `Span`.
 *
 * Duck-typed on purpose: this example (and the SDK itself) has no dependency
 * on `@opentelemetry/api`. If you've installed the real package, a real
 * `opentelemetry.Span` already satisfies this shape — no adapter-side
 * changes needed.
 */
export interface OtelSpanLike {
  setAttribute(key: string, value: string | number | boolean): unknown;
  recordException(exception: unknown): void;
  end(): void;
}

/** Structural shape of `@opentelemetry/api`'s `Tracer`. */
export interface OtelTracerLike {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean> },
  ): OtelSpanLike;
}

/**
 * Adapts an OpenTelemetry-shaped tracer to the SDK's minimal {@link Tracer} interface.
 *
 * ```ts
 * import { trace } from '@opentelemetry/api';
 * import { setTracer } from '@wraith-protocol/sdk';
 * import { createOtelTracerAdapter } from './otel-adapter';
 *
 * setTracer(createOtelTracerAdapter(trace.getTracer('wraith-sdk')));
 * ```
 */
export function createOtelTracerAdapter(otelTracer: OtelTracerLike): Tracer {
  return {
    startSpan(name, attributes) {
      const otelSpan = otelTracer.startSpan(name, { attributes });
      const span: Span = {
        setAttribute: (key, value) => void otelSpan.setAttribute(key, value),
        recordException: (error) => otelSpan.recordException(error),
        end: () => otelSpan.end(),
      };
      return span;
    },
  };
}
