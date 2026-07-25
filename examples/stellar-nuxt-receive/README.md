# stellar-nuxt-receive

Minimal Nuxt 3 app demonstrating `@wraith-protocol/sdk-nuxt`.

Composables (`useStellarStealthKeys`, `useStealthMetaAddress`, etc.) are
**auto-imported** — no explicit import statements needed in your components.

## Setup

```bash
pnpm install
pnpm --filter stellar-nuxt-receive dev
```

## SSR notes

The module registers all composables as Nuxt auto-imports and adds the
packages to `build.transpile` so Nitro can tree-shake them on the server.
Crypto operations are synchronous and environment-agnostic; network calls
only run when explicitly invoked, so server rendering is safe by default.

## Adding the module to your own Nuxt app

```bash
npx nuxi module add @wraith-protocol/sdk-nuxt
```

Or manually in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['@wraith-protocol/sdk-nuxt'],
})
```

Composables available without any import:

- `useStellarStealthKeys()`
- `useEvmStealthKeys()`
- `useSolanaStealthKeys()`
- `useStealthMetaAddress()`
- `useWraith(config?)`
