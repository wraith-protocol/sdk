import React from 'react';
import {
  useStellarStealthKeys,
  useStellarBalance,
  useStellarName,
} from '@wraith-protocol/sdk-react';

function App() {
  const { keys, generate } = useStellarStealthKeys();
  const { balance, loading: balLoading } = useStellarBalance(
    'GAXPQRUTZQOXGBF3NBBWY43K5YUTYMMW3SBRV3L4YJ6ZJWWX4VHYQQX4',
  );
  const { address, loading: nameLoading } = useStellarName('alice.wraith');

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui' }}>
      <h1>Stellar Stealth App</h1>

      <div style={{ marginBottom: '20px' }}>
        <h2>Stealth Keys</h2>
        <button onClick={() => generate(new Uint8Array(32).fill(1))}>Generate Mock Keys</button>
        {keys && <p style={{ color: 'green' }}>Keys generated successfully!</p>}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h2>Balance</h2>
        <p>Balance: {balLoading ? 'Loading...' : `${balance} XLM`}</p>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h2>Name Resolution</h2>
        <p>alice.wraith resolved address: {nameLoading ? 'Loading...' : address || 'Not found'}</p>
      </div>
    </div>
  );
}

export default App;
