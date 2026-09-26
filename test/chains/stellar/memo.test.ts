import { describe, it, expect } from 'vitest';
import {
  Memo,
  TransactionBuilder,
  Account,
  Networks,
  Operation,
  Asset,
} from '@stellar/stellar-sdk';
import {
  encodeMemo,
  decodeMemo,
  extractMemoFromTransaction,
  MemoValidationError,
  TEXT_MEMO_MAX_BYTES,
  HASH_MEMO_BYTES,
  ID_MEMO_MAX,
} from '../../../src/chains/stellar/memo';

// A well-formed StrKey account address used for building transactions in tests.
// It does not need to exist on any network — only the ed25519 accountId must
// pass the SDK's StrKey validation.
const TEST_SOURCE_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const TEST_DEST_ADDRESS = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

describe('encodeMemo', () => {
  describe('none memo', () => {
    it('encodes none memo', () => {
      const memo = encodeMemo({ type: 'none', value: null });
      expect(memo.type).toBe('none');
    });
  });

  describe('id memo', () => {
    it('encodes valid id memo from string', () => {
      const memo = encodeMemo({ type: 'id', value: '12345' });
      expect(memo.type).toBe('id');
      expect(String(memo.value)).toBe('12345');
    });

    it('encodes valid id memo from Uint8Array', () => {
      const value = new TextEncoder().encode('12345');
      const memo = encodeMemo({ type: 'id', value });
      expect(memo.type).toBe('id');
      expect(String(memo.value)).toBe('12345');
    });

    it('throws when value is null', () => {
      expect(() => encodeMemo({ type: 'id', value: null })).toThrow(MemoValidationError);
      expect(() => encodeMemo({ type: 'id', value: null })).toThrow('ID memo requires a value');
    });

    it('throws when value is invalid uint64', () => {
      expect(() => encodeMemo({ type: 'id', value: 'not a number' })).toThrow(MemoValidationError);
      expect(() => encodeMemo({ type: 'id', value: 'not a number' })).toThrow(
        'valid uint64 string',
      );
    });

    it('throws when value exceeds uint64 max', () => {
      const maxValue = ID_MEMO_MAX.toString();
      const tooLarge = (ID_MEMO_MAX + BigInt(1)).toString();

      // Max value should work
      expect(() => encodeMemo({ type: 'id', value: maxValue })).not.toThrow();

      // One over max should fail
      expect(() => encodeMemo({ type: 'id', value: tooLarge })).toThrow(MemoValidationError);
    });

    it('throws when value is negative', () => {
      expect(() => encodeMemo({ type: 'id', value: '-1' })).toThrow(MemoValidationError);
    });
  });

  describe('text memo', () => {
    it('encodes valid text memo from string', () => {
      const memo = encodeMemo({ type: 'text', value: 'Payment #123' });
      expect(memo.type).toBe('text');
      expect(String(memo.value)).toBe('Payment #123');
    });

    it('encodes valid text memo from Uint8Array', () => {
      const value = new TextEncoder().encode('Payment #123');
      const memo = encodeMemo({ type: 'text', value });
      expect(memo.type).toBe('text');
      expect(String(memo.value)).toBe('Payment #123');
    });

    it('throws when value is null', () => {
      expect(() => encodeMemo({ type: 'text', value: null })).toThrow(MemoValidationError);
      expect(() => encodeMemo({ type: 'text', value: null })).toThrow('Text memo requires a value');
    });

    it('throws when text exceeds 28 bytes', () => {
      const longText = 'a'.repeat(29);
      expect(() => encodeMemo({ type: 'text', value: longText })).toThrow(MemoValidationError);
      expect(() => encodeMemo({ type: 'text', value: longText })).toThrow(/28 bytes/);
    });

    it('accepts text exactly at 28 bytes', () => {
      const exactText = 'a'.repeat(28);
      expect(() => encodeMemo({ type: 'text', value: exactText })).not.toThrow();
    });

    it('handles multi-byte characters correctly', () => {
      // Each emoji is 4 bytes, so 7 emojis = 28 bytes (valid)
      const emojiText = '😀😀😀😀😀😀😀';
      expect(() => encodeMemo({ type: 'text', value: emojiText })).not.toThrow();

      // 8 emojis = 32 bytes (too long)
      const tooLongEmoji = '😀😀😀😀😀😀😀😀';
      expect(() => encodeMemo({ type: 'text', value: tooLongEmoji })).toThrow(MemoValidationError);
    });
  });

  describe('hash memo', () => {
    it('encodes valid hash memo from hex string', () => {
      const hexValue = 'a'.repeat(64); // 32 bytes in hex
      const memo = encodeMemo({ type: 'hash', value: hexValue });
      expect(memo.type).toBe('hash');
      expect((memo.value as { length: number }).length).toBe(HASH_MEMO_BYTES);
    });

    it('encodes valid hash memo from Uint8Array', () => {
      const value = new Uint8Array(HASH_MEMO_BYTES).fill(0xaa);
      const memo = encodeMemo({ type: 'hash', value });
      expect(memo.type).toBe('hash');
      expect((memo.value as { length: number }).length).toBe(HASH_MEMO_BYTES);
    });

    it('throws when value is null', () => {
      expect(() => encodeMemo({ type: 'hash', value: null })).toThrow(MemoValidationError);
      expect(() => encodeMemo({ type: 'hash', value: null })).toThrow('Hash memo requires a value');
    });

    it('throws when hash is not 32 bytes', () => {
      const shortHash = new Uint8Array(16);
      expect(() => encodeMemo({ type: 'hash', value: shortHash })).toThrow(MemoValidationError);
      expect(() => encodeMemo({ type: 'hash', value: shortHash })).toThrow(/32 bytes/);

      const longHash = new Uint8Array(64);
      expect(() => encodeMemo({ type: 'hash', value: longHash })).toThrow(MemoValidationError);
    });

    it('throws when hex string is invalid', () => {
      expect(() => encodeMemo({ type: 'hash', value: 'not hex' })).toThrow();
    });
  });

  describe('return memo', () => {
    it('encodes valid return memo from hex string', () => {
      const hexValue = 'b'.repeat(64); // 32 bytes in hex
      const memo = encodeMemo({ type: 'return', value: hexValue });
      expect(memo.type).toBe('return');
      expect((memo.value as { length: number }).length).toBe(HASH_MEMO_BYTES);
    });

    it('encodes valid return memo from Uint8Array', () => {
      const value = new Uint8Array(HASH_MEMO_BYTES).fill(0xbb);
      const memo = encodeMemo({ type: 'return', value });
      expect(memo.type).toBe('return');
      expect((memo.value as { length: number }).length).toBe(HASH_MEMO_BYTES);
    });

    it('throws when value is null', () => {
      expect(() => encodeMemo({ type: 'return', value: null })).toThrow(MemoValidationError);
      expect(() => encodeMemo({ type: 'return', value: null })).toThrow(
        'Return memo requires a value',
      );
    });

    it('throws when return is not 32 bytes', () => {
      const shortReturn = new Uint8Array(16);
      expect(() => encodeMemo({ type: 'return', value: shortReturn })).toThrow(MemoValidationError);
      expect(() => encodeMemo({ type: 'return', value: shortReturn })).toThrow(/32 bytes/);
    });
  });

  describe('unknown memo type', () => {
    it('throws for unknown type', () => {
      // @ts-expect-error - testing invalid type
      expect(() => encodeMemo({ type: 'unknown', value: 'test' })).toThrow(MemoValidationError);
      expect(() => encodeMemo({ type: 'unknown' as any, value: 'test' })).toThrow(
        'Unknown memo type',
      );
    });
  });
});

