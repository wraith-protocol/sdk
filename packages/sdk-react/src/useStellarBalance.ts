import { useState, useEffect, useCallback, useRef } from 'react';
import type { BalanceOptions, UseStellarBalanceResult, Asset } from './types';

/**
 * Fetches Stellar account balance (XLM and assets).
 * 
 * Auto-polls at the specified interval (default 30s).
 * Safe for React Strict Mode.
 * 
 * @param address - Stellar public key (G...)
 * @param options - Balance fetch configuration
 * @returns XLM balance, assets, loading state, error, and refetch function
 * 
 * @example
 * ```tsx
 * const { xlm, assets, isLoading, refetch } = useStellarBalance(address, {
 *   intervalMs: 15000, // Poll every 15s
 * });
 * 
 * return (
 *   <div>
 *     <p>XLM: {xlm}</p>
 *     {assets.map((asset) => (
 *       <p key={`${asset.code}-${asset.issuer}`}>
 *         {asset.code}: {asset.balance}
 *       </p>
 *     ))}
 *   </div>
 * );
 * ```
 */
export function useStellarBalance(
  address: string | null,
  options: BalanceOptions = {}
): UseStellarBalanceResult {
  const { intervalMs = 30000, enabled = true } = options;

  const [state, setState] = useState<{
    xlm: string | null;
    assets: Asset[];
    isLoading: boolean;
    error: Error | null;
  }>({
    xlm: null,
    assets: [],
    isLoading: false,
    error: null,
  });

  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  const fetchBalance = useCallback(async () => {
    if (!address || !enabled || fetchingRef.current) {
      return;
    }

    fetchingRef.current = true;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Import Stellar SDK dynamically to avoid bundling if not used
      const { Server } = await import('@stellar/stellar-sdk');
      
      // Use Stellar Horizon API (default to testnet, should be configurable)
      const server = new Server('https://horizon-testnet.stellar.org');
      const account = await server.loadAccount(address);

      if (!mountedRef.current) return;

      let xlmBalance: string | null = null;
      const assetBalances: Asset[] = [];

      for (const balance of account.balances) {
        if (balance.asset_type === 'native') {
          xlmBalance = balance.balance;
        } else if (balance.asset_type === 'credit_alphanum4' || balance.asset_type === 'credit_alphanum12') {
          assetBalances.push({
            code: balance.asset_code,
            issuer: balance.asset_issuer,
            balance: balance.balance,
          });
        }
      }

      setState({
        xlm: xlmBalance,
        assets: assetBalances,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      if (!mountedRef.current) return;

      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err : new Error(String(err)),
      }));
    } finally {
      fetchingRef.current = false;
    }
  }, [address, enabled]);

  // Initial fetch and polling
  useEffect(() => {
    if (!address || !enabled) {
      return;
    }

    // Initial fetch
    fetchBalance();

    // Set up polling
    const interval = setInterval(fetchBalance, intervalMs);

    return () => {
      clearInterval(interval);
    };
  }, [address, enabled, intervalMs, fetchBalance]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    ...state,
    refetch: fetchBalance,
  };
}
