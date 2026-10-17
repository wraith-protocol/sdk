import {
  resolveStellarName,
  type ResolveStellarNameOptions,
} from '@wraith-protocol/sdk/chains/stellar';
import { readonly, writable } from 'svelte/store';

/** Store primitive for resolving a Wraith name on Stellar. */
export function useStellarName(
  name: string | undefined,
  chain = 'testnet',
  options: ResolveStellarNameOptions = {},
) {
  const _address = writable<string | null>(null);
  const _loading = writable(false);
  const _error = writable<Error | null>(null);

  let currentId = 0;
  let activeController: AbortController | null = null;
  let cleanupCallerSignal: (() => void) | null = null;

  function abort(reason?: unknown) {
    currentId += 1;
    cleanupCallerSignal?.();
    cleanupCallerSignal = null;
    if (activeController) {
      activeController.abort(reason);
      activeController = null;
    }
    _loading.set(false);
  }

  async function resolve(
    nextName: string | undefined = name,
    nextChain: string = chain,
    nextOptions: ResolveStellarNameOptions = options,
  ): Promise<string | null> {
    abort();

    if (nextName === undefined) {
      _address.set(null);
      _error.set(null);
      _loading.set(false);
      return null;
    }

    const requestId = ++currentId;
    const controller = new AbortController();
    activeController = controller;

    const callerSignal = nextOptions.signal;
    if (callerSignal) {
      const onCallerAbort = () => controller.abort(callerSignal.reason);
      if (callerSignal.aborted) {
        controller.abort(callerSignal.reason);
      } else {
        callerSignal.addEventListener('abort', onCallerAbort, { once: true });
        cleanupCallerSignal = () => callerSignal.removeEventListener('abort', onCallerAbort);
      }
    }

    _loading.set(true);
    _error.set(null);
    _address.set(null);

    try {
      const resolved = await resolveStellarName(nextName, nextChain, {
        ...nextOptions,
        signal: controller.signal,
      });
      if (requestId === currentId) {
        _address.set(resolved);
      }
      return resolved;
    } catch (cause) {
      const err = cause instanceof Error ? cause : new Error(String(cause));
      if (requestId === currentId) {
        _address.set(null);
        _error.set(err);
      }
      return null;
    } finally {
      if (requestId === currentId) {
        cleanupCallerSignal?.();
        cleanupCallerSignal = null;
        activeController = null;
        _loading.set(false);
      }
    }
  }

  if (name !== undefined) {
    void resolve(name, chain, options);
  }

  return {
    address: readonly(_address),
    loading: readonly(_loading),
    error: readonly(_error),
    resolve,
    abort,
    dispose: abort,
  };
}
