import { useState } from 'react';
import {
  useStellarStealthKeys,
  useStellarAnnouncementScan,
  useStellarBalance,
} from '@wraith-protocol/sdk-react';
import { encodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';
import type { HexString } from '@wraith-protocol/sdk/chains/stellar';

export default function App() {
  const [signature, setSignature] = useState<HexString | null>(null);

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Wraith Protocol - Stellar Stealth Addresses</h1>
      
      <SignatureInput onSignature={setSignature} />
      
      {signature && (
        <>
          <KeysDisplay signature={signature} />
          <PaymentScanner signature={signature} />
        </>
      )}
    </div>
  );
}

function SignatureInput({ onSignature }: { onSignature: (sig: HexString) => void }) {
  const [input, setInput] = useState('');

  const handleGenerate = () => {
    // Generate a mock signature for demo purposes
    const mockSig = '0x' + Array(128).fill('0').map((_, i) => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('') as HexString;
    
    setInput(mockSig);
    onSignature(mockSig);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.startsWith('0x') && input.length === 130) {
      onSignature(input as HexString);
    }
  };

  return (
    <section style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #ccc' }}>
      <h2>1. Connect Wallet</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0x... (128 hex chars)"
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        />
        <button type="submit" style={{ marginRight: '0.5rem' }}>
          Use Signature
        </button>
        <button type="button" onClick={handleGenerate}>
          Generate Mock Signature
        </button>
      </form>
      <p style={{ fontSize: '0.875rem', color: '#666' }}>
        In production, this would be a wallet signature from Freighter or another Stellar wallet.
      </p>
    </section>
  );
}

function KeysDisplay({ signature }: { signature: HexString }) {
  const { keys, isReady, error } = useStellarStealthKeys(signature);

  if (error) {
    return (
      <section style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #f00' }}>
        <h2>Error</h2>
        <p style={{ color: '#f00' }}>{error.message}</p>
      </section>
    );
  }

  if (!isReady) {
    return (
      <section style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #ccc' }}>
        <h2>2. Deriving Keys...</h2>
      </section>
    );
  }

  const metaAddress = encodeStealthMetaAddress(keys!.spendingPubKey, keys!.viewingPubKey);

  return (
    <section style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #0a0' }}>
      <h2>2. Stealth Keys Ready ✓</h2>
      <div style={{ marginTop: '1rem' }}>
        <strong>Your Stealth Meta-Address:</strong>
        <pre style={{ 
          background: '#f5f5f5', 
          padding: '0.5rem', 
          overflow: 'auto',
          fontSize: '0.75rem'
        }}>
          {metaAddress}
        </pre>
        <p style={{ fontSize: '0.875rem', color: '#666' }}>
          Share this address to receive stealth payments. Each payment generates a unique one-time address.
        </p>
      </div>
    </section>
  );
}

function PaymentScanner({ signature }: { signature: HexString }) {
  const { keys } = useStellarStealthKeys(signature);
  const { matches, isScanning, lastScanAt, error, refetch } = useStellarAnnouncementScan(keys, {
    intervalMs: 60000,
  });

  const [selectedMatch, setSelectedMatch] = useState<number | null>(null);

  return (
    <section style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #ccc' }}>
      <h2>3. Scan for Payments</h2>
      
      <div style={{ marginBottom: '1rem' }}>
        <button onClick={refetch} disabled={isScanning}>
          {isScanning ? 'Scanning...' : 'Scan Now'}
        </button>
        {lastScanAt && (
          <span style={{ marginLeft: '1rem', fontSize: '0.875rem', color: '#666' }}>
            Last scan: {lastScanAt.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <p style={{ color: '#f00' }}>Error: {error.message}</p>
      )}

      <div>
        <strong>Found {matches.length} payment(s)</strong>
        {matches.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            {matches.map((match, idx) => (
              <div
                key={idx}
                style={{
                  padding: '0.75rem',
                  marginBottom: '0.5rem',
                  background: selectedMatch === idx ? '#e3f2fd' : '#f5f5f5',
                  cursor: 'pointer',
                  borderRadius: '4px',
                }}
                onClick={() => setSelectedMatch(selectedMatch === idx ? null : idx)}
              >
                <div style={{ fontWeight: 'bold' }}>
                  Payment #{idx + 1}
                </div>
                <div style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
                  Stealth Address: {match.stealthAddress.slice(0, 20)}...
                </div>
                {selectedMatch === idx && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
                    <div>Caller: {match.caller}</div>
                    <div>Ephemeral Key: {match.ephemeralPubKey.slice(0, 20)}...</div>
                    <BalanceDisplay address={match.stealthAddress} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function BalanceDisplay({ address }: { address: string }) {
  const { xlm, assets, isLoading, error } = useStellarBalance(address, {
    intervalMs: 30000,
  });

  if (isLoading) return <div>Loading balance...</div>;
  if (error) return <div style={{ color: '#f00' }}>Balance error: {error.message}</div>;

  return (
    <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#fff' }}>
      <strong>Balance:</strong>
      <div>XLM: {xlm || '0'}</div>
      {assets.map((asset) => (
        <div key={`${asset.code}-${asset.issuer}`}>
          {asset.code}: {asset.balance}
        </div>
      ))}
    </div>
  );
}
