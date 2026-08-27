import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  type ConnectedWallet,
  type ScanState,
  type Settings,
} from './types';

/**
 * Thin typed wrapper over `chrome.storage.local`.
 *
 * `chrome.storage.local` is the right home for this data: it survives service
 * worker restarts (the worker is torn down between alarms) and is scoped to the
 * extension. It is *not* encrypted at rest, which is why we only persist
 * viewing-side material — never a spend secret or mnemonic.
 */

const MAX_DETECTED = 50;

async function get<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function getWallet(): Promise<ConnectedWallet | null> {
  return (await get<ConnectedWallet>(STORAGE_KEYS.wallet)) ?? null;
}

export async function setWallet(wallet: ConnectedWallet): Promise<void> {
  await set(STORAGE_KEYS.wallet, wallet);
}

export async function clearWallet(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEYS.wallet, STORAGE_KEYS.scanState]);
}

export async function getScanState(): Promise<ScanState> {
  return (await get<ScanState>(STORAGE_KEYS.scanState)) ?? { detected: [] };
}

export async function setScanState(state: ScanState): Promise<void> {
  await set(STORAGE_KEYS.scanState, state);
}

/** Prepend detected payments, dedupe by stealth address, and cap the list. */
export async function recordDetected(
  updates: Partial<ScanState>,
  newlyDetected: ScanState['detected'] = [],
): Promise<ScanState> {
  const current = await getScanState();
  const seen = new Set(current.detected.map((d) => d.stealthAddress));
  const merged = [
    ...newlyDetected.filter((d) => !seen.has(d.stealthAddress)),
    ...current.detected,
  ].slice(0, MAX_DETECTED);
  const next: ScanState = { ...current, ...updates, detected: merged };
  await setScanState(next);
  return next;
}

export async function getSettings(): Promise<Settings> {
  const stored = await get<Partial<Settings>>(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(settings: Partial<Settings>): Promise<Settings> {
  const merged = { ...(await getSettings()), ...settings };
  await set(STORAGE_KEYS.settings, merged);
  return merged;
}
