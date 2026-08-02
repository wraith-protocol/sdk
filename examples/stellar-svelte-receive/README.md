# Stellar Svelte receive

A minimal Svelte 5 app that uses `@wraith-protocol/sdk-svelte` to derive a Stellar
stealth meta-address and scan recent on-chain announcements.

```bash
pnpm --filter @wraith-protocol/sdk-svelte build
pnpm --filter @wraith-protocol/example-stellar-svelte-receive dev
```

Set `VITE_STELLAR_SECRET_KEY` to prefill the 64-byte hexadecimal secret, or paste
one in the app. Scanning uses the Stellar deployment configured by the core SDK.
