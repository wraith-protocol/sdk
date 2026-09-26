# Observability

## Background

Production users running the SDK inside a long-lived Node service (indexers, notification
workers, agent backends) want spans on scanning, RPC calls, key derivation, and agent tool
calls — without the SDK pulling in a specific tracing package. `src/telemetry.ts` defines a
minimal `Tracer`/`Span` interface that any tracer (OpenTelemetry, Sentry, Datadog, a custom
logger) can implement, and instrumented call sites use it internally.

The SDK has **no runtime dependency on any tracing library**. Nothing is traced until you
call `setTracer()`; until then every span is a no-op (one object allocation, empty method
calls).

## API

### `Tracer` and `Span`

```ts
interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: unknown): void;
  end(): void;
}

interface Tracer {
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span;
}
```

### `setTracer` / `getTracer`

```ts
import { setTracer } from '@wraith-protocol/sdk';

setTracer(myTracer); // configures the global tracer used by instrumented call sites
setTracer(null); // resets to the no-op tracer
```

`setTracer` is exported from the package root (`@wraith-protocol/sdk`) but affects
instrumented call sites in every entry point (`chains/stellar`, the agent client, ...) — they
all import the same underlying telemetry module.

### Per-call overrides

Every instrumented function accepts a `tracer` option that takes precedence over the global
tracer for that one call, without needing a global `setTracer()` first:

```ts
import { deriveStealthKeys } from '@wraith-protocol/sdk/chains/stellar';

const keys = deriveStealthKeys(signature, { tracer: requestScopedTracer });
```

## Instrumented call sites

| Span name                             | Where                                                        | Key attributes                                                                                           |
| ------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `stellar.deriveStealthKeys`           | `deriveStealthKeys()`                                        | `wraith.chain`                                                                                           |
| `stellar.deriveStealthKeysFromSigner` | `deriveStealthKeysFromSigner()`                              | `wraith.chain`                                                                                           |
| `stellar.scan`                        | `scanAnnouncementsStream()` — one span per scan call         | `wraith.chain`, `wraith.scan.window`, `wraith.scan.scanned_count`, `wraith.scan.matched_count`           |
| `stellar.scan.match`                  | Per-match private-scalar derivation ("decrypt")              | `wraith.chain`, `wraith.scan.scheme_id`                                                                  |
| `stellar.rpc.request`                 | `RpcClient.request()` — covers all internal retries/failover | `wraith.rpc.method`, `wraith.rpc.path`, `wraith.rpc.endpoint`, `wraith.rpc.attempt`, `wraith.rpc.status` |
| `agent.tool.sendToMetaAddress`        | `ClaudeAgentTools.sendToMetaAddress()`                       | `wraith.agent.tool`                                                                                      |
| `agent.tool.scan`                     | `ClaudeAgentTools.scan()`                                    | `wraith.agent.tool`, `wraith.scan.candidate_count`                                                       |
| `agent.tool.withdraw`                 | `ClaudeAgentTools.withdraw()`                                | `wraith.agent.tool`                                                                                      |
| `agent.tool.resolveName`              | `ClaudeAgentTools.resolveName()`                             | `wraith.agent.tool`                                                                                      |

Attribute names are stable across releases; new attributes may be added, but existing ones
won't be renamed or removed without a major version bump (see `CONTRIBUTING.md`'s semver
policy).

`stellar.scan` intentionally does **not** create a span per candidate announcement — a cold
scan can touch tens of thousands of announcements, and a span per candidate would dwarf the
cost of the scan itself. Instead it emits one span for the whole call with aggregate counts,
plus a `stellar.scan.match` span for each (comparatively rare) match, which is the actual
"decrypt" step the issue this shipped for was about.

## Adapting a tracer

Any tracer that exposes something shaped like `startSpan(name) -> { setAttribute, end }` can
be wrapped in a few lines. See `examples/otel/` for a full adapter targeting
`@opentelemetry/api`'s `Tracer`/`Span` shape.

## Benchmark

`test/bench/telemetry.bench.ts` compares calling an instrumented function with the default
no-op tracer against calling the un-instrumented body directly, to confirm the no-op path
adds negligible overhead. Run it with:

```bash
pnpm exec vitest bench test/bench/telemetry.bench.ts --run
```
