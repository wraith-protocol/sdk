import { describe, expect, test, vi } from 'vitest';
import { WalletNotConnectedError, WalletUnavailableError } from '../../src/errors';
import { watchWalletEvents, type WalletEvent } from '../../src/wallet/events';
import {
  EVM_ACCOUNTS,
  EVM_CHECKSUMMED,
  MockEip1193Provider,
  MockFreighter,
  MockFreighterWatcher,
  MockSolanaWallet,
  SOLANA_KEYS,
  STELLAR_ACCOUNTS,
  STELLAR_NETWORKS,
  FreighterApiInternalError,
  providerRpcError,
} from './providers.fixture';

function collect(): { events: WalletEvent[]; listener: (event: WalletEvent) => void } {
  const events: WalletEvent[] = [];
  return { events, listener: (event) => events.push(event) };
}

/** Events without the error instance, for compact assertions. */
function summary(events: WalletEvent[]): unknown[] {
  return events.map((event) =>
    event.type === 'disconnect' ? { type: event.type, chain: event.chain } : event,
  );
}

describe('watchWalletEvents: EIP-1193', () => {
  test('reports account and chain changes in normalised form', () => {
    const provider = new MockEip1193Provider();
    const { events, listener } = collect();
    watchWalletEvents({ chain: 'evm', provider }, listener);

    provider.emit('connect', { chainId: '0x28751c' });
    provider.setAccounts([EVM_ACCOUNTS[0]]);
    provider.setChain('0x1');
    provider.setAccounts([EVM_ACCOUNTS[1], EVM_ACCOUNTS[0]]);

    expect(events).toEqual([
      { type: 'networkChanged', chain: 'evm', network: 'eip155:2651420' },
      { type: 'accountChanged', chain: 'evm', address: EVM_CHECKSUMMED[0] },
      { type: 'networkChanged', chain: 'evm', network: 'eip155:1' },
      { type: 'accountChanged', chain: 'evm', address: EVM_CHECKSUMMED[1] },
    ]);
  });

  test('drops repeats, including the same account in another letter case', () => {
    const provider = new MockEip1193Provider();
    const { events, listener } = collect();
    watchWalletEvents({ chain: 'evm', provider }, listener);

    provider.setAccounts([EVM_ACCOUNTS[0]]);
    provider.setAccounts([EVM_CHECKSUMMED[0]]);
    provider.setChain('0x1');
    provider.emit('chainChanged', '1');
    provider.emit('connect', { chainId: '0x1' });

    expect(summary(events)).toEqual([
      { type: 'accountChanged', chain: 'evm', address: EVM_CHECKSUMMED[0] },
      { type: 'networkChanged', chain: 'evm', network: 'eip155:1' },
    ]);
  });

  test('treats an empty accountsChanged as a disconnect', () => {
    const provider = new MockEip1193Provider();
    const { events, listener } = collect();
    watchWalletEvents({ chain: 'evm', provider }, listener);

    provider.setAccounts([EVM_ACCOUNTS[0]]);
    provider.setAccounts([]);

    const disconnect = events[1];
    expect(disconnect.type).toBe('disconnect');
    if (disconnect.type !== 'disconnect') return;
    expect(disconnect.error).toBeInstanceOf(WalletNotConnectedError);
    expect(disconnect.error.context).toMatchObject({ chain: 'evm' });
  });

  test('keeps the provider disconnect error, whose code follows CloseEvent', () => {
    const provider = new MockEip1193Provider();
    const { events, listener } = collect();
    watchWalletEvents({ chain: 'evm', provider }, listener);
    const closeError = providerRpcError(1013, 'Try again later');

    provider.emit('disconnect', closeError);
    provider.emit('disconnect', closeError);

    expect(events).toHaveLength(1);
    const [event] = events;
    if (event.type !== 'disconnect') throw new Error('expected a disconnect event');
    expect(event.error.cause).toBe(closeError);
    expect(event.error.context).toMatchObject({
      chain: 'evm',
      providerCode: 1013,
      reason: 'Try again later',
    });
  });

  test('reports the account and network again after reconnecting', () => {
    const provider = new MockEip1193Provider();
    const { events, listener } = collect();
    watchWalletEvents({ chain: 'evm', provider }, listener);

    provider.emit('connect', { chainId: '0x1' });
    provider.setAccounts([EVM_ACCOUNTS[0]]);
    provider.emit('disconnect', providerRpcError(1011, 'Internal error'));
    provider.emit('connect', { chainId: '0x1' });
    provider.setAccounts([EVM_ACCOUNTS[0]]);

    expect(summary(events)).toEqual([
      { type: 'networkChanged', chain: 'evm', network: 'eip155:1' },
      { type: 'accountChanged', chain: 'evm', address: EVM_CHECKSUMMED[0] },
      { type: 'disconnect', chain: 'evm' },
      { type: 'networkChanged', chain: 'evm', network: 'eip155:1' },
      { type: 'accountChanged', chain: 'evm', address: EVM_CHECKSUMMED[0] },
    ]);
  });

  test('ignores malformed payloads', () => {
    const provider = new MockEip1193Provider();
    const listener = vi.fn();
    watchWalletEvents({ chain: 'evm', provider }, listener);

    provider.emit('accountsChanged', 'not-an-array');
    provider.emit('accountsChanged', [42]);
    provider.emit('chainChanged', 'mainnet');
    provider.emit('connect', null);
    provider.emit('connect', {});

    expect(listener).not.toHaveBeenCalled();
  });

  test('passes through account strings that are not EVM addresses', () => {
    const provider = new MockEip1193Provider();
    const { events, listener } = collect();
    watchWalletEvents({ chain: 'evm', provider }, listener);

    provider.emit('accountsChanged', ['not-an-address']);

    expect(events).toEqual([{ type: 'accountChanged', chain: 'evm', address: 'not-an-address' }]);
  });

  test('unsubscribing removes every listener and silences the watcher', () => {
    const provider = new MockEip1193Provider();
    const listener = vi.fn();
    const stop = watchWalletEvents({ chain: 'evm', provider }, listener);

    stop();
    stop();
    provider.setAccounts([EVM_ACCOUNTS[0]]);

    expect(listener).not.toHaveBeenCalled();
    for (const event of ['accountsChanged', 'chainChanged', 'connect', 'disconnect']) {
      expect(provider.listenerCount(event)).toBe(0);
    }
  });
});

