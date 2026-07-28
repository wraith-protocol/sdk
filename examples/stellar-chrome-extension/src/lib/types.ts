/** Shared message + storage types for the standalone scanner. */

/**
 * Viewing key material persisted after the user connects once.
 *
 * We store only what the scanner needs to *detect* payments — the viewing key,
 * the spending public key, and the spending scalar (needed to derive the
 * one-time private scalar for a match). No mnemonic or root secret is kept.
 * Everything is hex-encoded for `chrome.storage.local` (JSON-only) transport.
 */
export interface ConnectedWallet {
  /** Stellar public address (G...) the user connected. */
  address: string;
  /** 32-byte viewing seed, hex. */
  viewingKeyHex: string;
  /** 32-byte viewing public key, hex. */
  viewingPubKeyHex: string;
  /** 32-byte spending public key, hex. */
  spendingPubKeyHex: string;
  /** Spending scalar as a decimal string (bigint is not JSON-safe). */
  spendingScalar: string;
  /** When the wallet was connected (epoch ms). */
  connectedAt: number;
}

/** A stealth payment the scanner has already surfaced, kept for the activity list. */
export interface DetectedPayment {
  stealthAddress: string;
  ephemeralPubKey: string;
  ledger?: number;
  memo?: string;
  detectedAt: number;
}

/** Persisted scan state. */
export interface ScanState {
  /** Highest ledger already scanned, so each run only looks forward. */
  lastScannedLedger?: number;
  /** Epoch ms of the last completed scan. */
  lastScanAt?: number;
  /** Last error message, if the previous scan failed. */
  lastError?: string;
  /** Rolling list of detected payments (most recent first, capped). */
  detected: DetectedPayment[];
}

/** User-tunable settings. */
export interface Settings {
  /** Minutes between background scans. */
  scanIntervalMinutes: number;
  /** Base URL of the demo dApp opened from a notification. */
  dappUrl: string;
}

export const STORAGE_KEYS = {
  wallet: 'wallet',
  scanState: 'scanState',
  settings: 'settings',
} as const;

export const DEFAULT_SETTINGS: Settings = {
  scanIntervalMinutes: 5,
  dappUrl: 'https://demo.wraith.dev',
};

/** Messages the popup sends to the service worker. */
export type PopupMessage =
  | { type: 'scan-now' }
  | { type: 'fire-test-event' }
  | { type: 'get-state' }
  | { type: 'disconnect' };

export type WorkerResponse =
  | { ok: true; state?: ScanState; wallet?: ConnectedWallet | null }
  | { ok: false; error: string };
