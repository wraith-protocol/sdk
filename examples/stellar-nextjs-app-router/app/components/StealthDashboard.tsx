'use client';

import {
  useStellarStealthKeys,
  useStellarBalance,
  useStellarName,
} from '@wraith-protocol/sdk-react';

// The parent page (app/page.tsx) is a Server Component. This child is the
// client boundary: it's the first module in the tree that calls a React
// hook, so it — not the page — carries the "use client" pragma.
export default function StealthDashboard() {
  const { keys, generate } = useStellarStealthKeys();
  const { balance, loading: balLoading } = useStellarBalance(
    'GAXPQRUTZQOXGBF3NBBWY43K5YUTYMMW3SBRV3L4YJ6ZJWWX4VHYQQX4',
  );
  const { address, loading: nameLoading } = useStellarName('alice.wraith');

  return (
    <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: 8 }}>
      <section style={{ marginBottom: '20px' }}>
        <h2>Stealth Keys</h2>
        <button onClick={() => generate(new Uint8Array(32).fill(1))}>Generate Mock Keys</button>
        {keys && <p style={{ color: 'green' }}>Keys generated successfully!</p>}
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h2>Balance</h2>
        <p>Balance: {balLoading ? 'Loading...' : `${balance} XLM`}</p>
      </section>

      <section>
        <h2>Name Resolution</h2>
        <p>alice.wraith resolved address: {nameLoading ? 'Loading...' : address || 'Not found'}</p>
      </section>
    </div>
  );
}
