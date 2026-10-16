import { describe, it, expect, vi, afterEach } from 'vitest';
import { Asset, Keypair, Networks, Operation } from '@stellar/stellar-sdk';
import {
  buildPathStealthPayment,
  findStrictReceivePath,
} from '../../../src/chains/stellar/path-payment';
import { HorizonResponseError, RPCRequestError, RPCTimeoutError } from '../../../src/errors';
import { deriveStealthKeys } from '../../../src/chains/stellar/keys';
import { encodeStealthMetaAddress } from '../../../src/chains/stellar/meta-address';

const ANNOUNCER = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const NETWORK = Networks.TESTNET;
const USDC_ISSUER = Keypair.random().publicKey();
const USDC = new Asset('USDC', USDC_ISSUER);
const EPHEMERAL = new Uint8Array(32).fill(0xee);

// Deterministic recipient meta-address
const recipientKeys = deriveStealthKeys(new Uint8Array(64).fill(0xab));
const recipientMeta = encodeStealthMetaAddress(
  recipientKeys.spendingPubKey,
  recipientKeys.viewingPubKey,
);

const base = {
  sender: Keypair.random().publicKey(),
  sequence: '100',
  announcerContract: ANNOUNCER,
  networkPassphrase: NETWORK,
  recipientMeta,
  _ephemeralSeed: EPHEMERAL,
};

describe('buildPathStealthPayment', () => {
  describe('native XLM as receiveAsset', () => {
    it('produces 2 operations: pathPaymentStrictReceive + invokeHostFunction', () => {
      const { transaction, stealthResult } = buildPathStealthPayment({
        ...base,
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '100',
        sendMax: '50.025',
      });

      expect(transaction.operations).toHaveLength(2);

      const swap = transaction.operations[0] as Operation.PathPaymentStrictReceive;
      expect(swap.type).toBe('pathPaymentStrictReceive');
      expect(swap.destAsset.isNative()).toBe(true);
      expect(swap.destAmount).toBe('100.0000000');
      expect(swap.sendMax).toBe('50.0250000');
      expect(swap.sendAsset.code).toBe('USDC');
      // Swap delivers directly to the stealth address
      expect(swap.destination).toBe(stealthResult.stealthAddress);

      const announce = transaction.operations[1] as Operation.InvokeHostFunction;
      expect(announce.type).toBe('invokeHostFunction');
    });

    it('stealthAddress is a valid Stellar G... address', () => {
      const { stealthResult } = buildPathStealthPayment({
        ...base,
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '50',
        sendMax: '25',
      });
      expect(stealthResult.stealthAddress).toMatch(/^G[A-Z2-7]{55}$/);
    });

    it('is deterministic with _ephemeralSeed', () => {
      const opts = {
        ...base,
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '10',
        sendMax: '5',
      };
      const a = buildPathStealthPayment(opts);
      const b = buildPathStealthPayment(opts);
      expect(a.stealthResult.stealthAddress).toBe(b.stealthResult.stealthAddress);
    });
  });

  describe('non-native receiveAsset (USDC)', () => {
    it('produces 3 operations: pathPayment + claimableBalance + invokeHostFunction', () => {
      const USDC2_ISSUER = Keypair.random().publicKey();
      const USDC2 = new Asset('USDC', USDC2_ISSUER);

      const { transaction, stealthResult } = buildPathStealthPayment({
        ...base,
        sendAsset: Asset.native(),
        receiveAsset: USDC2,
        destAmount: '200',
        sendMax: '100.5',
      });

      expect(transaction.operations).toHaveLength(3);

      const swap = transaction.operations[0] as Operation.PathPaymentStrictReceive;
      expect(swap.type).toBe('pathPaymentStrictReceive');
      // Swap delivers to sender, not stealth address
      expect(swap.destination).toBe(base.sender);
      expect(swap.destAmount).toBe('200.0000000');
      expect(swap.sendMax).toBe('100.5000000');

      const claimable = transaction.operations[1] as Operation.CreateClaimableBalance;
      expect(claimable.type).toBe('createClaimableBalance');
      expect(claimable.amount).toBe('200.0000000');
      expect(claimable.asset.code).toBe('USDC');
      expect(claimable.claimants[0].destination).toBe(stealthResult.stealthAddress);

      const announce = transaction.operations[2] as Operation.InvokeHostFunction;
      expect(announce.type).toBe('invokeHostFunction');
    });
  });

  describe('slippage — sendMax enforcement', () => {
    it('encodes sendMax exactly in the operation', () => {
      const { transaction } = buildPathStealthPayment({
        ...base,
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '100',
        sendMax: '50.075', // 0.15% slippage tolerance
      });
      const swap = transaction.operations[0] as Operation.PathPaymentStrictReceive;
      expect(swap.sendMax).toBe('50.0750000');
    });

    it('accepts explicit intermediate path', () => {
      const { transaction } = buildPathStealthPayment({
        ...base,
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '100',
        sendMax: '50',
        path: [Asset.native()],
      });
      const swap = transaction.operations[0] as Operation.PathPaymentStrictReceive;
      expect(swap.path).toHaveLength(1);
    });
  });

  describe('announcement', () => {
    it('always includes an invokeHostFunction operation as the last operation', () => {
      for (const receiveAsset of [Asset.native(), USDC]) {
        const { transaction } = buildPathStealthPayment({
          ...base,
          sendAsset: Asset.native(),
          receiveAsset,
          destAmount: '10',
          sendMax: '10',
        });
        const last = transaction.operations[transaction.operations.length - 1];
        expect(last.type).toBe('invokeHostFunction');
      }
    });
  });
});

