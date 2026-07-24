import { useState, useCallback, useEffect } from 'react';
import {
  deriveStealthKeys,
  deriveStealthKeysFromSigner,
  buildStealthPayment,
  getDeployment,
  type StealthKeys,
  type StellarStealthSigner,
  type BuildStealthPaymentOptions,
} from '@wraith-protocol/sdk/chains/stellar';
import { Horizon } from '@stellar/stellar-sdk';

export { useScanner } from './hooks/useScanner';

/** Hook to generate and manage stealth keys */
export function useStellarStealthKeys() {
  const [keys, setKeys] = useState<StealthKeys | null>(null);

  const generate = useCallback((signature: Uint8Array) => {
    const derived = deriveStealthKeys(signature);
    setKeys(derived);
    return derived;
  }, []);

  const generateFromSigner = useCallback(async (signer: StellarStealthSigner) => {
    const derived = await deriveStealthKeysFromSigner(signer);
    setKeys(derived);
    return derived;
  }, []);

  return { keys, generate, generateFromSigner };
}

/** Hook to send stealth payments */
export function useStellarSendStealthPayment() {
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const build = useCallback(async (options: BuildStealthPaymentOptions) => {
    setBuilding(true);
    setError(null);
    try {
      const result = await buildStealthPayment(options);
      return result;
    } catch (err: any) {
      setError(err);
      throw err;
    } finally {
      setBuilding(false);
    }
  }, []);

  return { building, error, build };
}

/** Hook to get stellar balance */
export function useStellarBalance(publicKey: string, rpcUrl = 'https://horizon.stellar.org') {
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey) return;
    let mounted = true;
    setLoading(true);

    const server = new Horizon.Server(rpcUrl);
    server
      .loadAccount(publicKey)
      .then((acc) => {
        if (!mounted) return;
        const xlmBalance = acc.balances.find((b: any) => b.asset_type === 'native');
        setBalance(xlmBalance ? xlmBalance.balance : '0');
      })
      .catch(() => {
        if (mounted) setBalance('0');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [publicKey, rpcUrl]);

  return { balance, loading };
}

/** Hook to resolve a Wraith name on Stellar */
export function useStellarName(name: string | undefined, chain = 'testnet') {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!name) return;
    let mounted = true;

    async function resolve() {
      setLoading(true);
      setError(null);
      try {
        const deployment = getDeployment(chain);
        // Stub for resolving name using the names contract.
        // Integrators will fill in with actual logic if they need it,
        // or this can be updated once the resolve logic is added to the SDK.
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!mounted) return;
        setAddress(null); // Return null or resolved meta-address
      } catch (err: any) {
        if (mounted) setError(err);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    resolve();
    return () => {
      mounted = false;
    };
  }, [name, chain]);

  return { address, loading, error };
}
