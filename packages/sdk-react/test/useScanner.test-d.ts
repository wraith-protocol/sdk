import { describe, expectTypeOf, test } from 'vitest';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { useScanner, type UseScannerResult } from '../src/hooks/useScanner';

describe('useScanner option types', () => {
  test('accepts the Stellar deployment, a wallet, and a cancellation signal', () => {
    expectTypeOf(
      useScanner({
        chain: 'stellar',
        wallet: 'GABCDEF',
        signal: new AbortController().signal,
      }),
    ).toEqualTypeOf<UseScannerResult>();
  });

  test('rejects chains the React scanner cannot read', () => {
    // @ts-expect-error - the React scanner only reads Stellar announcements
    useScanner({ chain: 'evm' });
  });

  test('rejects non-string wallets', () => {
    // @ts-expect-error - wallet must be a Stellar address string
    useScanner({ wallet: 42 });
  });

  test('scan options use the shared cancellation shape', () => {
    const result = null as unknown as UseScannerResult;

    expectTypeOf(result.scan({ signal: new AbortController().signal })).toEqualTypeOf<
      Promise<Announcement[]>
    >();

    // @ts-expect-error - fromLedger must be a number
    void result.scan({ fromLedger: '10' });

    // @ts-expect-error - signal must be an AbortSignal
    void result.scan({ signal: 'stop' });
  });
});
