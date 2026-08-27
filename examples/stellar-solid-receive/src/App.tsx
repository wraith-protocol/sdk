import { createSignal, createMemo, Show, For } from 'solid-js';
import { createStealthKeys, createScanner } from '@wraith-protocol/sdk-solid';
import {
  bytesToHex,
  scanAnnouncements as stellarScanAnnouncements,
  type Announcement,
} from '@wraith-protocol/sdk/chains/stellar';

// Canned announcement fixture — used in dev/demo without a live Horizon node.
const CANNED_ANNOUNCEMENTS: Announcement[] = [];

function parseHex(hex: string): Uint8Array | null {
  const clean = hex.replace(/^0x/i, '').trim();
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) return null;
  return new Uint8Array(clean.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
}

export default function App() {
  const [input, setInput] = createSignal((import.meta as any).env?.VITE_STELLAR_SECRET_KEY ?? '');

  // Primitives
  const stealthKeys = createStealthKeys();
  const scanner = createScanner();

  const metaAddress = createMemo(() => stealthKeys.metaAddress());

  function handleDerive() {
    const bytes = parseHex(input());
    if (!bytes) return;
    if (bytes.length !== 64) return;

    const k = stealthKeys.deriveKeys(bytes);
    stealthKeys.encodeMetaAddress(k.spendingPubKey, k.viewingPubKey);
  }

  function handleScan() {
    const k = stealthKeys.keys();
    if (!k) return;

    // Scan the canned fixture (in a real app, call scanner.scan({ chain: 'testnet' }))
    scanner.match(CANNED_ANNOUNCEMENTS, k.viewingKey, k.spendingPubKey, k.spendingScalar);
  }

  return (
    <main
      style={{ 'max-width': '640px', margin: '40px auto', 'font-family': 'system-ui, sans-serif' }}
    >
      <h1>Wraith Stellar — Receive Stealth Payments (Solid.js)</h1>
      <p>
        Enter your 64-byte hex secret key to derive your stealth keys and meta-address. Share the
        meta-address with senders.
      </p>

      <section style={{ margin: '24px 0' }}>
        <label
          for="secret"
          style={{ display: 'block', 'margin-bottom': '8px', 'font-weight': '600' }}
        >
          Secret Key (hex, 64 bytes)
        </label>
        <textarea
          id="secret"
          rows={3}
          style={{ width: '100%', 'font-family': 'monospace', padding: '8px' }}
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          placeholder="aa... (128 hex chars)"
        />
        <button
          onClick={handleDerive}
          style={{ 'margin-top': '8px', padding: '8px 24px', cursor: 'pointer' }}
          disabled={stealthKeys.loading()}
        >
          Derive Stealth Keys
        </button>
      </section>

      <Show when={stealthKeys.error()}>
        <section style={{ color: '#c00', margin: '16px 0' }}>
          <strong>Error:</strong> {stealthKeys.error()}
        </section>
      </Show>

      <Show when={stealthKeys.keys()}>
        {(k) => (
          <section
            style={{
              background: '#f5f5f5',
              border: '1px solid #ddd',
              'border-radius': '8px',
              padding: '16px',
              margin: '16px 0',
            }}
          >
            <h2>Your Stealth Keys</h2>
            <table style={{ width: '100%', 'border-collapse': 'collapse' }}>
              <tbody>
                <For
                  each={[
                    ['Spending Secret Key', bytesToHex(k().spendingKey)],
                    ['Spending Public Key', bytesToHex(k().spendingPubKey)],
                    ['Viewing Secret Key', bytesToHex(k().viewingKey)],
                    ['Viewing Public Key', bytesToHex(k().viewingPubKey)],
                    ['Spending Scalar', k().spendingScalar.toString()],
                  ]}
                >
                  {([label, val]) => (
                    <tr>
                      <td
                        style={{
                          padding: '6px 8px',
                          'font-weight': '500',
                          'white-space': 'nowrap',
                        }}
                      >
                        {label}
                      </td>
                      <td
                        style={{
                          padding: '6px 8px',
                          'font-family': 'monospace',
                          'font-size': '13px',
                          'word-break': 'break-all',
                        }}
                      >
                        {val}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>

            <Show when={metaAddress()}>
              {(addr) => (
                <div style={{ 'margin-top': '16px' }}>
                  <strong>Stealth Meta-Address</strong>
                  <pre
                    style={{
                      background: '#fff',
                      border: '1px solid #ccc',
                      'border-radius': '4px',
                      padding: '12px',
                      'margin-top': '6px',
                      overflow: 'auto',
                      cursor: 'pointer',
                    }}
                    onClick={() => navigator.clipboard.writeText(addr())}
                    title="Click to copy"
                  >
                    {addr()}
                  </pre>
                  <p style={{ 'font-size': '13px', color: '#666' }}>
                    Click the meta-address to copy it. Share this with anyone who wants to send you
                    stealth payments.
                  </p>
                </div>
              )}
            </Show>

            <button
              onClick={handleScan}
              style={{ 'margin-top': '12px', padding: '8px 24px', cursor: 'pointer' }}
              disabled={scanner.scanning()}
            >
              {scanner.scanning() ? 'Scanning…' : 'Scan for Payments (canned fixture)'}
            </button>
          </section>
        )}
      </Show>

      <Show when={scanner.matched().length > 0}>
        <section
          style={{
            background: '#f0fff0',
            border: '1px solid #bdb',
            'border-radius': '8px',
            padding: '16px',
            margin: '16px 0',
          }}
        >
          <h2>Matched Payments ({scanner.matched().length})</h2>
          <For each={scanner.matched()}>
            {(m) => (
              <div
                style={{ 'margin-bottom': '12px', 'font-family': 'monospace', 'font-size': '13px' }}
              >
                <div>
                  <strong>Stealth Address:</strong> {m.stealthAddress}
                </div>
                <div>
                  <strong>View Tag:</strong> {m.viewTag}
                </div>
              </div>
            )}
          </For>
        </section>
      </Show>

      <Show when={scanner.matched().length === 0 && stealthKeys.keys()}>
        <p style={{ color: '#666', 'font-size': '13px' }}>
          No matched payments found in the canned fixture. In production, call{' '}
          <code>scanner.scan(&#123; chain: 'mainnet' &#125;)</code> against a live Horizon node.
        </p>
      </Show>
    </main>
  );
}
