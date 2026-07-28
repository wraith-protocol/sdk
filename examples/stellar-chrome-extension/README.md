# Wraith Stellar — Standalone Chrome Extension Scanner

A Manifest V3 Chrome extension that scans the Stellar testnet for incoming
**stealth payments** in the background and raises a desktop notification when it
finds one — no webapp tab required. Clicking a notification opens the demo dApp
to that payment's activity view.

It uses `@wraith-protocol/sdk/chains/stellar` for all crypto and announcement
fetching:

- `deriveStealthKeys` — turn a wallet signature into viewing/spending keys
- `fetchAnnouncementsStream` — pull announcements from the Soroban RPC
- `scanAnnouncements` — match announcements against your viewing key
- `generateStealthAddress` — used by the built-in test event

## How it works

```
┌─────────────┐   connect once    ┌────────────────────┐
│   Popup     │ ────────────────▶ │  chrome.storage     │
│ (connect,   │                   │  viewing key +      │
│  status,    │ ◀──── state ───── │  spending pubkey +  │
│  test)      │                   │  spending scalar    │
└─────────────┘                   └─────────┬──────────┘
                                            │ read
                                   ┌────────▼───────────┐   chrome.alarms
                                   │  Service worker    │ ◀── every N min
                                   │  liveScan()        │
                                   │  scanAnnouncements │
                                   └────────┬───────────┘
                                            │ match
                                   ┌────────▼───────────┐
                                   │ chrome.notifications│──click──▶ demo dApp
                                   └────────────────────┘           /activity
```

- **Service worker** (`src/background/service-worker.ts`) is the scanner. MV3
  workers are ephemeral, so state lives in `chrome.storage.local` and the scan
  cadence is driven by `chrome.alarms`, not `setInterval`.
- **Popup** (`src/popup/`) connects a wallet, shows status + recent payments,
  and has **Scan now** and **Fire test event** buttons.

## What is stored

Only viewing-side material is persisted — enough to _detect_ payments, never to
move funds elsewhere:

- viewing key (seed) + viewing public key
- spending **public** key
- spending scalar (needed to derive the one-time private scalar for a match)

The wallet signature used to derive these is discarded after derivation. There
is no mnemonic or root secret in storage.

## Permissions (kept minimal)

| Permission                        | Why                                              |
| --------------------------------- | ------------------------------------------------ |
| `storage`                         | persist viewing key + scan cursor                |
| `alarms`                          | drive the background scan schedule               |
| `notifications`                   | notify on an incoming stealth payment            |
| `host_permissions` (2 exact URLs) | `soroban-testnet` + `horizon-testnet` only       |
| `externally_connectable`          | one exact origin (the demo dApp `/connect` page) |

No `<all_urls>`, no wildcard host permissions, no `tabs` permission (opening a
tab on notification click uses `chrome.tabs.create`, which needs none).

## Build

```bash
# from the repo root — build the SDK once so the file: link resolves
pnpm install
pnpm build

# then build the extension
cd examples/stellar-chrome-extension
npm install
node generate-icons.js   # writes icons/ (also runs fine before every build)
npm run build            # outputs to dist/
```

`npm run dev` rebuilds on change (`vite build --watch`) for iterating while the
extension is loaded.

## Load unpacked in Chrome

1. Run the build above so `dist/` exists.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the
   `examples/stellar-chrome-extension/dist` folder.
5. The Wraith icon appears in the toolbar. Click it to open the popup.

## Connect a wallet

Two paths, both derive the same keys via `deriveStealthKeys`:

- **Connect with Freighter** — opens the demo dApp's `/connect` page in a tab
  (Freighter only injects into normal web pages, not extension popups). The page
  requests your address and a signature over the Wraith signing message, then
  posts it back to the extension. Requires the demo dApp origin listed in
  `externally_connectable` (defaults to `https://demo.wraith.dev`). If you fork
  the demo, update that origin in `manifest.config.ts`.
- **Connect manually** — paste your Stellar address and a 64-byte hex signature
  of `STEALTH_SIGNING_MESSAGE`. Useful for local testing without the dApp.

## Verify the notification (acceptance test)

You do **not** need any on-chain activity to prove notifications work:

1. Connect a wallet (manual is fine — any valid derivation).
2. Click **Fire test event** in the popup.
3. A desktop notification "Incoming stealth payment" fires within a second.

The test event is not faked. `buildTestAnnouncement` runs the real _sender_ side
locally — it generates a one-time stealth address against your own spend/view
keys with `generateStealthAddress`, packs it into the same `Announcement` shape
the RPC yields, and feeds it back through `scanAnnouncements`. The notification
fires because the scanner genuinely matched a payment it could spend.

## Configuration

Settings live in `chrome.storage.local` under `settings` (see
`src/lib/types.ts`):

- `scanIntervalMinutes` — minutes between background scans (default 5)
- `dappUrl` — base URL of the demo dApp opened from a notification
  (default `https://demo.wraith.dev`)

## Files

```
stellar-chrome-extension/
  manifest.config.ts          # MV3 manifest (@crxjs/vite-plugin)
  vite.config.ts              # build + Node polyfills for @stellar/stellar-sdk
  generate-icons.js           # writes icons/ (no deps)
  src/
    background/
      service-worker.ts       # alarms, live scan, test event, notifications
      notify.ts               # notification create + click → open dApp
    popup/
      index.html popup.css popup.ts
      connect.ts              # deriveStealthKeys → store viewing material
      freighter.ts            # connect via demo dApp round-trip
    lib/
      scanner.ts              # scanBatch + liveScan wrappers over the SDK
      test-event.ts           # canned announcement for the connected wallet
      storage.ts types.ts hex.ts
```

## Notes

- Testnet only. Endpoints and contract IDs come from the SDK's `stellar`
  deployment (`getDeployment('stellar')`).
- The SDK link is `file:../..`; build the SDK first (`pnpm build` at the root).
