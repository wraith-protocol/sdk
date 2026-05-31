import { useState, useEffect, useRef } from 'react';
import { deriveStealthKeys } from '@wraith-protocol/sdk/chains/stellar';
import type { HexString } from '@wraith-protocol/sdk/chains/stellar';
import type { UseStellarStealthKeysResult } from './types';

/**
 * Derives stealth keys from a wallet signature.
 * 
 * Memoizes the result and only re-derives when the signature changes.
 * Safe for React Strict Mode (no double derivation).
 * 
 * @param signature - 64-byte ed25519 signature as hex string (with 0x prefix)
 * @returns Stealth keys, ready state, and any error
 * 
 * @example
 * ```tsx
 * const { keys, isReady, error } = useStellarStealthKeys(signature);
 * 
 * if (!isReady) return <div>Deriving keys...</div>;
 * if (error) return <div>Error: {error.message}</div>;
 * 
 * return <div>Keys ready!</div>;
 * ```
 */
export function useStellarStealthKeys(signature: HexString | null): UseStellarStealthKeysResult {
  const [state, setState] = useState<UseStellarStealthKeysResult>({
    keys: null,
    isReady: false,
    error: null,
  });

  const lastSignatureRef = useRef<HexString | null>(null);
  const derivingRef = useRef(false);

  useEffect(() => {
    // No signature provided
    if (!signature) {
      setState({ keys: null, isReady: false, error: null });
      lastSignatureRef.current = null;
      return;
    }

    // Same signature, no need to re-derive
    if (signature === lastSignatureRef.current && state.keys) {
      return;
    }

    // Prevent double derivation in Strict Mode
    if (derivingRef.current) {
      return;
    }

    derivingRef.current = true;
    lastSignatureRef.current = signature;

    try {
      // Remove 0x prefix and convert to Uint8Array
      const sigHex = signature.slice(2);
      if (sigHex.length !== 128) {
        throw new Error(`Expected 64-byte signature (128 hex chars), got ${sigHex.length}`);
      }

      const sigBytes = new Uint8Array(
        sigHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
      );

      const keys = deriveStealthKeys(sigBytes);

      setState({ keys, isReady: true, error: null });
    } catch (err) {
      setState({
        keys: null,
        isReady: false,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    } finally {
      derivingRef.current = false;
    }
  }, [signature, state.keys]);

  return state;
}
