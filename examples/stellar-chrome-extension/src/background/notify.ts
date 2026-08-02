import { getSettings } from '../lib/storage';
import type { DetectedPayment } from '../lib/types';

/**
 * Notification click routing.
 *
 * Each stealth-payment notification is keyed by its notification id, mapped to
 * the stealth address. Clicking opens the demo dApp's activity view for that
 * address. We keep the map in module scope; if the worker is torn down before a
 * click, we fall back to opening the activity view without a deep link.
 */
const notificationTargets = new Map<string, string>();

const NOTIF_PREFIX = 'wraith-payment:';

/** Raise a desktop notification for a newly detected stealth payment. */
export async function notifyPayment(payment: DetectedPayment): Promise<void> {
  const id = `${NOTIF_PREFIX}${payment.stealthAddress}`;
  notificationTargets.set(id, payment.stealthAddress);

  const shortAddr = `${payment.stealthAddress.slice(0, 6)}…${payment.stealthAddress.slice(-6)}`;
  const memoLine = payment.memo ? `\n"${payment.memo}"` : '';

  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'Incoming stealth payment',
    message: `New payment to ${shortAddr}${memoLine}`,
    priority: 2,
  });
}

/** Open the demo dApp activity view for a stealth address. */
async function openActivityView(stealthAddress?: string): Promise<void> {
  const { dappUrl } = await getSettings();
  const base = dappUrl.replace(/\/$/, '');
  const url = stealthAddress
    ? `${base}/activity?address=${encodeURIComponent(stealthAddress)}`
    : `${base}/activity`;
  await chrome.tabs.create({ url });
}

/** Wire up the notification click handler. Call once at worker startup. */
export function registerNotificationHandlers(): void {
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(NOTIF_PREFIX)) return;
    const target = notificationTargets.get(notificationId);
    void openActivityView(target);
    chrome.notifications.clear(notificationId);
  });
}
