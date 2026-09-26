/**
 * Wallet adapter conformance: the same connect, disconnect, wrong-network,
 * rejection, retry and unavailable scenarios run against the viem, Solana
 * wallet-adapter and Freighter reference adapters. Providers are mocks that
 * reproduce each library's real error and event shapes (see
 * providers.fixture.ts); the viem harness drives a real viem WalletClient over
 * a mock EIP-1193 transport.
 */
import { describe, expect, test } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import { createWalletClient, custom } from 'viem';
import { getDeployment } from '../../src/chains/evm/deployments';
import { deriveStealthKeys as deriveEvmKeys } from '../../src/chains/evm/keys';
import { deriveStealthKeys as deriveSolanaKeys } from '../../src/chains/solana/keys';
import { deriveStealthKeys as deriveStellarKeys } from '../../src/chains/stellar/keys';
import {
  WalletNotConnectedError,
  WalletUnavailableError,
  WalletUserRejectedError,
  WalletWrongNetworkError,
  WraithWalletError,
} from '../../src/errors';
import {
  deriveStealthKeysFromWallet,
  type WalletAdapter,
  type WalletAdapterChain,
} from '../../src/wallet/adapter';
import { FreighterWalletAdapter } from '../../src/wallet/adapters/freighter';
import { SolanaWalletAdapter } from '../../src/wallet/adapters/solana';
import { ViemWalletAdapter, type ViemWalletClient } from '../../src/wallet/adapters/viem';
import { normalizeWalletError, withNormalizedWalletErrors } from '../../src/wallet/errors';
import {
  watchWalletEvents,
  type WalletEvent,
  type WalletEventSource,
} from '../../src/wallet/events';
import { assertWalletNetwork } from '../../src/wallet/network';
import {
  EVM_ACCOUNTS,
  EVM_CHECKSUMMED,
  EVM_SIGNATURE,
  MockEip1193Provider,
  MockFreighter,
  MockFreighterWatcher,
  MockSolanaWallet,
  SOLANA_KEYS,
  SOLANA_SIGNATURE,
  STELLAR_ACCOUNTS,
  STELLAR_NETWORKS,
  STELLAR_SIGNATURE,
  providerRpcError,
} from './providers.fixture';

/** One provider behind its SDK adapter, with the same controls for every provider. */
interface Harness {
  chain: WalletAdapterChain;
  /** The SDK reference adapter under test. */
  adapter: WalletAdapter;
  events: WalletEventSource;
  /** Accounts in the form the adapter reports them. */
  accounts: readonly [string, string];
  /** `[expected, other]` networks, or `undefined` when the wallet does not expose one. */
  networks: readonly [string, string] | undefined;
  /** Keys that the provider's fixed signature derives. */
  expectedKeys: unknown;
  /** Whether signing without site access prompts for access instead of failing. */
  promptsForAccessOnSign: boolean;
  connect(): Promise<void>;
  /** Runs the provider's own connect request, which the user declines. */
  declineConnection(): Promise<unknown>;
  disconnect(): Promise<void>;
  switchAccount(): Promise<void>;
  switchNetwork(network: string): Promise<void>;
  rejectNextSignature(): void;
  declineNextAccessPrompt(): void;
  /** Produces the provider's own "wallet unavailable" failure. */
  unavailable(): Promise<unknown>;
  /** Builds the SDK adapter around a wallet object without signMessage. */
  adapterWithoutSigning(): unknown;
}

