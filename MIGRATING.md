# Migrating

Concrete migration notes for `@wraith-protocol/sdk` major versions. Each section is a
before/after recipe — not just a description of what changed.

See [CONTRIBUTING.md §2 Deprecation policy](./CONTRIBUTING.md#2-deprecation-policy) for the
lifecycle a deprecation goes through before it lands here.

> This file is curated alongside `CHANGELOG.md`. The changelog answers "what changed?" — this
> file answers "how do I update my code?".

---

## Migrating to 2.0.0 _(unreleased)_

No `2.x` deprecations have shipped yet. When the first deprecation lands in a `1.x` minor, a
subsection appears here with a before/after snippet and a link to the announcing CHANGELOG
entry.

Template for the first entry — kept here so the first contributor doesn't have to invent the
shape:

```md
### `oldFn` → `newFn`

Deprecated in `1.X.0`, removed in `2.0.0`.

**Before:**

\`\`\`ts
import { oldFn } from '@wraith-protocol/sdk/chains/evm';
const x = oldFn(input);
\`\`\`

**After:**

\`\`\`ts
import { newFn } from '@wraith-protocol/sdk/chains/evm';
const x = newFn(input);
\`\`\`

**Why:** one-sentence rationale.
```
