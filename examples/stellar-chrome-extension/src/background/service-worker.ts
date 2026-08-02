import '../lib/buffer-shim';
import { getWallet, getScanState, getSettings, recordDetected } from '../lib/storage';
import { liveScan, scanBatch } from '../lib/scanner';
import { buildTestAnnouncement } from '../lib/test-event';
import { notifyPayment, registerNotificationHandlers } from './notify';
import type { PopupMessage, WorkerResponse, DetectedPayment } from '../lib/types';

/**
 * Background service worker: the whole point of the extension.
 *
 * MV3 workers are ephemeral — Chrome tears them down when idle and revives them
 * on an event. So all durable state lives in `chrome.storage.local`, and the
 * scan cadence is driven by `chrome.alarms` rather than a `setInterval` (which
 * would die with the worker). On each alarm we scan forward from the last
 * ledger and fire a notification per newly detected payment.
 */

const SCAN_ALARM = 'wraith-scan';

registerNotificationHandlers();

// Re-arm the alarm whenever the worker boots (install, update, browser start,
// or wake). createAlarm is idempotent for a given name + period.
chrome.runtime.onInstalled.addListener(() => void ensureAlarm());
chrome.runtime.onStartup.addListener(() => void ensureAlarm());
void ensureAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCAN_ALARM) void runScheduledScan();
});

chrome.runtime.onMessage.addListener((msg: PopupMessage, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  // Return true to keep the message channel open for the async response.
  return true;
});

async function ensureAlarm(): Promise<void> {
  const { scanIntervalMinutes } = await getSettings();
  const existing = await chrome.alarms.get(SCAN_ALARM);
  if (existing && existing.periodInMinutes === scanIntervalMinutes) return;
  await chrome.alarms.create(SCAN_ALARM, {
    periodInMinutes: Math.max(1, scanIntervalMinutes),
    delayInMinutes: 1,
  });
}

/** Handle a popup request and return a serializable response. */
async function handleMessage(msg: PopupMessage): Promise<WorkerResponse> {
  switch (msg.type) {
    case 'get-state': {
      return { ok: true, state: await getScanState(), wallet: await getWallet() };
    }
    case 'scan-now': {
      await runScheduledScan();
      return { ok: true, state: await getScanState(), wallet: await getWallet() };
    }
    case 'fire-test-event': {
      const state = await runTestEvent();
      return { ok: true, state, wallet: await getWallet() };
    }
    case 'disconnect': {
      await chrome.alarms.clear(SCAN_ALARM);
      return { ok: true, state: await getScanState(), wallet: null };
    }
    default:
      return { ok: false, error: `Unknown message: ${(msg as { type: string }).type}` };
  }
}

/** Fetch + scan the live testnet, persist results, and notify on matches. */
async function runScheduledScan(): Promise<void> {
  const wallet = await getWallet();
  if (!wallet) return;

  await ensureAlarm();

  try {
    const prev = await getScanState();
    const result = await liveScan(wallet, prev.lastScannedLedger);
    await onDetected(result.detected, {
      lastScannedLedger: result.latestLedger ?? prev.lastScannedLedger,
      lastScanAt: Date.now(),
      lastError: undefined,
    });
  } catch (err) {
    await recordDetected({
      lastScanAt: Date.now(),
      lastError: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Run the offline canned event through the real scanner + notification path. */
async function runTestEvent() {
  const wallet = await getWallet();
  if (!wallet) throw new Error('Connect a wallet before firing a test event.');

  const announcement = buildTestAnnouncement(wallet);
  const detected = scanBatch(wallet, [announcement]);
  if (detected.length === 0) {
    throw new Error('Test event did not match — wallet keys may be inconsistent.');
  }
  return onDetected(detected, { lastScanAt: Date.now(), lastError: undefined });
}

/** Persist newly detected payments and raise a notification for each. */
async function onDetected(
  detected: DetectedPayment[],
  updates: Partial<Awaited<ReturnType<typeof getScanState>>>,
) {
  const before = await getScanState();
  const known = new Set(before.detected.map((d) => d.stealthAddress));
  const fresh = detected.filter((d) => !known.has(d.stealthAddress));

  const state = await recordDetected(updates, detected);
  for (const payment of fresh) {
    await notifyPayment(payment);
  }
  return state;
}