function viemHarness(): Harness {
  const provider = new MockEip1193Provider();
  const horizen = getDeployment('horizen').chainId;
  provider.chainId = `0x${horizen.toString(16)}`;
  const client = createWalletClient({ transport: custom(provider, { retryCount: 0 }) });
  // viem types `signMessage` more strictly than ViemWalletClient; the adapter's runtime call
  // (`signMessage({ account, message: { raw } })`) is valid viem usage.
  const adapter = new ViemWalletAdapter(client as unknown as ViemWalletClient);
  return {
    chain: 'evm',
    adapter,
    events: { chain: 'evm', provider },
    accounts: [EVM_CHECKSUMMED[0], EVM_CHECKSUMMED[1]],
    networks: [`eip155:${horizen}`, 'eip155:1'],
    expectedKeys: deriveEvmKeys(EVM_SIGNATURE),
    promptsForAccessOnSign: false,
    async connect() {
      provider.declineConnection = false;
      await client.requestAddresses();
    },
    async declineConnection() {
      provider.declineConnection = true;
      return client.requestAddresses().catch((error: unknown) => error);
    },
    async disconnect() {
      provider.setAccounts([]);
    },
    async switchAccount() {
      provider.setAccounts([EVM_ACCOUNTS[1]]);
    },
    async switchNetwork(network) {
      provider.setChain(`0x${BigInt(network.slice('eip155:'.length)).toString(16)}`);
    },
    rejectNextSignature() {
      provider.failNext('personal_sign', providerRpcError(4001, 'User rejected the request.'));
    },
    declineNextAccessPrompt() {},
    async unavailable() {
      provider.failNext(
        'personal_sign',
        providerRpcError(4200, 'The Provider does not support the requested method.'),
      );
      return adapter.signMessage(new Uint8Array([1])).catch((error: unknown) => error);
    },
    adapterWithoutSigning: () =>
      new ViemWalletAdapter({ account: { address: EVM_CHECKSUMMED[0] } } as never),
  };
}

function solanaHarness(): Harness {
  const wallet = new MockSolanaWallet();
  const adapter = new SolanaWalletAdapter(wallet);
  return {
    chain: 'solana',
    adapter,
    events: { chain: 'solana', wallet },
    accounts: [SOLANA_KEYS[0].toBase58(), SOLANA_KEYS[1].toBase58()],
    networks: undefined,
    expectedKeys: deriveSolanaKeys(SOLANA_SIGNATURE),
    promptsForAccessOnSign: false,
    async connect() {
      wallet.declineConnection = false;
      await wallet.connect();
    },
    async declineConnection() {
      wallet.declineConnection = true;
      return wallet.connect().catch((error: unknown) => error);
    },
    async disconnect() {
      await wallet.disconnect();
    },
    async switchAccount() {
      wallet.switchAccount(SOLANA_KEYS[1]);
    },
    async switchNetwork() {
      throw new Error('Solana wallet-adapter wallets do not expose a network.');
    },
    rejectNextSignature() {
      wallet.rejectNextSignature();
    },
    declineNextAccessPrompt() {},
    async unavailable() {
      await wallet.disconnect();
      wallet.readyState = 'NotDetected';
      return wallet.connect().catch((error: unknown) => error);
    },
    adapterWithoutSigning: () => new SolanaWalletAdapter({ publicKey: SOLANA_KEYS[0] }),
  };
}

function freighterHarness(): Harness {
  const freighter = new MockFreighter();
  const watcher = new MockFreighterWatcher(freighter);
  // freighter-api types `signedMessage` as `string | null`; the adapter handles null at runtime.
  const adapter = new FreighterWalletAdapter(freighter as never);
  return {
    chain: 'stellar',
    adapter,
    events: { chain: 'stellar', watcher },
    accounts: [STELLAR_ACCOUNTS[0], STELLAR_ACCOUNTS[1]],
    networks: [STELLAR_NETWORKS[0], STELLAR_NETWORKS[1]],
    expectedKeys: deriveStellarKeys(STELLAR_SIGNATURE),
    promptsForAccessOnSign: true,
    async connect() {
      freighter.declineAccess = false;
      await freighter.requestAccess();
      watcher.poll();
    },
    async declineConnection() {
      freighter.declineAccess = true;
      const result = await freighter.requestAccess();
      return result.error;
    },
    async disconnect() {
      freighter.allowed = false;
      watcher.poll();
    },
    async switchAccount() {
      freighter.address = STELLAR_ACCOUNTS[1];
      watcher.poll();
    },
    async switchNetwork(network) {
      freighter.networkPassphrase = network;
      freighter.network = network === Networks.PUBLIC ? 'PUBLIC' : 'TESTNET';
      watcher.poll();
    },
    rejectNextSignature() {
      freighter.rejectNextSignature();
    },
    declineNextAccessPrompt() {
      freighter.declineAccess = true;
    },
    async unavailable() {
      freighter.environment = 'node';
      return adapter.getAddress().catch((error: unknown) => error);
    },
    adapterWithoutSigning: () =>
      new FreighterWalletAdapter({ getAddress: () => freighter.getAddress() } as never),
  };
}