describe('decodeMemo', () => {
  describe('Memo object', () => {
    it('decodes none memo', () => {
      const memo = Memo.none();
      const decoded = decodeMemo(memo);
      expect(decoded.type).toBe('none');
      expect(decoded.value).toBe(null);
    });

    it('decodes id memo', () => {
      const memo = Memo.id('12345');
      const decoded = decodeMemo(memo);
      expect(decoded.type).toBe('id');
      expect(decoded.value).toBe('12345');
    });

    it('decodes text memo', () => {
      const memo = Memo.text('Payment #123');
      const decoded = decodeMemo(memo);
      expect(decoded.type).toBe('text');
      expect(decoded.value).toBe('Payment #123');
    });

    it('decodes hash memo', () => {
      const hashValue = new Uint8Array(HASH_MEMO_BYTES).fill(0xaa);
      const memo = Memo.hash(Buffer.from(hashValue));
      const decoded = decodeMemo(memo);
      expect(decoded.type).toBe('hash');
      expect(new Uint8Array(decoded.value as Uint8Array)).toEqual(hashValue);
    });

    it('decodes return memo', () => {
      const returnValue = new Uint8Array(HASH_MEMO_BYTES).fill(0xbb);
      const memo = Memo.return(Buffer.from(returnValue).toString('hex'));
      const decoded = decodeMemo(memo);
      expect(decoded.type).toBe('return');
      expect(new Uint8Array(decoded.value as Uint8Array)).toEqual(returnValue);
    });
  });

  describe('xdr.Memo object', () => {
    it('decodes xdr memo', () => {
      // Memo class doesn't expose toXDR directly on v13; go via toXDRObject().
      const memo = Memo.text('Test');
      const xdrMemo = memo.toXDRObject();
      const decoded = decodeMemo(xdrMemo);
      expect(decoded.type).toBe('text');
      expect(decoded.value).toBe('Test');
    });
  });
});

