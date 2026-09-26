import './popup.css';
import { getSettings } from '../lib/storage';
import { connectWithSignature, parseSignatureHex } from './connect';
import { connectViaDapp } from './freighter';
import type { PopupMessage, WorkerResponse, ScanState, ConnectedWallet } from '../lib/types';

/** Typed wrapper around messaging the service worker. */
function send(msg: PopupMessage): Promise<WorkerResponse> {
  return chrome.runtime.sendMessage(msg);
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

function shortAddr(addr: string): string {
  return addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

function showError(el: HTMLElement, msg: string | null): void {
  el.hidden = msg === null;
  el.textContent = msg ?? '';
}

/** Render either the connect view or the connected view. */
function render(wallet: ConnectedWallet | null, state: ScanState, intervalMin: number): void {
  const connectView = $('connect-view');
  const connectedView = $('connected-view');
  const dot = $('status-dot');

  connectView.hidden = wallet !== null;
  connectedView.hidden = wallet === null;
  dot.classList.toggle('on', wallet !== null);

  if (!wallet) return;

  $('wallet-address').textContent = shortAddr(wallet.address);
  $('interval').textContent = `every ${intervalMin} min`;
  $('last-scan').textContent = state.lastScanAt
    ? new Date(state.lastScanAt).toLocaleTimeString()
    : 'never';
  showError($('scan-error'), state.lastError ?? null);

  const activity = $('activity');
  if (state.detected.length === 0) {
    activity.innerHTML = '<li class="empty">No payments detected yet.</li>';
  } else {
    activity.innerHTML = '';
    for (const p of state.detected) {
      const li = document.createElement('li');
      const addr = document.createElement('div');
      addr.className = 'addr';
      addr.textContent = p.stealthAddress;
      li.appendChild(addr);
      if (p.memo) {
        const memo = document.createElement('div');
        memo.className = 'memo';
        memo.textContent = p.memo;
        li.appendChild(memo);
      }
      activity.appendChild(li);
    }
  }
}

let intervalMin = 5;

async function refresh(): Promise<void> {
  const res = await send({ type: 'get-state' });
  if (!res.ok) return;
  render(res.wallet ?? null, res.state ?? { detected: [] }, intervalMin);
}

function withBusy<T>(button: HTMLButtonElement, fn: () => Promise<T>): Promise<T> {
  button.disabled = true;
  return fn().finally(() => {
    button.disabled = false;
  });
}

async function init(): Promise<void> {
  intervalMin = (await getSettings()).scanIntervalMinutes;

  // Manual connect
  $('connect-manual').addEventListener('click', () =>
    withBusy($('connect-manual') as HTMLButtonElement, async () => {
      showError($('connect-error'), null);
      try {
        const address = ($('address') as HTMLInputElement).value.trim();
        const sigHex = ($('signature') as HTMLTextAreaElement).value;
        if (!address.startsWith('G')) throw new Error('Enter a valid Stellar address (G…).');
        const signature = parseSignatureHex(sigHex);
        await connectWithSignature(address, signature);
        await refresh();
      } catch (err) {
        showError($('connect-error'), err instanceof Error ? err.message : String(err));
      }
    }),
  );

  // Freighter connect via demo dApp connector
  $('connect-freighter').addEventListener('click', () =>
    withBusy($('connect-freighter') as HTMLButtonElement, async () => {
      showError($('connect-error'), null);
      try {
        const { dappUrl } = await getSettings();
        const { address, signature } = await connectViaDapp(dappUrl);
        await connectWithSignature(address, signature);
        await refresh();
      } catch (err) {
        showError($('connect-error'), err instanceof Error ? err.message : String(err));
      }
    }),
  );

  $('scan-now').addEventListener('click', () =>
    withBusy($('scan-now') as HTMLButtonElement, async () => {
      await send({ type: 'scan-now' });
      await refresh();
    }),
  );

  $('test-event').addEventListener('click', () =>
    withBusy($('test-event') as HTMLButtonElement, async () => {
      const res = await send({ type: 'fire-test-event' });
      if (!res.ok) showError($('scan-error'), res.error);
      await refresh();
    }),
  );

  $('disconnect').addEventListener('click', async () => {
    await send({ type: 'disconnect' });
    // Clearing storage happens worker-side for scan state; clear wallet too.
    await chrome.storage.local.remove(['wallet', 'scanState']);
    await refresh();
  });

  await refresh();
}

void init();
