import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Only the network is mocked. Transactions are built by the real SDK, and every
// contract reply is a real `xdr.ScVal` that is serialised to XDR and parsed back
// by the SDK's own `rpc.parseRawSimulation`, which is what `simulateTransaction`
// returns. The code under test therefore sees exactly the objects a live Soroban
// RPC produces: string arms arrive as Buffers and are read through `str()` and
// `sym()`, and an i128 arrives as two 64-bit halves.
// ---------------------------------------------------------------------------

const { simulate } = vi.hoisted(() => ({ simulate: vi.fn() }));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  class Server {
    async simulateTransaction(tx: { toXDR(): string }) {
      // The real client serialises the transaction before sending it, so an
      // argument that cannot be encoded fails here just as it would live.
      tx.toXDR();
      return simulate(tx);
    }
  }
  return { ...actual, rpc: { ...actual.rpc, Server } };
});

import {
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type Operation,
  type Transaction,
} from '@stellar/stellar-sdk';
import {
  getAssetMetadata,
  getAssetMetadataResult,
  getAssetBalance,
  clearAssetMetadataCache,
} from '../../../src/chains/stellar/asset';

const CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

// ---------------------------------------------------------------------------
// Real ScVal values and RPC responses
// ---------------------------------------------------------------------------

const str = (text: string) => xdr.ScVal.scvString(text);
const sym = (text: string) => xdr.ScVal.scvSymbol(text);
const u32 = (n: number) => xdr.ScVal.scvU32(n);
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' });

/** A successful simulation whose contract call returned `value`. */
const returns = (value: xdr.ScVal) =>
  rpc.parseRawSimulation({
    id: '1',
    latestLedger: 1,
    minResourceFee: '0',
    results: [{ auth: [], xdr: value.toXDR('base64') }],
  });

/** A successful simulation with no result row. */
const noResult = () => rpc.parseRawSimulation({ id: '1', latestLedger: 1, minResourceFee: '0' });

/** A simulation the RPC reports as failed. */
const fails = (error: string) => rpc.parseRawSimulation({ id: '1', latestLedger: 1, error });

/** What Soroban reports when the contract does not export the function. */
const NO_SUCH_FUNCTION =
  'HostError: Error(WasmVm, MissingValue)\n\nEvent log (newest first):\n' +
  '   0: [Diagnostic Event] topics:[error, Error(WasmVm, MissingValue)], ' +
  'data:["trying to invoke non-existent contract function", name]';

type Reply = rpc.Api.SimulateTransactionResponse | Error;

/** The contract function a transaction invokes, read back from the transaction itself. */
function invocation(tx: Transaction) {
  const call = (tx.operations[0] as Operation.InvokeHostFunction).func.invokeContract();
  return {
    fn: call.functionName().toString(),
    argTypes: call.args().map((arg) => arg.switch().name),
    args: call.args().map((arg) => scValToNative(arg)),
  };
}

/** Answers each contract function with its reply. A call to any other function fails the test. */
function contract(replies: Record<string, Reply>) {
  simulate.mockImplementation(async (tx: Transaction) => {
    const { fn } = invocation(tx);
    const reply = replies[fn];
    if (reply === undefined) throw new Error(`unexpected contract call "${fn}"`);
    if (reply instanceof Error) throw reply;
    return reply;
  });
}

const token = (name: xdr.ScVal, symbol: xdr.ScVal, decimals: xdr.ScVal) =>
  contract({ name: returns(name), symbol: returns(symbol), decimals: returns(decimals) });

