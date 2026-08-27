import { STEALTH_SIGNING_MESSAGE } from '@wraith-protocol/sdk/chains/stellar';
import { hexToBytes } from '../lib/hex';

/**
 * Freighter integration.
 *
 * Freighter injects `window.freighterApi` into regular web pages, not into an
 * extension popup, so we cannot import `@stellar/freighter-api` and call it
 * here directly. Instead we open a tiny connector page served by the demo dApp
 * (which *does* run in a normal tab with Freighter available), have it request
 * the address + a signature over {@link STEALTH_SIGNING_MESSAGE}, and post the
 * result back.
 *
 * This keeps host permissions minimal: the popup never needs access to arbitrary
 * pages, only the connector round-trips through a tab the user already trusts.
 * If the connector is unavailable, the popup's manual path is the fallback.
 */

export interface FreighterConnectResult {
  address: string;
  /** 64-byte signature of STEALTH_SIGNING_MESSAGE. */
  signature: Uint8Array;
}

/** The message the demo dApp connector posts back after signing. */
interface ConnectorPayload {
  source: 'wraith-connector';
  address: string;
  signatureHex: string;
}

/**
 * Ask the demo dApp connector (opened in a tab) to connect Freighter and sign.
 *
 * Resolves when the connector tab posts a valid payload, rejects on timeout or
 * if the user closes the tab. `connectorUrl` should point at the demo dApp's
 * `/connect` route.
 */
export function connectViaDapp(
  connectorUrl: string,
  timeoutMs = 120_000,
): Promise<FreighterConnectResult> {
  return new Promise((resolve, reject) => {
    const message = encodeURIComponent(STEALTH_SIGNING_MESSAGE);
    const url = `${connectorUrl.replace(/\/$/, '')}/connect?message=${message}`;

    let settled = false;
    let tabId: number | undefined;

    const cleanup = () => {
      chrome.runtime.onMessageExternal.removeListener(onExternal);
      clearTimeout(timer);
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (tabId !== undefined) chrome.tabs.remove(tabId).catch(() => undefined);
      fn();
    };

    const onExternal = (msg: unknown) => {
      if (!isConnectorPayload(msg)) return;
      try {
        const signature = hexToBytes(msg.signatureHex);
        finish(() => resolve({ address: msg.address, signature }));
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    };

    chrome.runtime.onMessageExternal.addListener(onExternal);

    const timer = setTimeout(
      () => finish(() => reject(new Error('Freighter connection timed out.'))),
      timeoutMs,
    );

    chrome.tabs.create({ url }).then((tab) => {
      tabId = tab.id;
    });
  });
}

function isConnectorPayload(msg: unknown): msg is ConnectorPayload {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as ConnectorPayload).source === 'wraith-connector' &&
    typeof (msg as ConnectorPayload).address === 'string' &&
    typeof (msg as ConnectorPayload).signatureHex === 'string'
  );
}
