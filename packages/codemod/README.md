# @wraith-protocol/codemod

Codemods that automate the mechanical parts of migrating an app across
`@wraith-protocol/sdk` major versions -- so upgrading doesn't mean
grep-and-sed by hand.

## Usage

```bash
npx @wraith-protocol/codemod <version> [path] [options]
```

- `version` -- which transform set to run (currently `v1`), matching a folder
  under [`transforms/`](./transforms).
- `path` -- file or directory to transform. Defaults to the current directory.

```bash
# Preview the diff without writing anything
npx @wraith-protocol/codemod v1 ./src --dry --print

# Apply it
npx @wraith-protocol/codemod v1 ./src
```

It's safe to run more than once: every transform in this package is
idempotent, and files that don't match a known pattern are left untouched.

### Options

| Flag           | Description                                                                   |
| -------------- | ----------------------------------------------------------------------------- |
| `--dry`        | Run without writing any changes to disk.                                      |
| `--print`      | Print transformed output to stdout.                                           |
| `--extensions` | Comma-separated file extensions to process. Defaults to `ts,tsx,js,jsx`.      |
| `--ignore`     | Glob to skip. Can be passed more than once. `node_modules` is always ignored. |

## What `v1` covers

Each transform in `transforms/v1/` corresponds to one breaking change
documented in [`MIGRATING.md`](../../MIGRATING.md):

- **`typed-error-catch.cjs`** -- rewrites `catch (e) { if (e.message.includes('...')) }`
  message-matching into `e instanceof <TypedError>` checks, against a table of
  known, stable message fragments sourced directly from `src/errors.ts`. It
  also adds/merges the required named import from `@wraith-protocol/sdk`.
  Only recognized fragments are rewritten -- anything else is left alone.

- **`install-react-native-polyfills.cjs`** -- detects React Native entry
  files (files importing from both `react-native` and `@wraith-protocol/sdk`)
  and inserts the now-required `installReactNativePolyfills()` call and
  import, if one isn't already present.

Every transform has a fixture pair under [`fixtures/`](./fixtures) (an
`input.*` / `output.*` file), plus a `no-op-file` fixture used to confirm each
transform leaves non-matching code untouched. See [`test/`](./test) for the
snapshot-style tests that run each transform against its fixtures, plus an
end-to-end test that runs the same jscodeshift `Runner` the CLI uses against
a temp fixture app and checks idempotency across two full passes.

## Programmatic API

```ts
import { runCodemod, listTransformSets, listTransforms } from '@wraith-protocol/codemod';

const results = await runCodemod({ version: 'v1', target: './src' });
```

## Adding a transform for a future major version

1. Create `transforms/v<N>/your-transform.cjs`, exporting a standard
   jscodeshift transform function (`module.exports = function (fileInfo, api, options) { ... }`).
2. Add an `input.*` / `output.*` fixture pair under
   `fixtures/your-transform-name/`.
3. Add a test in `test/` asserting the transform matches the fixture output
   and is idempotent when run against its own output a second time.
4. Document the change in the root `MIGRATING.md`, and link to it from the
   "Automated Migration" section at the top.