describe('SEP-41 metadata resilience', () => {
  beforeEach(() => {
    clearAssetMetadataCache();
    simulate.mockReset();
  });

  describe('complete', () => {
    it('decodes real String and u32 return values and caches the result', async () => {
      token(str('USD Coin'), str('USDC'), u32(7));
      const first = await getAssetMetadataResult(CONTRACT, 'testnet');

      expect(first.status).toBe('complete');
      expect(first.metadata).toEqual({ name: 'USD Coin', symbol: 'USDC', decimals: 7 });
      expect(first.failures).toEqual([]);

      // The three reads are real zero-argument contract invocations.
      expect(simulate.mock.calls.map(([tx]) => invocation(tx))).toEqual([
        { fn: 'name', argTypes: [], args: [] },
        { fn: 'symbol', argTypes: [], args: [] },
        { fn: 'decimals', argTypes: [], args: [] },
      ]);

      const second = await getAssetMetadataResult(CONTRACT, 'testnet');
      expect(second.status).toBe('complete');
      // Served from cache, so no further RPC calls.
      expect(simulate).toHaveBeenCalledTimes(3);
    });

    it('accepts a Symbol where SEP-41 declares a String', async () => {
      token(sym('USDC'), sym('USDC'), u32(7));
      const result = await getAssetMetadataResult(CONTRACT, 'testnet');

      expect(result.status).toBe('complete');
      expect(result.metadata).toEqual({ name: 'USDC', symbol: 'USDC', decimals: 7 });
    });

    it('decodes String bytes as UTF-8', async () => {
      token(str('Café Token ✓'), str('CAFÉ'), u32(2));
      const result = await getAssetMetadataResult(CONTRACT, 'testnet');

      expect(result.metadata).toEqual({ name: 'Café Token ✓', symbol: 'CAFÉ', decimals: 2 });
    });
  });

  describe('partial', () => {
    it('keeps the fields that answered when a method is missing', async () => {
      contract({
        name: fails(NO_SUCH_FUNCTION),
        symbol: returns(str('TST')),
        decimals: returns(u32(7)),
      });
      const result = await getAssetMetadataResult(CONTRACT, 'testnet');

      expect(result.status).toBe('partial');
      expect(result.metadata).toEqual({ symbol: 'TST', decimals: 7 });
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toMatchObject({ field: 'name', reason: 'missing' });
    });

    it.each([
      ['no result row', noResult()],
      ['a void return value', returns(xdr.ScVal.scvVoid())],
    ])('treats %s as missing', async (_label, reply) => {
      contract({ name: reply, symbol: returns(str('TST')), decimals: returns(u32(7)) });
      const result = await getAssetMetadataResult(CONTRACT, 'testnet');

      expect(result.status).toBe('partial');
      expect(result.failures[0]).toMatchObject({ field: 'name', reason: 'missing' });
    });

    it('does not cache a partial read', async () => {
      contract({
        name: fails(NO_SUCH_FUNCTION),
        symbol: returns(str('TST')),
        decimals: returns(u32(7)),
      });
      await getAssetMetadataResult(CONTRACT, 'testnet');

      token(str('Now Present'), str('TST'), u32(7));
      const retry = await getAssetMetadataResult(CONTRACT, 'testnet');

      expect(retry.status).toBe('complete');
      expect(retry.metadata).toEqual({ name: 'Now Present', symbol: 'TST', decimals: 7 });
      // Six calls total proves the partial read was re-fetched, not served stale.
      expect(simulate).toHaveBeenCalledTimes(6);
    });
  });

  describe('unsupported', () => {
    it('reports unsupported when no field can be read', async () => {
      const missing = fails(NO_SUCH_FUNCTION);
      contract({ name: missing, symbol: missing, decimals: missing });
      const result = await getAssetMetadataResult(CONTRACT, 'testnet');

      expect(result.status).toBe('unsupported');
      expect(result.metadata).toEqual({});
      expect(result.failures.map((f) => f.field)).toEqual(['name', 'symbol', 'decimals']);
      expect(result.failures.every((f) => f.reason === 'missing')).toBe(true);
    });

    it('classifies an unrecognised RPC failure as rpc-error, not missing', async () => {
      const down = new Error('socket hang up');
      contract({ name: down, symbol: down, decimals: down });
      const result = await getAssetMetadataResult(CONTRACT, 'testnet');

      expect(result.status).toBe('unsupported');
      expect(result.failures.every((f) => f.reason === 'rpc-error')).toBe(true);
    });

    it('does not cache an unsupported verdict', async () => {
      const missing = fails(NO_SUCH_FUNCTION);
      contract({ name: missing, symbol: missing, decimals: missing });
      await getAssetMetadataResult(CONTRACT, 'testnet');
      expect(simulate).toHaveBeenCalledTimes(3);

      token(str('Recovered'), str('RCV'), u32(2));
      const retry = await getAssetMetadataResult(CONTRACT, 'testnet');
      expect(retry.status).toBe('complete');
    });
  });

  describe('value validation', () => {
    it.each([
      ['above the SEP-41 maximum', u32(19)],
      ['a String instead of a u32', str('7')],
      ['a signed i32 instead of a u32', xdr.ScVal.scvI32(-1)],
      ['an i128 instead of a u32', i128(7n)],
    ])('rejects %s decimals as invalid rather than caching it', async (_label, bad) => {
      token(str('Test'), str('TST'), bad);
      const result = await getAssetMetadataResult(CONTRACT, 'testnet');

      expect(result.status).toBe('partial');
      expect(result.metadata.decimals).toBeUndefined();
      expect(result.failures[0]).toMatchObject({ field: 'decimals', reason: 'invalid' });
      // The crucial part: no NaN escapes onto the metadata object.
      expect(Number.isNaN(result.metadata.decimals as number)).toBe(false);
    });

    it.each([
      ['an empty string', str('')],
      ['whitespace only', str('   ')],
      ['a u32', u32(42)],
      ['a bool', xdr.ScVal.scvBool(true)],
    ])('rejects %s as a symbol', async (_label, bad) => {
      token(str('Test'), bad, u32(7));
      const result = await getAssetMetadataResult(CONTRACT, 'testnet');

      expect(result.status).toBe('partial');
      expect(result.metadata.symbol).toBeUndefined();
      expect(result.failures[0]).toMatchObject({ field: 'symbol', reason: 'invalid' });
    });

    it('names the type it got when the type is wrong', async () => {
      token(str('Test'), u32(42), u32(7));
      const result = await getAssetMetadataResult(CONTRACT, 'testnet');

      expect(result.failures[0].message).toBe(
        'SEP-41 contract returned an unusable "symbol": expected scvString or scvSymbol, got scvU32',
      );
    });

    it('accepts the boundary decimals values 0 and 18', async () => {
      token(str('Zero'), str('ZRO'), u32(0));
      expect((await getAssetMetadataResult(CONTRACT, 'testnet')).status).toBe('complete');

      clearAssetMetadataCache();
      token(str('Max'), str('MAX'), u32(18));
      const max = await getAssetMetadataResult(CONTRACT, 'testnet');
      expect(max.status).toBe('complete');
      expect(max.metadata.decimals).toBe(18);
    });
  });

  describe('getAssetMetadata keeps its old contract', () => {
    it('still throws, with the first failure in field order', async () => {
      const panic = fails('Contract panic');
      contract({ name: panic, symbol: panic, decimals: panic });
      await expect(getAssetMetadata(CONTRACT, 'testnet')).rejects.toThrow(
        'SEP-41 contract call "name" failed: Contract panic',
      );
    });

    it('still returns plain metadata on the happy path', async () => {
      token(str('Test Asset'), str('TST'), u32(7));
      await expect(getAssetMetadata(CONTRACT, 'testnet')).resolves.toEqual({
        name: 'Test Asset',
        symbol: 'TST',
        decimals: 7,
      });
    });
  });

  describe('balance', () => {
    it('sends the account as an Address argument', async () => {
      contract({ balance: returns(i128(5_000_000n)) });
      await expect(getAssetBalance(CONTRACT, ADDRESS, 'testnet')).resolves.toBe(5_000_000n);

      expect(invocation(simulate.mock.calls[0][0])).toEqual({
        fn: 'balance',
        argTypes: ['scvAddress'],
        args: [ADDRESS],
      });
    });

    it.each([
      ['a balance below 2^64', 5_000_000n],
      ['2^64 + 5, which needs the high half', (1n << 64n) + 5n],
      ['2^64 - 1, an all-ones low half', (1n << 64n) - 1n],
      ['the largest i128', (1n << 127n) - 1n],
    ])('decodes %s exactly', async (_label, amount) => {
      contract({ balance: returns(i128(amount)) });
      await expect(getAssetBalance(CONTRACT, ADDRESS, 'testnet')).resolves.toBe(amount);
    });

    it('throws on a wrong-typed response rather than reporting a zero balance', async () => {
      contract({ balance: returns(u32(5)) });
      await expect(getAssetBalance(CONTRACT, ADDRESS, 'testnet')).rejects.toThrow(
        'expected scvI128, got scvU32',
      );
    });

    it('throws on a void response rather than reporting a zero balance', async () => {
      contract({ balance: returns(xdr.ScVal.scvVoid()) });
      await expect(getAssetBalance(CONTRACT, ADDRESS, 'testnet')).rejects.toThrow(
        'returned no result',
      );
    });

    it('rejects an address with a bad checksum before calling the RPC', async () => {
      const badChecksum = `${ADDRESS.slice(0, -1)}G`;
      await expect(getAssetBalance(CONTRACT, badChecksum, 'testnet')).rejects.toThrow(
        'Invalid Stellar address',
      );
      expect(simulate).not.toHaveBeenCalled();
    });
  });
});
