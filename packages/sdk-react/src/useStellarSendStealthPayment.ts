import { useState, useCallback } from 'react';
import {
  decodeStealthMetaAddress,
  generateStealthAddress,
} from '@wraith-protocol/sdk/chains/stellar';
import type { UseStellarSendStealthPaymentResult, SendStealthPaymentArgs } from './types';

/**
 * Sends a stealth payment on Stellar.
 * 
 * Returns a send function and declarative state for UI rendering.
 * Does NOT auto-submit — integrator provides their own transaction building.
 * 
 * @returns Send function, status, stealth address, tx hash, error, and reset
 * 
 * @example
 * ```tsx
 * const { send, status, stealthAddress, error, reset } = useStellarSendStealthPayment();
 * 
 * const handleSend = async () => {
 *   await send({
 *     recipientMetaAddress: 'st:stellar:0x...',
 *     amount: '10',
 *   });
 * };
 * 
 * if (status === 'success') {
 *   return <div>Payment sent to {stealthAddress}</div>;
 * }
 * ```
 */
export function useStellarSendStealthPayment(): UseStellarSendStealthPaymentResult {
  const [state, setState] = useState<{
    status: 'idle' | 'preparing' | 'signing' | 'submitting' | 'success' | 'error';
    txHash: string | null;
    stealthAddress: string | null;
    error: Error | null;
  }>({
    status: 'idle',
    txHash: null,
    stealthAddress: null,
    error: null,
  });

  const send = useCallback(async (args: SendStealthPaymentArgs) => {
    setState({
      status: 'preparing',
      txHash: null,
      stealthAddress: null,
      error: null,
    });

    try {
      // Decode recipient meta-address
      const metaAddress = decodeStealthMetaAddress(args.recipientMetaAddress);

      // Generate stealth address
      const { stealthAddress, ephemeralPubKey, viewTag } = generateStealthAddress(
        metaAddress.spendingPubKey,
        metaAddress.viewingPubKey
      );

      setState((prev) => ({
        ...prev,
        status: 'signing',
        stealthAddress,
      }));

      // Note: Actual transaction building and submission is left to the integrator
      // This hook only handles the stealth address generation and state management
      // The integrator should:
      // 1. Build a Stellar transaction sending to stealthAddress
      // 2. Include announcement contract call with ephemeralPubKey and viewTag
      // 3. Sign and submit the transaction
      // 4. Update state with txHash on success

      // For now, we'll throw an error to indicate this needs implementation
      throw new Error(
        'Transaction building not implemented. Integrator must build and submit Stellar transaction.'
      );
    } catch (err) {
      setState({
        status: 'error',
        txHash: null,
        stealthAddress: null,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      txHash: null,
      stealthAddress: null,
      error: null,
    });
  }, []);

  return {
    send,
    ...state,
    reset,
  };
}
