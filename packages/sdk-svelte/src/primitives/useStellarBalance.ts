import { Horizon } from '@stellar/stellar-sdk';
import { readonly, writable } from 'svelte/store';

/** Store primitive for loading an account's native Stellar balance. */
export function useStellarBalance(publicKey: string, rpcUrl = 'https://horizon.stellar.org') {
  const _balance = writable<string | null>(null);
  const _loading = writable(false);

  async function load() {
    if (!publicKey) return;

    _loading.set(true);
    try {
      const account = await new Horizon.Server(rpcUrl).loadAccount(publicKey);
      const nativeBalance = account.balances.find((entry) => entry.asset_type === 'native');
      _balance.set(nativeBalance ? nativeBalance.balance : '0');
    } catch {
      _balance.set('0');
    } finally {
      _loading.set(false);
    }
  }

  void load();

  return {
    balance: readonly(_balance),
    loading: readonly(_loading),
  };
}
