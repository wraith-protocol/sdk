import { defineManifest } from '@crxjs/vite-plugin';

/**
 * MV3 manifest for the Wraith standalone stealth-payment scanner.
 *
 * Permission rationale (kept intentionally minimal — see README):
 * - `storage`       persist the connected viewing key material + scan cursor.
 * - `alarms`        drive the background scan schedule from the service worker.
 * - `notifications` raise a desktop notification on an incoming stealth payment.
 *
 * `host_permissions` are scoped to the exact Stellar testnet RPC + Horizon
 * hosts the scanner talks to. No `<all_urls>`, no wildcard origins.
 * Opening the demo dApp on a notification click uses `chrome.tabs.create`,
 * which needs no extra permission.
 */
export default defineManifest({
  manifest_version: 3,
  name: 'Wraith Stealth Scanner',
  description: 'Scans Stellar in the background and notifies you of incoming stealth payments.',
  version: '0.1.0',
  minimum_chrome_version: '110',
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Wraith Stealth Scanner',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  permissions: ['storage', 'alarms', 'notifications'],
  host_permissions: [
    'https://soroban-testnet.stellar.org/',
    'https://horizon-testnet.stellar.org/',
  ],
  // Scoped to the single demo dApp origin so its /connect page can post the
  // Freighter signature back via chrome.runtime.sendMessage. Not a wildcard —
  // change this to your own dApp origin if you fork the demo. See README.
  externally_connectable: {
    matches: ['https://demo.wraith.dev/*'],
  },
});
