import { describe, expect, test } from 'vitest';
import {
  ChainDisconnectedError,
  ChainMismatchError,
  InternalRpcError,
  ProviderDisconnectedError,
  SwitchChainError,
  UnauthorizedProviderError,
  UnsupportedChainIdError,
  UnsupportedProviderMethodError,
  UserRejectedRequestError,
  createWalletClient,
  custom,
} from 'viem';
import {
  InvalidSignatureError,
  WalletNotConnectedError,
  WalletRequestFailedError,
  WalletUnavailableError,
  WalletUserRejectedError,
  WalletWrongNetworkError,
  WraithError,
  WraithWalletError,
} from '../../src/errors';
import { deriveStealthKeysFromWallet, type StellarWalletAdapter } from '../../src/wallet/adapter';
import { FreighterWalletAdapter } from '../../src/wallet/adapters/freighter';
import { SolanaWalletAdapter } from '../../src/wallet/adapters/solana';
import { ViemWalletAdapter } from '../../src/wallet/adapters/viem';
import { normalizeWalletError, withNormalizedWalletErrors } from '../../src/wallet/errors';
import { assertWalletNetwork, toEvmNetwork } from '../../src/wallet/network';
import {
  FreighterApiDeclinedError,
  FreighterApiInternalError,
  FreighterApiNodeError,
  STELLAR_NETWORKS,
  WalletConnectionError,
  WalletDisconnectedError,
  WalletNotConnectedError as SolanaWalletNotConnectedError,
  WalletNotReadyError,
  WalletNotSelectedError,
  WalletSignMessageError,
  WalletTimeoutError,
  WalletWindowClosedError,
} from './providers.fixture';

type WalletErrorClass = new (...args: any[]) => WraithWalletError;

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to throw.');
}