describe('watchWalletEvents: Solana wallet-adapter', () => {
  test('reports connect, account switches and disconnect', async () => {
    const wallet = new MockSolanaWallet();
    const { events, listener } = collect();
    watchWalletEvents({ chain: 'solana', wallet }, listener);

    await wallet.connect();
    wallet.switchAccount(SOLANA_KEYS[0]);
    wallet.switchAccount(SOLANA_KEYS[1]);
    await wallet.disconnect();
    await wallet.disconnect();

    expect(summary(events)).toEqual([
      { type: 'accountChanged', chain: 'solana', address: SOLANA_KEYS[0].toBase58() },
      { type: 'accountChanged', chain: 'solana', address: SOLANA_KEYS[1].toBase58() },
      { type: 'disconnect', chain: 'solana' },
    ]);
    const disconnect = events[2];
    if (disconnect.type !== 'disconnect') throw new Error('expected a disconnect event');
    expect(disconnect.error).toBeInstanceOf(WalletNotConnectedError);
  });

  test('accepts base58 strings and ignores unusable keys', () => {
    const wallet = new MockSolanaWallet();
    const { events, listener } = collect();
    watchWalletEvents({ chain: 'solana', wallet }, listener);

    wallet.emit('connect', SOLANA_KEYS[1].toBase58());
    wallet.emit('connect', null);
    wallet.emit('connect', { toBase58: () => 7 });

    expect(events).toEqual([
      { type: 'accountChanged', chain: 'solana', address: SOLANA_KEYS[1].toBase58() },
    ]);
  });

  test('unsubscribing removes the listeners', () => {
    const wallet = new MockSolanaWallet();
    const stop = watchWalletEvents({ chain: 'solana', wallet }, vi.fn());

    stop();

    expect(wallet.listenerCount('connect')).toBe(0);
    expect(wallet.listenerCount('disconnect')).toBe(0);
  });
});

