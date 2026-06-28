import { useState, useCallback } from 'react';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  bytesToHex,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/stellar';

type Keys = ReturnType<typeof deriveStealthKeys>;

function parseHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
}

export default function App() {
  const [input, setInput] = useState(() => import.meta.env.VITE_STELLAR_SECRET_KEY ?? '');
  const [keys, setKeys] = useState<Keys | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDerive = useCallback(() => {
    setError(null);
    setKeys(null);
    const trimmed = input.trim();
    if (!trimmed) {
      setError('Please enter a secret key.');
      return;
    }
    const bytes = parseHex(trimmed);
    if (!bytes) {
      setError('Invalid hex string. Must be even-length hex.');
      return;
    }
    if (bytes.length !== 64) {
      setError(`Expected 64 bytes, got ${bytes.length}.`);
      return;
    }
    try {
      const derived = deriveStealthKeys(bytes);
      setKeys(derived);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Key derivation failed.');
    }
  }, [input]);

  const metaAddress = keys && encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Wraith Stellar — Receive Stealth Payments</h1>
      <p>
        Enter your 64-byte hex secret key (the raw input to <code>deriveStealthKeys</code>) to
        derive your stealth keys and meta-address. Share the meta-address with senders.
      </p>

      <section style={{ margin: '24px 0' }}>
        <label htmlFor="secret" style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
          Secret Key (hex, 64 bytes)
        </label>
        <textarea
          id="secret"
          rows={3}
          style={{ width: '100%', fontFamily: 'monospace', padding: 8 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="aa... (128 hex chars)"
        />
        <button
          onClick={handleDerive}
          style={{ marginTop: 8, padding: '8px 24px', cursor: 'pointer' }}
        >
          Derive Stealth Keys
        </button>
      </section>

      {error && (
        <section style={{ color: '#c00', margin: '16px 0' }}>
          <strong>Error:</strong> {error}
        </section>
      )}

      {keys && (
        <section
          style={{
            background: '#f5f5f5',
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: 16,
            margin: '16px 0',
          }}
        >
          <h2>Your Stealth Keys</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Spending Secret Key', bytesToHex(keys.spendingKey)],
                ['Spending Public Key', bytesToHex(keys.spendingPubKey)],
                ['Viewing Secret Key', bytesToHex(keys.viewingKey)],
                ['Viewing Public Key', bytesToHex(keys.viewingPubKey)],
                ['Spending Scalar', keys.spendingScalar.toString()],
              ].map(([label, val]) => (
                <tr key={label}>
                  <td style={{ padding: '6px 8px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {label}
                  </td>
                  <td
                    style={{
                      padding: '6px 8px',
                      fontFamily: 'monospace',
                      fontSize: 13,
                      wordBreak: 'break-all',
                    }}
                  >
                    {val}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {metaAddress && (
            <div style={{ marginTop: 16 }}>
              <strong>Stealth Meta-Address</strong>
              <pre
                style={{
                  background: '#fff',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  padding: 12,
                  marginTop: 6,
                  overflow: 'auto',
                  userSelect: 'all',
                  cursor: 'pointer',
                }}
                onClick={() => navigator.clipboard.writeText(metaAddress)}
                title="Click to copy"
              >
                {metaAddress}
              </pre>
              <p style={{ fontSize: 13, color: '#666' }}>
                Click the meta-address above to copy it. Share this with anyone who wants to send
                you stealth payments.
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
