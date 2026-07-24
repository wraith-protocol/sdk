import { describe, it, expect } from 'vitest';
import {
  encodeMemoSchema,
  decodeMemoSchema,
  MemoKind,
  MEMO_SCHEMA_VERSION,
  SCHEMA_MEMO_BYTES,
  SCHEMA_HEADER_BYTES,
  SCHEMA_MAX_DATA_BYTES,
} from '../../../../src/chains/stellar/memo/schema';
import { bytesToHex, hexToBytes } from '../../../../src/chains/stellar/utils';

describe('MemoSchema', () => {
  describe('encodeMemoSchema', () => {
    it('encodes a reason kind with string data', () => {
      const bytes = encodeMemoSchema(MemoKind.Reason, 'Invoice #123');
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(SCHEMA_MEMO_BYTES);
      expect(bytes[0]).toBe(MEMO_SCHEMA_VERSION);
      expect(bytes[1]).toBe(MemoKind.Reason);
    });

    it('encodes an invoice_id kind', () => {
      const bytes = encodeMemoSchema(MemoKind.InvoiceId, 'INV-2024-001');
      expect(bytes[1]).toBe(MemoKind.InvoiceId);
    });

    it('encodes a reference kind with binary data', () => {
      const refData = new Uint8Array([0xab, 0xcd, 0xef]);
      const bytes = encodeMemoSchema(MemoKind.Reference, refData);
      expect(bytes[1]).toBe(MemoKind.Reference);
      expect(bytes[2]).toBe(3);
      expect(bytes.slice(3, 6)).toEqual(refData);
    });

    it('encodes with correct data_length header', () => {
      const data = 'hi';
      const bytes = encodeMemoSchema(MemoKind.Reason, data);
      expect(bytes[2]).toBe(2);
      expect(bytes[3]).toBe(0x68); // 'h'
      expect(bytes[4]).toBe(0x69); // 'i'
    });

    it('zero-pads remaining bytes', () => {
      const bytes = encodeMemoSchema(MemoKind.Reason, 'a');
      for (let i = SCHEMA_HEADER_BYTES + 1; i < SCHEMA_MEMO_BYTES; i++) {
        expect(bytes[i]).toBe(0);
      }
    });

    it('throws when data exceeds maximum length', () => {
      const longData = 'x'.repeat(SCHEMA_MAX_DATA_BYTES + 1);
      expect(() => encodeMemoSchema(MemoKind.Reason, longData)).toThrow('exceeds maximum');
    });

    it('accepts data at exactly maximum length', () => {
      const maxData = 'x'.repeat(SCHEMA_MAX_DATA_BYTES);
      expect(() => encodeMemoSchema(MemoKind.Reason, maxData)).not.toThrow();
      const bytes = encodeMemoSchema(MemoKind.Reason, maxData);
      expect(bytes[2]).toBe(SCHEMA_MAX_DATA_BYTES);
    });

    it('accepts zero-length data', () => {
      const bytes = encodeMemoSchema(MemoKind.Reason, '');
      expect(bytes[2]).toBe(0);
      const decoded = decodeMemoSchema(bytes);
      expect(decoded.schema?.data.length).toBe(0);
    });

    it('encodes UTF-8 multi-byte characters', () => {
      const emoji = '😀';
      const bytes = encodeMemoSchema(MemoKind.Reason, emoji);
      // 😀 is 4 bytes in UTF-8: F0 9F 98 80
      expect(bytes[2]).toBe(4);
      expect(bytes.slice(3, 7)).toEqual(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]));
    });
  });

  describe('decodeMemoSchema', () => {
    it('decodes a schema-shaped buffer with reason kind', () => {
      const original = 'Payment for order';
      const encoded = encodeMemoSchema(MemoKind.Reason, original);
      const decoded = decodeMemoSchema(encoded);

      expect(decoded.schema).toBeDefined();
      expect(decoded.schema!.version).toBe(MEMO_SCHEMA_VERSION);
      expect(decoded.schema!.kind).toBe(MemoKind.Reason);
      expect(new TextDecoder().decode(decoded.schema!.data)).toBe(original);
    });

    it('decodes a schema-shaped buffer with invoice_id kind', () => {
      const original = 'INV-2025-999';
      const encoded = encodeMemoSchema(MemoKind.InvoiceId, original);
      const decoded = decodeMemoSchema(encoded);

      expect(decoded.schema).toBeDefined();
      expect(decoded.schema!.kind).toBe(MemoKind.InvoiceId);
      expect(new TextDecoder().decode(decoded.schema!.data)).toBe(original);
    });

    it('decodes a schema-shaped buffer with reference kind', () => {
      const refData = new Uint8Array([0x01, 0x02, 0x03, 0xff]);
      const encoded = encodeMemoSchema(MemoKind.Reference, refData);
      const decoded = decodeMemoSchema(encoded);

      expect(decoded.schema).toBeDefined();
      expect(decoded.schema!.kind).toBe(MemoKind.Reference);
      expect(decoded.schema!.data).toEqual(refData);
    });

    it('returns raw result for buffers that are not schema-shaped', () => {
      const rawBytes = new Uint8Array(SCHEMA_MEMO_BYTES).fill(0xab);
      const decoded = decodeMemoSchema(rawBytes);

      expect(decoded.schema).toBeUndefined();
      expect(decoded.bytes).toEqual(rawBytes);
    });

    it('returns raw result for buffer starting with 0x02 (non-version)', () => {
      const bytes = new Uint8Array(SCHEMA_MEMO_BYTES);
      bytes[0] = 0x02;
      bytes[1] = 0x01;
      const decoded = decodeMemoSchema(bytes);
      expect(decoded.schema).toBeUndefined();
    });

    it('preserves the original bytes in the result', () => {
      const encoded = encodeMemoSchema(MemoKind.Reason, 'test');
      const decoded = decodeMemoSchema(encoded);
      expect(decoded.bytes).toEqual(encoded);
      expect(decoded.bytes.length).toBe(SCHEMA_MEMO_BYTES);
    });
  });

  describe('round-trip', () => {
    it('round-trips a reason string', () => {
      const data = 'Payment for order #12345';
      const encoded = encodeMemoSchema(MemoKind.Reason, data);
      const decoded = decodeMemoSchema(encoded);
      expect(new TextDecoder().decode(decoded.schema!.data)).toBe(data);
    });

    it('round-trips an invoice id string', () => {
      const data = 'INV-12345-ABC';
      const encoded = encodeMemoSchema(MemoKind.InvoiceId, data);
      const decoded = decodeMemoSchema(encoded);
      expect(new TextDecoder().decode(decoded.schema!.data)).toBe(data);
    });

    it('round-trips binary reference data', () => {
      const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const encoded = encodeMemoSchema(MemoKind.Reference, data);
      const decoded = decodeMemoSchema(encoded);
      expect(decoded.schema!.data).toEqual(data);
    });

    it('round-trips all kinds deterministically', () => {
      const testCases = [
        { kind: MemoKind.Reason, data: 'test' },
        { kind: MemoKind.InvoiceId, data: 'INV-001' },
        { kind: MemoKind.Reference, data: new Uint8Array([0x01, 0x02]) },
      ];

      for (const tc of testCases) {
        const encoded1 = encodeMemoSchema(tc.kind, tc.data);
        const encoded2 = encodeMemoSchema(tc.kind, tc.data);
        expect(encoded1).toEqual(encoded2);

        const decoded = decodeMemoSchema(encoded1);
        expect(decoded.schema!.kind).toBe(tc.kind);
      }
    });

    it('round-trips empty string data', () => {
      const encoded = encodeMemoSchema(MemoKind.Reason, '');
      const decoded = decodeMemoSchema(encoded);
      expect(decoded.schema!.data.length).toBe(0);
    });

    it('round-trips max-length string data', () => {
      const data = 'x'.repeat(SCHEMA_MAX_DATA_BYTES);
      const encoded = encodeMemoSchema(MemoKind.Reason, data);
      const decoded = decodeMemoSchema(encoded);
      expect(new TextDecoder().decode(decoded.schema!.data)).toBe(data);
    });
  });

  describe('backwards compatibility', () => {
    it('treats arbitrary 32-byte hash as raw bytes', () => {
      const hashBytes = hexToBytes('deadbeef' + '00'.repeat(28));
      const decoded = decodeMemoSchema(hashBytes);
      expect(decoded.schema).toBeUndefined();
    });

    it('treats all-zero buffer as raw bytes', () => {
      const zeros = new Uint8Array(SCHEMA_MEMO_BYTES);
      const decoded = decodeMemoSchema(zeros);
      expect(decoded.schema).toBeUndefined();
    });

    it('treats buffer starting with version byte but wrong length as raw', () => {
      // A buffer that starts with 0x01 but is not 32 bytes long
      const short = new Uint8Array([MEMO_SCHEMA_VERSION, 0x01, 0x00]);
      const decoded = decodeMemoSchema(short);
      expect(decoded.schema).toBeUndefined();
    });
  });

  describe('extension mechanism', () => {
    it('decodes unknown kind values without throwing', () => {
      const bytes = new Uint8Array(SCHEMA_MEMO_BYTES);
      bytes[0] = MEMO_SCHEMA_VERSION;
      bytes[1] = 0x42; // unknown kind
      bytes[2] = 2;
      bytes[3] = 0xaa;
      bytes[4] = 0xbb;

      const decoded = decodeMemoSchema(bytes);
      expect(decoded.schema).toBeDefined();
      expect(decoded.schema!.kind).toBe(0x42);
      expect(decoded.schema!.data).toEqual(new Uint8Array([0xaa, 0xbb]));
    });

    it('decodes private/experimental range kinds (0xF0-0xFF)', () => {
      for (const kind of [0xf0, 0xff]) {
        const bytes = new Uint8Array(SCHEMA_MEMO_BYTES);
        bytes[0] = MEMO_SCHEMA_VERSION;
        bytes[1] = kind;
        bytes[2] = 1;
        bytes[3] = 0x99;

        const decoded = decodeMemoSchema(bytes);
        expect(decoded.schema).toBeDefined();
        expect(decoded.schema!.kind).toBe(kind);
        expect(decoded.schema!.data).toEqual(new Uint8Array([0x99]));
      }
    });

    it('clamps data_length that exceeds max data bytes', () => {
      const bytes = new Uint8Array(SCHEMA_MEMO_BYTES);
      bytes[0] = MEMO_SCHEMA_VERSION;
      bytes[1] = 0x01;
      bytes[2] = 255; // larger than max
      bytes[3] = 0xaa;

      const decoded = decodeMemoSchema(bytes);
      expect(decoded.schema!.data.length).toBe(SCHEMA_MAX_DATA_BYTES);
    });
  });

  describe('edge cases', () => {
    it('handles single-byte data', () => {
      const data = new Uint8Array([0x42]);
      const encoded = encodeMemoSchema(MemoKind.Reference, data);
      const decoded = decodeMemoSchema(encoded);
      expect(decoded.schema!.data).toEqual(data);
    });

    it('handles all-zeros data', () => {
      const data = new Uint8Array(10);
      const encoded = encodeMemoSchema(MemoKind.Reference, data);
      const decoded = decodeMemoSchema(encoded);
      expect(decoded.schema!.data).toEqual(data);
    });

    it('produces exactly 32 bytes', () => {
      const bytes = encodeMemoSchema(MemoKind.Reason, 'hello');
      expect(bytes.length).toBe(32);
    });

    it('header bytes are in correct positions', () => {
      const bytes = encodeMemoSchema(MemoKind.InvoiceId, 'test');
      // [0] = version
      expect(bytes[0]).toBe(0x01);
      // [1] = kind
      expect(bytes[1]).toBe(0x02);
      // [2] = data_length
      expect(bytes[2]).toBe(4);
    });
  });

  describe('exports', () => {
    it('exports constants with expected values', () => {
      expect(MEMO_SCHEMA_VERSION).toBe(0x01);
      expect(SCHEMA_MEMO_BYTES).toBe(32);
      expect(SCHEMA_HEADER_BYTES).toBe(3);
      expect(SCHEMA_MAX_DATA_BYTES).toBe(29);
    });

    it('exports MemoKind enum values', () => {
      expect(MemoKind.Reason).toBe(0x01);
      expect(MemoKind.InvoiceId).toBe(0x02);
      expect(MemoKind.Reference).toBe(0x03);
    });
  });
});