describe('extractMemoFromTransaction', () => {
  it('extracts memo from transaction', () => {
    const source = new Account(TEST_SOURCE_ADDRESS, '1');
    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: TEST_DEST_ADDRESS,
          asset: Asset.native(),
          amount: '100',
        }),
      )
      .addMemo(Memo.text('Payment #123'))
      .setTimeout(30)
      .build();

    const memo = extractMemoFromTransaction(tx);
    expect(memo.type).toBe('text');
    expect(memo.value).toBe('Payment #123');
  });

  it('extracts none memo from transaction without memo', () => {
    const source = new Account(TEST_SOURCE_ADDRESS, '1');
    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: TEST_DEST_ADDRESS,
          asset: Asset.native(),
          amount: '100',
        }),
      )
      .setTimeout(30)
      .build();

    const memo = extractMemoFromTransaction(tx);
    expect(memo.type).toBe('none');
    expect(memo.value).toBe(null);
  });

  it('extracts id memo from transaction', () => {
    const source = new Account(TEST_SOURCE_ADDRESS, '1');
    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: TEST_DEST_ADDRESS,
          asset: Asset.native(),
          amount: '100',
        }),
      )
      .addMemo(Memo.id('99999'))
      .setTimeout(30)
      .build();

    const memo = extractMemoFromTransaction(tx);
    expect(memo.type).toBe('id');
    expect(memo.value).toBe('99999');
  });
});

describe('constants', () => {
  it('exports TEXT_MEMO_MAX_BYTES', () => {
    expect(TEXT_MEMO_MAX_BYTES).toBe(28);
  });

  it('exports HASH_MEMO_BYTES', () => {
    expect(HASH_MEMO_BYTES).toBe(32);
  });

  it('exports ID_MEMO_MAX', () => {
    expect(ID_MEMO_MAX).toBe(BigInt('18446744073709551615'));
  });
});

describe('round-trip encoding/decoding', () => {
  it('round-trips none memo', () => {
    const original = { type: 'none' as const, value: null };
    const encoded = encodeMemo(original);
    const decoded = decodeMemo(encoded);
    expect(decoded).toEqual(original);
  });

  it('round-trips id memo', () => {
    const original = { type: 'id' as const, value: '12345' };
    const encoded = encodeMemo(original);
    const decoded = decodeMemo(encoded);
    expect(decoded).toEqual(original);
  });

  it('round-trips text memo', () => {
    const original = { type: 'text' as const, value: 'Payment #123' };
    const encoded = encodeMemo(original);
    const decoded = decodeMemo(encoded);
    expect(decoded).toEqual(original);
  });

  it('round-trips hash memo', () => {
    const hashValue = new Uint8Array(HASH_MEMO_BYTES).fill(0xaa);
    const original = { type: 'hash' as const, value: hashValue };
    const encoded = encodeMemo(original);
    const decoded = decodeMemo(encoded);
    expect(decoded.type).toBe(original.type);
    expect(new Uint8Array(decoded.value as Uint8Array)).toEqual(original.value);
  });

  it('round-trips return memo', () => {
    const returnValue = new Uint8Array(HASH_MEMO_BYTES).fill(0xbb);
    const original = { type: 'return' as const, value: returnValue };
    const encoded = encodeMemo(original);
    const decoded = decodeMemo(encoded);
    expect(decoded.type).toBe(original.type);
    expect(new Uint8Array(decoded.value as Uint8Array)).toEqual(original.value);
  });
});