describe('WraithWalletError taxonomy', () => {
  const cases: Array<[string, WalletErrorClass, string, string]> = [
    [
      'WalletNotConnectedError',
      WalletNotConnectedError,
      'WRAITH/WALLET/NOT_CONNECTED',
      'wallet-not-connected',
    ],
    [
      'WalletUserRejectedError',
      WalletUserRejectedError,
      'WRAITH/WALLET/USER_REJECTED',
      'wallet-user-rejected',
    ],
    [
      'WalletWrongNetworkError',
      WalletWrongNetworkError,
      'WRAITH/WALLET/WRONG_NETWORK',
      'wallet-wrong-network',
    ],
    [
      'WalletUnavailableError',
      WalletUnavailableError,
      'WRAITH/WALLET/UNAVAILABLE',
      'wallet-unavailable',
    ],
    [
      'WalletRequestFailedError',
      WalletRequestFailedError,
      'WRAITH/WALLET/REQUEST_FAILED',
      'wallet-request-failed',
    ],
  ];

  test.each(cases)('%s follows the WraithError contract', (name, ErrorClass, code, anchor) => {
    const cause = { code: 4001, message: 'provider detail' };
    const error = new ErrorClass({
      chain: 'evm',
      reason: 'provider detail',
      providerCode: 4001,
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithWalletError);
    expect(error.code).toBe(code);
    expect(error.name).toBe(name);
    expect(error.docsLink).toBe(`https://docs.wraith.dev/sdk/errors#${anchor}`);
    expect(error.message).toContain('(evm): provider detail');
    expect(error.message).toContain(error.docsLink);
    expect(error.context).toMatchObject({
      chain: 'evm',
      reason: 'provider detail',
      providerCode: 4001,
    });

    const hint = error.describe();
    expect(hint).toContain(error.docsLink);
    expect(hint).toContain('evm wallet');
    expect(hint).not.toBe(
      `No specific guidance is available for this error. See ${error.docsLink} for details.`,
    );
  });

  test('keeps the provider error on a non-enumerable cause that JSON leaves out', () => {
    const cause = new Error('original');
    const error = new WalletUserRejectedError({ chain: 'solana', cause });

    expect(error.cause).toBe(cause);
    expect(Object.keys(error)).not.toContain('cause');
    const json = JSON.parse(JSON.stringify(error));
    expect(json).toEqual({
      name: 'WalletUserRejectedError',
      message: error.message,
      code: 'WRAITH/WALLET/USER_REJECTED',
      docsLink: 'https://docs.wraith.dev/sdk/errors#wallet-user-rejected',
      context: { chain: 'solana' },
    });
  });

  test('has no cause property when none is given', () => {
    expect('cause' in new WalletNotConnectedError()).toBe(false);
    expect(new WalletNotConnectedError().message).toContain('Wallet is not connected (See ');
  });

  test('WalletWrongNetworkError reports the expected and actual networks', () => {
    const error = new WalletWrongNetworkError({
      chain: 'stellar',
      expectedNetwork: STELLAR_NETWORKS[0],
      actualNetwork: STELLAR_NETWORKS[1],
    });

    expect(error.message).toContain(
      `expected "${STELLAR_NETWORKS[0]}", got "${STELLAR_NETWORKS[1]}"`,
    );
    expect(error.context).toMatchObject({
      chain: 'stellar',
      expectedNetwork: STELLAR_NETWORKS[0],
      actualNetwork: STELLAR_NETWORKS[1],
    });
    expect(error.describe()).toContain(`but this request needs "${STELLAR_NETWORKS[0]}"`);
  });
});

describe('normalizeWalletError', () => {
  const viemCases: Array<[string, unknown, WalletErrorClass, number | string]> = [
    [
      'UserRejectedRequestError (4001)',
      new UserRejectedRequestError(new Error('User denied message signature.')),
      WalletUserRejectedError,
      4001,
    ],
    [
      'UnauthorizedProviderError (4100)',
      new UnauthorizedProviderError(new Error('unauthorized')),
      WalletNotConnectedError,
      4100,
    ],
    [
      'ProviderDisconnectedError (4900)',
      new ProviderDisconnectedError(new Error('disconnected')),
      WalletNotConnectedError,
      4900,
    ],
    [
      'ChainDisconnectedError (4901)',
      new ChainDisconnectedError(new Error('chain disconnected')),
      WalletWrongNetworkError,
      4901,
    ],
    [
      'SwitchChainError (4902)',
      new SwitchChainError(new Error('Unrecognized chain ID "0x539".')),
      WalletWrongNetworkError,
      4902,
    ],
    [
      'UnsupportedChainIdError (5710)',
      new UnsupportedChainIdError(new Error('unsupported chain')),
      WalletWrongNetworkError,
      5710,
    ],
    [
      'UnsupportedProviderMethodError (4200)',
      new UnsupportedProviderMethodError(new Error('unsupported')),
      WalletUnavailableError,
      4200,
    ],
    [
      'ChainMismatchError',
      new ChainMismatchError({
        chain: { id: 2651420, name: 'Horizen Testnet' } as never,
        currentChainId: 1,
      }),
      WalletWrongNetworkError,
      'ChainMismatchError',
    ],
    [
      'raw EIP-1193 rejection',
      { code: 4001, message: 'User rejected the request.' },
      WalletUserRejectedError,
      4001,
    ],
    [
      'raw CAIP-25 rejection (WalletConnect)',
      { code: 5000, message: 'User rejected.' },
      WalletUserRejectedError,
      5000,
    ],
  ];

  test.each(viemCases)('maps viem / EIP-1193 %s', (_label, input, ErrorClass, providerCode) => {
    const error = normalizeWalletError(input, 'evm');

    expect(error).toBeInstanceOf(ErrorClass);
    expect(error.context).toMatchObject({ chain: 'evm', providerCode });
    expect(error.cause).toBe(input);
  });

  test('uses the one-line viem shortMessage as the reason', () => {
    const error = normalizeWalletError(
      new UserRejectedRequestError(new Error('User denied message signature.')),
      'evm',
    );

    expect(error.context?.reason).toBe('User rejected the request.');
  });

  test('maps the AccountNotFoundError viem throws when signing without an account', async () => {
    const client = createWalletClient({
      transport: custom({ request: async () => null }, { retryCount: 0 }),
    });
    const thrown = await client.signMessage({ message: 'hi' } as never).catch((e: unknown) => e);

    expect((thrown as Error).name).toBe('AccountNotFoundError');
    expect(normalizeWalletError(thrown, 'evm')).toBeInstanceOf(WalletNotConnectedError);
  });

  const solanaCases: Array<[string, unknown, WalletErrorClass, number | string]> = [
    [
      'WalletNotConnectedError',
      new SolanaWalletNotConnectedError(),
      WalletNotConnectedError,
      'WalletNotConnectedError',
    ],
    [
      'WalletDisconnectedError',
      new WalletDisconnectedError(),
      WalletNotConnectedError,
      'WalletDisconnectedError',
    ],
    [
      'WalletNotSelectedError',
      new WalletNotSelectedError(),
      WalletNotConnectedError,
      'WalletNotSelectedError',
    ],
    [
      'WalletNotReadyError',
      new WalletNotReadyError(),
      WalletUnavailableError,
      'WalletNotReadyError',
    ],
    [
      'WalletWindowClosedError',
      new WalletWindowClosedError(),
      WalletUserRejectedError,
      'WalletWindowClosedError',
    ],
    [
      'WalletSignMessageError wrapping a 4001 rejection',
      new WalletSignMessageError('User rejected the request.', {
        code: 4001,
        message: 'User rejected the request.',
      }),
      WalletUserRejectedError,
      4001,
    ],
    [
      'WalletConnectionError wrapping a 4001 rejection',
      new WalletConnectionError('User rejected the request.', {
        code: 4001,
        message: 'User rejected the request.',
      }),
      WalletUserRejectedError,
      4001,
    ],
    [
      'WalletSignMessageError wrapping a 4100 error',
      new WalletSignMessageError('unauthorized', { code: 4100, message: 'unauthorized' }),
      WalletNotConnectedError,
      4100,
    ],
  ];

  test.each(solanaCases)(
    'maps Solana wallet-adapter %s',
    (_label, input, ErrorClass, providerCode) => {
      const error = normalizeWalletError(input, 'solana');

      expect(error).toBeInstanceOf(ErrorClass);
      expect(error.context).toMatchObject({ chain: 'solana', providerCode });
      expect(error.cause).toBe(input);
    },
  );

  const freighterCases: Array<[string, unknown, WalletErrorClass, number | undefined]> = [
    ['FreighterApiDeclinedError', FreighterApiDeclinedError, WalletUserRejectedError, -4],
    ['FreighterApiNodeError', FreighterApiNodeError, WalletUnavailableError, -1],
    [
      'the Error FreighterWalletAdapter throws for a decline',
      new Error(FreighterApiDeclinedError.message),
      WalletUserRejectedError,
      undefined,
    ],
    [
      'a whole Freighter result object',
      { signedMessage: null, signerAddress: '', error: FreighterApiDeclinedError },
      WalletUserRejectedError,
      -4,
    ],
  ];

  test.each(freighterCases)('maps Freighter %s', (_label, input, ErrorClass, providerCode) => {
    const error = normalizeWalletError(input, 'stellar');

    expect(error).toBeInstanceOf(ErrorClass);
    expect(error.context).toMatchObject({ chain: 'stellar', providerCode });
  });

  test("maps the reference adapters' historical errors", async () => {
    const viem = new ViemWalletAdapter({
      getAddresses: async () => [],
      signMessage: async () => '0x' as const,
    });
    const solana = new SolanaWalletAdapter({
      publicKey: null,
      signMessage: async () => new Uint8Array(),
    });
    const freighter = new FreighterWalletAdapter({
      getAddress: async () => ({ address: '' }),
      signMessage: async () => ({}),
    });

    for (const [adapter, chain] of [
      [viem, 'evm'],
      [solana, 'solana'],
      [freighter, 'stellar'],
    ] as const) {
      const thrown = await adapter.getAddress().catch((e: unknown) => e);
      expect(thrown).not.toBeInstanceOf(WraithWalletError);
      expect(normalizeWalletError(thrown, chain)).toBeInstanceOf(WalletNotConnectedError);
    }

    const constructors: Array<[() => unknown, 'evm' | 'solana' | 'stellar']> = [
      [() => new ViemWalletAdapter({} as never), 'evm'],
      [() => new SolanaWalletAdapter({ publicKey: null }), 'solana'],
      [() => new FreighterWalletAdapter({} as never), 'stellar'],
    ];
    for (const [construct, chain] of constructors) {
      const thrown = catchError(construct);
      expect(thrown).toBeInstanceOf(TypeError);
      expect(normalizeWalletError(thrown, chain)).toBeInstanceOf(WalletUnavailableError);
    }
  });

  test('only treats code -4 as a Freighter decline for Stellar or unknown chains', () => {
    const declined = { code: -4, message: 'declined' };

    expect(normalizeWalletError(declined, 'stellar')).toBeInstanceOf(WalletUserRejectedError);
    expect(normalizeWalletError(declined)).toBeInstanceOf(WalletUserRejectedError);
    expect(normalizeWalletError(declined, 'evm')).toBeInstanceOf(WalletRequestFailedError);
  });

  const unknownCases: Array<[string, unknown, number | string | undefined, string | undefined]> = [
    ['a plain Error', new Error('boom'), undefined, 'boom'],
    ['a string', 'something odd', undefined, 'something odd'],
    ['undefined', undefined, undefined, undefined],
    ['FreighterApiInternalError', FreighterApiInternalError, -1, FreighterApiInternalError.message],
    [
      'a pending-request error (-32002)',
      { code: -32002, message: 'Request already pending' },
      -32002,
      'Request already pending',
    ],
    [
      'viem InternalRpcError',
      new InternalRpcError(new Error('internal')),
      -32603,
      'An internal error was received.',
    ],
    ['Solana WalletTimeoutError', new WalletTimeoutError(), 'WalletTimeoutError', undefined],
    [
      'Solana WalletSignMessageError with an unknown cause',
      new WalletSignMessageError('boom', new Error('boom')),
      'WalletSignMessageError',
      'boom',
    ],
  ];

  test.each(unknownCases)(
    'falls back to WalletRequestFailedError for %s',
    (_label, input, providerCode, reason) => {
      const error = normalizeWalletError(input, 'evm');

      expect(error).toBeInstanceOf(WalletRequestFailedError);
      expect(error.context).toMatchObject({ chain: 'evm', providerCode, reason });
      expect(error.cause).toBe(input);
    },
  );

  test('follows nested causes', () => {
    const inner = { code: 4001, message: 'User rejected the request.' };
    const error = normalizeWalletError(
      new Error('outer', { cause: new Error('middle', { cause: inner }) }),
    );

    expect(error).toBeInstanceOf(WalletUserRejectedError);
    expect(error.context?.providerCode).toBe(4001);
  });

  test('stops on circular causes', () => {
    const a: { message: string; cause?: unknown } = { message: 'a' };
    const b = { message: 'b', cause: a };
    a.cause = b;

    expect(normalizeWalletError(a)).toBeInstanceOf(WalletRequestFailedError);
  });

  test('is idempotent and returns a wallet error found in the cause chain', () => {
    const first = normalizeWalletError({ code: 4900, message: 'disconnected' }, 'evm');

    expect(normalizeWalletError(first)).toBe(first);
    expect(normalizeWalletError(new Error('app wrapper', { cause: first }))).toBe(first);
  });
});

describe('withNormalizedWalletErrors', () => {
  const signature = new Uint8Array(64).fill(0x11);

  function stellarAdapter(overrides: Partial<StellarWalletAdapter> = {}): StellarWalletAdapter {
    return {
      chain: 'stellar',
      getAddress: async () => 'GTEST',
      signMessage: async () => signature,
      ...overrides,
    };
  }

  test('passes results through unchanged', async () => {
    const wrapped = withNormalizedWalletErrors(
      stellarAdapter({ getNetwork: async () => STELLAR_NETWORKS[0] }),
    );

    expect(wrapped.chain).toBe('stellar');
    expect(await wrapped.getAddress()).toBe('GTEST');
    expect(await wrapped.signMessage(new Uint8Array([1]))).toBe(signature);
    expect(await wrapped.getNetwork?.()).toBe(STELLAR_NETWORKS[0]);
  });

  test('normalises rejections, including synchronous throws', async () => {
    const original = new Error(FreighterApiDeclinedError.message);
    const wrapped = withNormalizedWalletErrors(
      stellarAdapter({
        signMessage: () => {
          throw original;
        },
        getAddress: async () => {
          throw new Error('Freighter is not connected.');
        },
      }),
    );

    const rejected = await wrapped.signMessage(new Uint8Array([1])).catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(WalletUserRejectedError);
    expect((rejected as WraithWalletError).cause).toBe(original);
    expect((rejected as WraithWalletError).context?.chain).toBe('stellar');
    await expect(wrapped.getAddress()).rejects.toBeInstanceOf(WalletNotConnectedError);
  });

  test('only exposes getNetwork when the adapter has it', () => {
    expect(withNormalizedWalletErrors(stellarAdapter()).getNetwork).toBeUndefined();
  });

  test('leaves the original adapter untouched', async () => {
    const original = new Error('raw');
    const adapter = stellarAdapter({
      signMessage: async () => {
        throw original;
      },
    });
    withNormalizedWalletErrors(adapter);

    await expect(adapter.signMessage(new Uint8Array([1]))).rejects.toBe(original);
  });

  test('does not wrap key-derivation errors that happen after signing', async () => {
    const wrapped = withNormalizedWalletErrors(
      stellarAdapter({ signMessage: async () => new Uint8Array(10) }),
    );

    await expect(deriveStealthKeysFromWallet(wrapped)).rejects.toBeInstanceOf(
      InvalidSignatureError,
    );
  });
});

describe('network checks', () => {
  test('toEvmNetwork formats chain IDs as CAIP-2', () => {
    expect(toEvmNetwork(1)).toBe('eip155:1');
    expect(toEvmNetwork(2651420n)).toBe('eip155:2651420');
    expect(toEvmNetwork('0x28751c')).toBe('eip155:2651420');
    expect(toEvmNetwork('0X1A')).toBe('eip155:26');
    expect(toEvmNetwork('137')).toBe('eip155:137');
    for (const invalid of ['', 'abc', '0x', -1, 1.5, Number.NaN, null, undefined, {}]) {
      expect(toEvmNetwork(invalid)).toBeUndefined();
    }
  });

  test('ViemWalletAdapter.getNetwork reads the chain from getChainId', async () => {
    const adapter = new ViemWalletAdapter({
      getChainId: async () => 2651420,
      signMessage: async () => '0x' as const,
    });

    expect(await adapter.getNetwork()).toBe('eip155:2651420');
  });

  test('ViemWalletAdapter.getNetwork rejects with wallet errors', async () => {
    const withoutChainId = new ViemWalletAdapter({ signMessage: async () => '0x' as const });
    const disconnected = new ViemWalletAdapter({
      getChainId: async () => {
        throw new ProviderDisconnectedError(new Error('gone'));
      },
      signMessage: async () => '0x' as const,
    });
    const invalid = new ViemWalletAdapter({
      getChainId: async () => -1,
      signMessage: async () => '0x' as const,
    });

    await expect(withoutChainId.getNetwork()).rejects.toBeInstanceOf(WalletUnavailableError);
    await expect(disconnected.getNetwork()).rejects.toBeInstanceOf(WalletNotConnectedError);
    await expect(invalid.getNetwork()).rejects.toBeInstanceOf(WalletRequestFailedError);
  });

  test('FreighterWalletAdapter.getNetwork returns the passphrase or a wallet error', async () => {
    const base = { getAddress: async () => ({ address: 'G' }), signMessage: async () => ({}) };
    const ok = new FreighterWalletAdapter({
      ...base,
      getNetwork: async () => ({ network: 'TESTNET', networkPassphrase: STELLAR_NETWORKS[0] }),
    });
    const nodeEnv = new FreighterWalletAdapter({
      ...base,
      getNetwork: async () => ({
        network: '',
        networkPassphrase: '',
        error: FreighterApiNodeError,
      }),
    });
    const empty = new FreighterWalletAdapter({
      ...base,
      getNetwork: async () => ({ network: '', networkPassphrase: '' }),
    });
    const throwing = new FreighterWalletAdapter({
      ...base,
      getNetwork: () => {
        throw FreighterApiDeclinedError;
      },
    });

    expect(await ok.getNetwork()).toBe(STELLAR_NETWORKS[0]);
    await expect(new FreighterWalletAdapter(base).getNetwork()).rejects.toBeInstanceOf(
      WalletUnavailableError,
    );
    await expect(nodeEnv.getNetwork()).rejects.toBeInstanceOf(WalletUnavailableError);
    await expect(empty.getNetwork()).rejects.toBeInstanceOf(WalletRequestFailedError);
    await expect(throwing.getNetwork()).rejects.toBeInstanceOf(WalletUserRejectedError);
  });

  test('assertWalletNetwork accepts the expected network and rejects others', async () => {
    const adapter = {
      chain: 'evm' as const,
      getAddress: async () => '0xabc',
      signMessage: async () => '0x' as const,
      getNetwork: async () => 'eip155:1',
    };

    await expect(assertWalletNetwork(adapter, 'eip155:1')).resolves.toBeUndefined();
    const error = await assertWalletNetwork(adapter, 'eip155:2651420').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletWrongNetworkError);
    expect((error as WraithWalletError).context).toMatchObject({
      chain: 'evm',
      expectedNetwork: 'eip155:2651420',
      actualNetwork: 'eip155:1',
    });
  });

  test('assertWalletNetwork rejects adapters that cannot report a network', async () => {
    const solana = new SolanaWalletAdapter({
      publicKey: null,
      signMessage: async () => new Uint8Array(),
    });

    await expect(assertWalletNetwork(solana, 'solana:devnet')).rejects.toBeInstanceOf(
      WalletUnavailableError,
    );
  });

  test('assertWalletNetwork normalises failures while reading the network', async () => {
    const adapter = {
      chain: 'evm' as const,
      getAddress: async () => '0xabc',
      signMessage: async () => '0x' as const,
      getNetwork: async () => {
        throw { code: 4900, message: 'disconnected' };
      },
    };

    await expect(assertWalletNetwork(adapter, 'eip155:1')).rejects.toBeInstanceOf(
      WalletNotConnectedError,
    );
  });
});
