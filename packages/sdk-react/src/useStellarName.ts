import { useState, useEffect, useRef } from 'react';
import type { UseStellarNameResult } from './types';

// Module-level cache for resolved names
const nameCache = new Map<string, string>();

/**
 * Resolves a Stellar name to a stealth meta-address.
 * 
 * Debounces input by 300ms and caches resolutions in module memory.
 * Safe for React Strict Mode.
 * 
 * @param name - The name to resolve (e.g., "alice.stellar")
 * @returns Meta-address, resolving state, and any error
 * 
 * @example
 * ```tsx
 * const [name, setName] = useState('');
 * const { metaAddress, isResolving, error } = useStellarName(name);
 * 
 * return (
 *   <div>
 *     <input value={name} onChange={(e) => setName(e.target.value)} />
 *     {isResolving && <span>Resolving...</span>}
 *     {metaAddress && <span>Address: {metaAddress}</span>}
 *   </div>
 * );
 * ```
 */
export function useStellarName(name: string): UseStellarNameResult {
  const [state, setState] = useState<UseStellarNameResult>({
    metaAddress: null,
    isResolving: false,
    error: null,
  });

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Empty name
    if (!name || name.trim() === '') {
      setState({ metaAddress: null, isResolving: false, error: null });
      return;
    }

    // Check cache first
    const cached = nameCache.get(name);
    if (cached) {
      setState({ metaAddress: cached, isResolving: false, error: null });
      return;
    }

    // Set resolving state
    setState((prev) => ({ ...prev, isResolving: true, error: null }));

    // Debounce resolution
    debounceTimerRef.current = setTimeout(async () => {
      try {
        // TODO: Implement actual name resolution
        // This would call a Stellar name service contract or API
        // For now, we'll simulate with a placeholder
        
        // Simulated resolution (replace with actual implementation)
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        if (!mountedRef.current) return;

        // Placeholder: In real implementation, this would query a name service
        throw new Error('Name resolution not yet implemented. Awaiting name service integration.');
      } catch (err) {
        if (!mountedRef.current) return;

        setState({
          metaAddress: null,
          isResolving: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [name]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return state;
}