const harnesses = [
  { name: 'viem', create: viemHarness },
  { name: 'Solana wallet-adapter', create: solanaHarness },
  { name: 'Freighter', create: freighterHarness },
];

function record(harness: Harness): WalletEvent[] {
  const events: WalletEvent[] = [];
  watchWalletEvents(harness.events, (event) => events.push(event));
  return events;
}

function addressesOf(events: WalletEvent[]): string[] {
  return events.flatMap((event) => (event.type === 'accountChanged' ? [event.address] : []));
}

function networksOf(events: WalletEvent[]): string[] {
  return events.flatMap((event) => (event.type === 'networkChanged' ? [event.network] : []));
}

const message = new TextEncoder().encode('Wraith wallet conformance');

describe.each(harnesses)('$name adapter conformance', ({ create }) => {
  describe('connect', () => {
    test('rejects with WalletNotConnectedError before the user connects', async () => {
      const harness = create();

      await expect(withNormalizedWalletErrors(harness.adapter).getAddress()).rejects.toBeInstanceOf(
        WalletNotConnectedError,
      );
    });

    test('reports the connected account through getAddress and accountChanged', async () => {
      const harness = create();
      const events = record(harness);

      await harness.connect();
      const address = await withNormalizedWalletErrors(harness.adapter).getAddress();

      expect(address).toBe(harness.accounts[0]);
      expect(addressesOf(events)).toEqual([address]);
    });

    test('maps a declined connection request to WalletUserRejectedError', async () => {
      const harness = create();

      const declined = await harness.declineConnection();
      const error = normalizeWalletError(declined, harness.chain);

      expect(error).toBeInstanceOf(WalletUserRejectedError);
      expect(error.cause).toBe(declined);
    });
  });

  describe('disconnect', () => {
    test('emits disconnect and fails getAddress with WalletNotConnectedError', async () => {
      const harness = create();
      const events = record(harness);
      await harness.connect();

      await harness.disconnect();

      const disconnect = events.find((event) => event.type === 'disconnect');
      expect(disconnect?.type === 'disconnect' && disconnect.error).toBeInstanceOf(
        WalletNotConnectedError,
      );
      await expect(withNormalizedWalletErrors(harness.adapter).getAddress()).rejects.toBeInstanceOf(
        WalletNotConnectedError,
      );
    });

    test('signing after a disconnect fails, unless the wallet re-prompts for access', async () => {
      const harness = create();
      await harness.connect();
      await harness.disconnect();
      harness.declineNextAccessPrompt();

      // Freighter asks for access again when signing; declining it is a rejection.
      const expected = harness.promptsForAccessOnSign
        ? WalletUserRejectedError
        : WalletNotConnectedError;
      await expect(
        withNormalizedWalletErrors(harness.adapter).signMessage(message),
      ).rejects.toBeInstanceOf(expected);
    });

    test('the unwrapped adapter keeps throwing its historical error', async () => {
      const harness = create();

      const thrown = await harness.adapter.getAddress().catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(WraithWalletError);
    });
  });

  describe('wrong network', () => {
    test('reports network switches as networkChanged events', async () => {
      const harness = create();
      const events = record(harness);
      await harness.connect();

      if (!harness.networks) {
        // Solana wallet-adapter has no network events and no network to read.
        expect(harness.adapter.getNetwork).toBeUndefined();
        expect(networksOf(events)).toEqual([]);
        return;
      }
      await harness.switchNetwork(harness.networks[1]);

      expect(networksOf(events).at(-1)).toBe(harness.networks[1]);
      expect(await harness.adapter.getNetwork!()).toBe(harness.networks[1]);
    });

    test('assertWalletNetwork rejects with WalletWrongNetworkError on another network', async () => {
      const harness = create();
      await harness.connect();

      if (!harness.networks) {
        await expect(assertWalletNetwork(harness.adapter, 'solana:devnet')).rejects.toBeInstanceOf(
          WalletUnavailableError,
        );
        return;
      }
      const [expected, other] = harness.networks;
      await expect(assertWalletNetwork(harness.adapter, expected)).resolves.toBeUndefined();
      await harness.switchNetwork(other);

      const error = await assertWalletNetwork(harness.adapter, expected).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(WalletWrongNetworkError);
      expect((error as WraithWalletError).context).toMatchObject({
        chain: harness.chain,
        expectedNetwork: expected,
        actualNetwork: other,
      });
    });
  });

  describe('rejection', () => {
    test('a rejected signature becomes WalletUserRejectedError', async () => {
      const harness = create();
      await harness.connect();
      harness.rejectNextSignature();

      const error = await withNormalizedWalletErrors(harness.adapter)
        .signMessage(message)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(WalletUserRejectedError);
      expect((error as WraithWalletError).context?.chain).toBe(harness.chain);
      expect((error as WraithWalletError).cause).toBeDefined();
    });

    test('deriveStealthKeysFromWallet surfaces the same WalletUserRejectedError', async () => {
      const harness = create();
      await harness.connect();
      harness.rejectNextSignature();

      await expect(
        deriveStealthKeysFromWallet(withNormalizedWalletErrors(harness.adapter)),
      ).rejects.toBeInstanceOf(WalletUserRejectedError);
    });

    test('the unwrapped adapter still throws the provider error', async () => {
      const harness = create();
      await harness.connect();
      harness.rejectNextSignature();

      const raw = await harness.adapter.signMessage(message).catch((e: unknown) => e);

      expect(raw).not.toBeInstanceOf(WraithWalletError);
      expect(normalizeWalletError(raw, harness.chain)).toBeInstanceOf(WalletUserRejectedError);
    });
  });

  describe('retry', () => {
    test('retrying after rejections derives the same keys as a first-time success', async () => {
      const harness = create();
      await harness.connect();
      const wallet = withNormalizedWalletErrors(harness.adapter);

      const codes: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        harness.rejectNextSignature();
        const error = await deriveStealthKeysFromWallet(wallet).catch((e: unknown) => e);
        codes.push((error as WraithWalletError).code);
      }

      expect(codes).toEqual(['WRAITH/WALLET/USER_REJECTED', 'WRAITH/WALLET/USER_REJECTED']);
      await expect(deriveStealthKeysFromWallet(wallet)).resolves.toEqual(harness.expectedKeys);
    });

    test('reconnecting after a disconnect restores getAddress and reports accounts again', async () => {
      const harness = create();
      const events = record(harness);
      const wallet = withNormalizedWalletErrors(harness.adapter);
      await harness.connect();
      await harness.disconnect();
      await expect(wallet.getAddress()).rejects.toBeInstanceOf(WalletNotConnectedError);

      await harness.connect();
      await harness.switchAccount();

      expect(await wallet.getAddress()).toBe(harness.accounts[1]);
      expect(addressesOf(events)).toEqual([
        harness.accounts[0],
        harness.accounts[0],
        harness.accounts[1],
      ]);
    });

    test('switching back to the expected network lets the network check pass', async () => {
      const harness = create();
      await harness.connect();
      if (!harness.networks) {
        expect(harness.adapter.getNetwork).toBeUndefined();
        return;
      }
      const [expected, other] = harness.networks;
      await harness.switchNetwork(other);
      await expect(assertWalletNetwork(harness.adapter, expected)).rejects.toBeInstanceOf(
        WalletWrongNetworkError,
      );

      await harness.switchNetwork(expected);

      await expect(assertWalletNetwork(harness.adapter, expected)).resolves.toBeUndefined();
    });
  });

  describe('unavailable', () => {
    test("the provider's unavailable-wallet error becomes WalletUnavailableError", async () => {
      const harness = create();
      await harness.connect();

      const native = await harness.unavailable();

      expect(normalizeWalletError(native, harness.chain)).toBeInstanceOf(WalletUnavailableError);
    });

    test('a wallet without message signing is reported as unavailable', () => {
      const harness = create();

      let thrown: unknown;
      try {
        harness.adapterWithoutSigning();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(TypeError);
      expect(normalizeWalletError(thrown, harness.chain)).toBeInstanceOf(WalletUnavailableError);
    });
  });
});