describe('watchWalletEvents: Freighter', () => {
  test('reports the current state on the first poll, then changes', () => {
    const freighter = new MockFreighter();
    freighter.allowed = true;
    const watcher = new MockFreighterWatcher(freighter);
    const { events, listener } = collect();
    watchWalletEvents({ chain: 'stellar', watcher }, listener);

    watcher.poll();
    watcher.poll();
    freighter.networkPassphrase = STELLAR_NETWORKS[1];
    freighter.network = 'PUBLIC';
    watcher.poll();
    freighter.address = STELLAR_ACCOUNTS[1];
    watcher.poll();

    expect(events).toEqual([
      { type: 'networkChanged', chain: 'stellar', network: STELLAR_NETWORKS[0] },
      { type: 'accountChanged', chain: 'stellar', address: STELLAR_ACCOUNTS[0] },
      { type: 'networkChanged', chain: 'stellar', network: STELLAR_NETWORKS[1] },
      { type: 'accountChanged', chain: 'stellar', address: STELLAR_ACCOUNTS[1] },
    ]);
  });

  test('treats an empty address as a disconnect', () => {
    const freighter = new MockFreighter();
    freighter.allowed = true;
    const watcher = new MockFreighterWatcher(freighter);
    const { events, listener } = collect();
    watchWalletEvents({ chain: 'stellar', watcher }, listener);

    watcher.poll();
    freighter.allowed = false;
    watcher.poll();
    freighter.allowed = true;
    watcher.poll();

    expect(summary(events)).toEqual([
      { type: 'networkChanged', chain: 'stellar', network: STELLAR_NETWORKS[0] },
      { type: 'accountChanged', chain: 'stellar', address: STELLAR_ACCOUNTS[0] },
      { type: 'disconnect', chain: 'stellar' },
      { type: 'networkChanged', chain: 'stellar', network: STELLAR_NETWORKS[0] },
      { type: 'accountChanged', chain: 'stellar', address: STELLAR_ACCOUNTS[0] },
    ]);
  });

  test('reports a site without access as disconnected on the first poll', () => {
    const watcher = new MockFreighterWatcher(new MockFreighter());
    const { events, listener } = collect();
    watchWalletEvents({ chain: 'stellar', watcher }, listener);

    watcher.poll();

    expect(summary(events)).toEqual([
      { type: 'disconnect', chain: 'stellar' },
      { type: 'networkChanged', chain: 'stellar', network: STELLAR_NETWORKS[0] },
    ]);
  });

  test('ignores polls that failed', () => {
    const watcher = new MockFreighterWatcher(new MockFreighter());
    const listener = vi.fn();
    watchWalletEvents({ chain: 'stellar', watcher }, listener);

    watcher.pollWithError(FreighterApiInternalError);

    expect(listener).not.toHaveBeenCalled();
  });

  test('throws a normalised error when the watcher cannot start', () => {
    const freighter = new MockFreighter();
    freighter.environment = 'node';
    const watcher = new MockFreighterWatcher(freighter);

    expect(() => watchWalletEvents({ chain: 'stellar', watcher }, vi.fn())).toThrow(
      WalletUnavailableError,
    );
    expect(watcher.stopped).toBe(true);
  });

  test('unsubscribing stops the watcher', () => {
    const freighter = new MockFreighter();
    freighter.allowed = true;
    const watcher = new MockFreighterWatcher(freighter);
    const listener = vi.fn();
    const stop = watchWalletEvents({ chain: 'stellar', watcher }, listener);

    stop();
    watcher.poll();

    expect(watcher.stopped).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('watchWalletEvents: invalid sources', () => {
  test('rejects sources without the required methods', () => {
    expect(() => watchWalletEvents({ chain: 'evm', provider: {} as never }, vi.fn())).toThrow(
      TypeError,
    );
    expect(() => watchWalletEvents({ chain: 'solana', wallet: {} as never }, vi.fn())).toThrow(
      TypeError,
    );
    expect(() => watchWalletEvents({ chain: 'stellar', watcher: {} as never }, vi.fn())).toThrow(
      TypeError,
    );
    expect(() => watchWalletEvents({ chain: 'ckb' } as never, vi.fn())).toThrow(TypeError);
  });
});
