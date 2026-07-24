# `@wraith-protocol/sdk/chains/stellar`

Stellar stealth address crypto primitives, announcement scanning, and transaction
helpers for the Wraith stealth address protocol.

## Log redaction

Scanner debug logs can leak meta-addresses, tx hashes, and other Stellar
identifiers. When a user shares a bug report or a test failure, that log text
leaks scan context along with it. `redact()` strips those identifiers out
before you share anything.

```typescript
import { redact } from '@wraith-protocol/sdk/chains/stellar';

redact(`scanning st:xlm:${spendingHex}${viewingHex} against tx ${txHash}`);
// => "scanning [redact:meta:3f1a9c02de] against tx [redact:hash:8b6e21a4f0]"
```

`redact()` recognizes:

- Stealth meta-addresses (`st:xlm:...`)
- Stellar strkeys: accounts (`G...`), secret seeds (`S...`), Soroban contract
  IDs (`C...`), pre-auth tx hashes (`T...`), hashx signers (`X...`), and
  liquidity pool IDs (`L...`)
- Muxed accounts (`M...`)
- 32-byte hex blobs — transaction hashes, ephemeral public keys, wasm hashes

Each identifier is replaced with a pseudonym derived by hashing the identifier
itself, so the same value always redacts to the same alias — you can still
tell that two log lines reference the same address without either line
revealing what that address is. There's no lookup table and no shared state,
so this holds across calls and across processes.

`redact()` is a plain function with no side effects: it is never called
automatically by SDK code, so production logs are unaffected unless you call
it yourself.

### Redacting Vitest output

`RedactingReporter` wires `redact()` into a project's own test run so failure
output — error messages, stack traces, diffs, and captured `console.log`
output — is redacted by default:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { RedactingReporter } from '@wraith-protocol/sdk/chains/stellar';

export default defineConfig({
  test: {
    reporters: [new RedactingReporter(), 'default'],
  },
});
```

List `RedactingReporter` **before** your output reporter (`'default'`,
`'verbose'`, etc.) — reporters run in array order, and redaction has to run
before the identifiers are printed. `RedactingReporter` does not import
`vitest` itself; it only relies on the shape of the objects Vitest passes to
reporter hooks, so it has no runtime dependency on the `vitest` package.