describe('findStrictReceivePath', () => {
  const EURC = new Asset('EURC', Keypair.random().publicKey());
  const USDT_ISSUER = Keypair.random().publicKey();

  /** A record in the shape Horizon returns: USDC -> 100 XLM, no hops. */
  function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      source_asset_type: 'credit_alphanum4',
      source_asset_code: 'USDC',
      source_asset_issuer: USDC_ISSUER,
      source_amount: '50.0000000',
      destination_asset_type: 'native',
      destination_amount: '100.0000000',
      path: [],
      ...overrides,
    };
  }

  function envelope(records: unknown): unknown {
    return { _embedded: { records } };
  }

  function mockHorizon(body: unknown, init?: ResponseInit) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const fetchMock = vi.fn().mockResolvedValue(new Response(text, init));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function requestedParams(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams {
    return new URL(fetchMock.mock.calls[0][0] as string).searchParams;
  }

  const xlmFromUsdc = { sendAsset: USDC, receiveAsset: Asset.native(), destAmount: '100' };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads paths from the _embedded.records envelope Horizon returns', async () => {
    mockHorizon(envelope([record()]));

    const result = await findStrictReceivePath(xlmFromUsdc);

    expect(result.sourceAmount).toBe('50.0000000');
    expect(result.path).toEqual([]);
  });

  it('sends source_assets and the destination asset as type / code / issuer', async () => {
    const fetchMock = mockHorizon(envelope([record()]));

    await findStrictReceivePath(xlmFromUsdc);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/paths/strict-receive?');
    const params = requestedParams(fetchMock);
    expect(params.get('source_assets')).toBe(`USDC:${USDC_ISSUER}`);
    expect(params.get('destination_asset_type')).toBe('native');
    expect(params.get('destination_amount')).toBe('100');
    // Horizon rejects a request that sends both source_account and source_assets.
    expect(params.has('source_account')).toBe(false);
    expect(params.has('destination_asset')).toBe(false);
  });

  it('sends code and issuer for a credit destination asset', async () => {
    const fetchMock = mockHorizon(
      envelope([
        record({
          source_asset_type: 'native',
          source_asset_code: undefined,
          source_asset_issuer: undefined,
          destination_asset_type: 'credit_alphanum4',
          destination_asset_code: 'USDC',
          destination_asset_issuer: USDC_ISSUER,
        }),
      ]),
    );

    await findStrictReceivePath({
      sendAsset: Asset.native(),
      receiveAsset: USDC,
      destAmount: '100',
    });

    const params = requestedParams(fetchMock);
    expect(params.get('source_assets')).toBe('native');
    expect(params.get('destination_asset_type')).toBe('credit_alphanum4');
    expect(params.get('destination_asset_code')).toBe('USDC');
    expect(params.get('destination_asset_issuer')).toBe(USDC_ISSUER);
  });

  it('parses intermediate path assets', async () => {
    mockHorizon(
      envelope([
        record({
          path: [
            { asset_type: 'credit_alphanum4', asset_code: 'USDT', asset_issuer: USDT_ISSUER },
            { asset_type: 'native' },
          ],
        }),
      ]),
    );

    const result = await findStrictReceivePath(xlmFromUsdc);

    expect(result.path).toHaveLength(2);
    expect(result.path[0].code).toBe('USDT');
    expect(result.path[0].issuer).toBe(USDT_ISSUER);
    expect(result.path[1].isNative()).toBe(true);
  });

  it('returns the record with the smallest source amount', async () => {
    mockHorizon(
      envelope([
        record({ source_amount: '50.0000000' }),
        record({ source_amount: '40.5000000', path: [{ asset_type: 'native' }] }),
        record({ source_amount: '45' }),
      ]),
    );

    const result = await findStrictReceivePath(xlmFromUsdc);

    expect(result.sourceAmount).toBe('40.5000000');
    expect(result.path).toHaveLength(1);
  });

  it('throws RPCRequestError when Horizon answers with a non-2xx status', async () => {
    mockHorizon('{"title":"Bad Request"}', { status: 400 });

    const error = await findStrictReceivePath(xlmFromUsdc).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RPCRequestError);
    expect((error as RPCRequestError).statusCode).toBe(400);
    expect((error as RPCRequestError).message).toContain('Bad Request');
  });

  it('throws when no path found', async () => {
    mockHorizon(envelope([]));

    await expect(findStrictReceivePath(xlmFromUsdc)).rejects.toThrow('No payment path found');
  });

  it('uses custom horizonUrl when provided', async () => {
    const fetchMock = mockHorizon(envelope([record()]));

    await findStrictReceivePath({
      ...xlmFromUsdc,
      horizonUrl: 'https://custom-horizon.example.com',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://custom-horizon.example.com/paths/strict-receive?'),
      expect.anything(),
    );
  });

  it('strips trailing slashes from horizonUrl', async () => {
    const fetchMock = mockHorizon(envelope([record()]));

    await findStrictReceivePath({
      ...xlmFromUsdc,
      horizonUrl: 'https://custom-horizon.example.com//',
    });

    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/custom-horizon\.example\.com\/paths\//);
  });

  it('rejects an invalid destAmount before calling Horizon', async () => {
    const fetchMock = mockHorizon(envelope([record()]));

    for (const destAmount of ['0', '100.12345678', ' 100', '-1', '1e3']) {
      await expect(findStrictReceivePath({ ...xlmFromUsdc, destAmount })).rejects.toThrow(
        'destAmount must be a positive Stellar amount',
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('times out when Horizon never answers', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>(() => undefined)),
      );

      const result = findStrictReceivePath(xlmFromUsdc);
      const assertion = expect(result).rejects.toBeInstanceOf(RPCTimeoutError);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  describe('hostile responses', () => {
    const at = '_embedded.records[0]';
    const tooLongPath = Array.from({ length: 6 }, () => ({ asset_type: 'native' }));

    const cases: Array<[string, unknown, string]> = [
      ['a body that is not JSON', 'not json', 'body'],
      ['a bare array instead of the envelope', [record()], '_embedded.records'],
      ['a missing _embedded', { records: [record()] }, '_embedded.records'],
      ['records that is not an array', envelope({ 0: record() }), '_embedded.records'],
      [
        'more than 100 records',
        envelope(Array.from({ length: 101 }, () => record())),
        '_embedded.records',
      ],
      ['a record that is not an object', envelope([null]), at],
      [
        'a different source asset',
        envelope([record({ source_asset_code: 'EURC', source_asset_issuer: EURC.issuer })]),
        `${at}.source_asset`,
      ],
      [
        'a different destination asset',
        envelope([
          record({
            destination_asset_type: 'credit_alphanum4',
            destination_asset_code: 'EURC',
            destination_asset_issuer: EURC.issuer,
          }),
        ]),
        `${at}.destination_asset`,
      ],
      [
        'an asset type that does not fit the code',
        envelope([record({ source_asset_type: 'credit_alphanum12' })]),
        `${at}.source_asset`,
      ],
      [
        'a native asset that carries an issuer',
        envelope([record({ destination_asset_issuer: USDC_ISSUER })]),
        `${at}.destination_asset`,
      ],
      [
        'an unknown asset type',
        envelope([record({ destination_asset_type: 'liquidity_pool_shares' })]),
        `${at}.destination_asset`,
      ],
      [
        'a negative source amount',
        envelope([record({ source_amount: '-1' })]),
        `${at}.source_amount`,
      ],
      [
        'a zero source amount',
        envelope([record({ source_amount: '0.0000000' })]),
        `${at}.source_amount`,
      ],
      [
        'a source amount in exponent form',
        envelope([record({ source_amount: '1e3' })]),
        `${at}.source_amount`,
      ],
      [
        'a source amount with 8 decimals',
        envelope([record({ source_amount: '1.12345678' })]),
        `${at}.source_amount`,
      ],
      [
        'a source amount above int64 stroops',
        envelope([record({ source_amount: '922337203686' })]),
        `${at}.source_amount`,
      ],
      ['a numeric source amount', envelope([record({ source_amount: 50 })]), `${at}.source_amount`],
      [
        'a destination amount other than the requested one',
        envelope([record({ destination_amount: '99.0000000' })]),
        `${at}.destination_amount`,
      ],
      ['a path that is not an array', envelope([record({ path: 'native' })]), `${at}.path`],
      ['a path longer than 5 hops', envelope([record({ path: tooLongPath })]), `${at}.path`],
      [
        'a path hop that is not an object',
        envelope([record({ path: ['native'] })]),
        `${at}.path[0]`,
      ],
      [
        'a path hop with an invalid issuer',
        envelope([
          record({
            path: [
              { asset_type: 'credit_alphanum4', asset_code: 'USDT', asset_issuer: 'GNOTAKEY' },
            ],
          }),
        ]),
        `${at}.path[0]`,
      ],
    ];

    it.each(cases)('rejects %s', async (_name, body, field) => {
      mockHorizon(body);

      const error = await findStrictReceivePath(xlmFromUsdc).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HorizonResponseError);
      expect((error as HorizonResponseError).field).toBe(field);
      expect((error as HorizonResponseError).code).toBe('WRAITH/NETWORK/HORIZON_RESPONSE');
    });

    it('rejects a body larger than the limit before parsing it', async () => {
      const body = JSON.stringify({
        ...(envelope([record()]) as object),
        pad: 'x'.repeat(300_000),
      });
      mockHorizon(body);

      await expect(findStrictReceivePath(xlmFromUsdc)).rejects.toMatchObject({ field: 'body' });
    });

    /** A body that never ends, 16 KiB per pull, counting pulls and noting cancellation. */
    function endlessBody() {
      const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
      const state = { pulls: 0, cancelled: false };
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          state.pulls++;
          controller.enqueue(chunk);
        },
        cancel() {
          state.cancelled = true;
        },
      });
      return { stream, state };
    }

    it('stops reading a body without Content-Length once it passes the limit', async () => {
      const { stream, state } = endlessBody();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));

      await expect(findStrictReceivePath(xlmFromUsdc)).rejects.toMatchObject({ field: 'body' });
      expect(state.cancelled).toBe(true);
      // 256 KiB is 16 pulls of 16 KiB; the stream may be pulled a little ahead.
      expect(state.pulls).toBeLessThanOrEqual(20);
    });

    it('rejects a declared Content-Length above the limit without reading the body', async () => {
      const { stream, state } = endlessBody();
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(new Response(stream, { headers: { 'content-length': '10000000' } })),
      );

      await expect(findStrictReceivePath(xlmFromUsdc)).rejects.toMatchObject({ field: 'body' });
      expect(state.cancelled).toBe(true);
      expect(state.pulls).toBeLessThanOrEqual(2);
    });

    it('keeps the status when the error body cannot be read', async () => {
      const broken = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new TypeError('connection reset'));
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(broken, { status: 503 })));

      const error = await findStrictReceivePath(xlmFromUsdc).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RPCRequestError);
      expect((error as RPCRequestError).statusCode).toBe(503);
    });

    it('enforces the byte limit when the response has no body stream', async () => {
      // Two-byte characters: under the limit in characters, over it in bytes.
      const text = JSON.stringify({
        ...(envelope([record()]) as object),
        pad: 'é'.repeat(140_000),
      });
      const response = {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        text: async () => text,
      } as unknown as Response;
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      await expect(findStrictReceivePath(xlmFromUsdc)).rejects.toMatchObject({ field: 'body' });
    });

    it('reads only the start of an error body', async () => {
      const { stream, state } = endlessBody();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 500 })));

      const error = await findStrictReceivePath(xlmFromUsdc).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RPCRequestError);
      expect((error as RPCRequestError).context?.responseText.length).toBeLessThanOrEqual(500);
      expect(state.cancelled).toBe(true);
    });

    it('keeps error messages short when a field holds a huge value', async () => {
      mockHorizon(envelope([record({ source_asset_code: 'A'.repeat(50_000) })]));

      const error = await findStrictReceivePath(xlmFromUsdc).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HorizonResponseError);
      expect((error as Error).message.length).toBeLessThan(1_000);
    });
  });
});
