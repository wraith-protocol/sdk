import { describe, test, expect } from 'vitest';
import { extractMemo } from '../../../src/chains/stellar/utils';

describe('extractMemo', () => {
  test('returns null for memo_type none', () => {
    expect(extractMemo({ memo_type: 'none', memo: 'something' })).toBeNull();
  });

  test('returns null when memo_type is missing', () => {
    expect(extractMemo({})).toBeNull();
  });

  test('returns null when memo is missing', () => {
    expect(extractMemo({ memo_type: 'text' })).toBeNull();
  });

  test('handles text memo', () => {
    expect(extractMemo({ memo_type: 'text', memo: 'invoice 1234' })).toEqual({
      type: 'text',
      value: 'invoice 1234',
    });
  });

  test('handles id memo', () => {
    expect(extractMemo({ memo_type: 'id', memo: '9999' })).toEqual({
      type: 'id',
      value: '9999',
    });
  });

  test('handles hash memo (base64 from Horizon)', () => {
    // 4 zero bytes base64-encoded = "AAAAAA=="
    const result = extractMemo({ memo_type: 'hash', memo: 'AAAAAA==' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('hash');
    expect(result!.value).toBe('00000000');
  });

  test('handles return memo (base64 from Horizon)', () => {
    const result = extractMemo({ memo_type: 'return', memo: 'AAAAAA==' });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('return');
    expect(result!.value).toBe('00000000');
  });

  test('returns null for unknown memo_type', () => {
    expect(extractMemo({ memo_type: 'exotic', memo: 'foo' })).toBeNull();
  });
});
