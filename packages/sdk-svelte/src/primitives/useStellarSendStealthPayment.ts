import { readonly, writable } from 'svelte/store';
import {
  buildStealthPayment,
  type BuildStealthPaymentOptions,
} from '@wraith-protocol/sdk/chains/stellar';

/** Store primitive for building Stellar stealth payment transactions. */
export function useStellarSendStealthPayment() {
  const _building = writable(false);
  const _error = writable<Error | null>(null);

  async function build(options: BuildStealthPaymentOptions) {
    _building.set(true);
    _error.set(null);

    try {
      return await buildStealthPayment(options);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      _error.set(error);
      throw cause;
    } finally {
      _building.set(false);
    }
  }

  return {
    building: readonly(_building),
    error: readonly(_error),
    build,
  };
}
