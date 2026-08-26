import type { OtelSpanLike, OtelTracerLike } from './otel-adapter';

/**
 * Minimal stand-in for an `@opentelemetry/api` `Tracer`, so this example runs
 * without installing `@opentelemetry/api`. It implements the exact same
 * `startSpan(name, { attributes }) -> { setAttribute, recordException, end }`
 * shape, so swapping it for a real one is a one-line change:
 *
 * ```diff
 * - const otelTracer = createConsoleOtelTracer();
 * + import { trace } from '@opentelemetry/api';
 * + const otelTracer = trace.getTracer('wraith-sdk');
 * ```
 *
 * A real deployment would also install `@opentelemetry/sdk-trace-node` (or
 * `-web`) plus an exporter for wherever spans should end up (console, OTLP
 * collector, Jaeger, ...) and register it before calling `trace.getTracer()`.
 */
export function createConsoleOtelTracer(): OtelTracerLike {
  return {
    startSpan(name, options) {
      const start = performance.now();
      const attributes: Record<string, string | number | boolean> = { ...options?.attributes };

      const span: OtelSpanLike = {
        setAttribute(key, value) {
          attributes[key] = value;
          return span;
        },
        recordException(exception) {
          console.error(`  [span:${name}] exception:`, exception);
        },
        end() {
          const durationMs = performance.now() - start;
          console.log(
            `  [span:${name}] ${durationMs.toFixed(2)}ms attributes=${JSON.stringify(attributes)}`,
          );
        },
      };
      return span;
    },
  };
}
