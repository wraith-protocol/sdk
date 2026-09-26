import { getDeployment } from '@wraith-protocol/sdk/chains/stellar';
import { readonly, writable } from 'svelte/store';

/** Store primitive for resolving a Wraith name on Stellar. */
export function useStellarName(name: string | undefined, chain = 'testnet') {
  const _address = writable<string | null>(null);
  const _loading = writable(false);
  const _error = writable<Error | null>(null);

  async function resolve() {
    if (!name) return;

    _loading.set(true);
    _error.set(null);
    try {
      getDeployment(chain);
      // Name resolution remains a placeholder until the core SDK exposes it.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      _address.set(null);
    } catch (cause) {
      _error.set(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      _loading.set(false);
    }
  }

  void resolve();

  return {
    address: readonly(_address),
    loading: readonly(_loading),
    error: readonly(_error),
  };
}
