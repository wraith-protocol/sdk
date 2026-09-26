# OpenTelemetry-shaped tracer adapter

Demonstrates adapting the SDK's minimal `Tracer`/`Span` interface (see `docs/observability.md`)
to something shaped like `@opentelemetry/api`, and shows spans covering an end-to-end scan:
key derivation, generating a stealth address, and scanning a canned announcement batch.

## Why this doesn't depend on `@opentelemetry/api`

`otel-adapter.ts` only needs `@opentelemetry/api`'s `Tracer`/`Span` **shape**
(`startSpan(name, { attributes }) -> { setAttribute, recordException, end }`), so it's
written against local structural types (`OtelTracerLike`/`OtelSpanLike`) instead of importing
the package. A real `@opentelemetry/api` tracer already satisfies that shape, so:

```ts
import { trace } from '@opentelemetry/api';
import { setTracer } from '@wraith-protocol/sdk';
import { createOtelTracerAdapter } from './otel-adapter';

setTracer(createOtelTracerAdapter(trace.getTracer('wraith-sdk')));
```

works with zero changes to `otel-adapter.ts` once you've installed `@opentelemetry/api` (and
an SDK like `@opentelemetry/sdk-trace-node` plus an exporter) in your own app.

`console-otel-tracer.ts` is a tiny stand-in implementing the same shape with `console.log`,
so this example runs standalone without any tracing package installed.

## How it works

1. Wires up `setTracer()` globally with the OTel-shaped adapter.
2. Derives stealth keys (`stellar.deriveStealthKeys` span).
3. Generates a stealth address for itself (pure crypto, not instrumented — no I/O).
4. Scans a single canned announcement through `scanAnnouncementsStream` (`stellar.scan` and
   `stellar.scan.match` spans).

## Usage

```bash
npm start
```

Each line prefixed `[span:...]` is one span the console tracer recorded, with its duration
and attributes.
