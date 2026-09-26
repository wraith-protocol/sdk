# Stellar Next.js App Router

A minimal Next.js App Router app that demonstrates `@wraith-protocol/sdk-react` hooks used
correctly alongside React Server Components.

## What this proves

`@wraith-protocol/sdk-react` ships a `"use client"` pragma on its hooks module, so:

- `app/layout.tsx` and `app/page.tsx` are ordinary Server Components — they render on the
  server and contain no hook calls.
- `app/components/StealthDashboard.tsx` is the client boundary: it's the first module in the
  tree to call a hook (`useStellarStealthKeys`, `useStellarBalance`, `useStellarName`), so it
  carries the `"use client"` directive itself.
- `next build` succeeds without the "you're importing a component that needs `useState`" error
  that Next.js raises when a Server Component tree reaches a hook-using module with no client
  boundary in between.

## Usage

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev
```

## Build

```bash
npm run build
npm run start
```

A successful `npm run build` is the regression check for SSR-safety: it fails if
`@wraith-protocol/sdk-react` ever reaches for `window`/`document` at module load, or drops the
`"use client"` marker from its published output.
