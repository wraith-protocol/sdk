import { describe, test, expect } from 'vitest';
import { xdr, Address, Keypair } from '@stellar/stellar-sdk';
import { parseAnnouncementEvent } from '../../../src/chains/stellar/announcements';
import { SCHEME_ID, SCHEME_ID_V2 } from '../../../src/chains/stellar/constants';
import { encodeSymbolTopic, encodeU32Topic } from '../../../src/chains/stellar/event-filters';
import { bytesToHex } from '../../../src/chains/stellar/utils';

function encodeAddressTopic(address: string): string {
  return Address.fromString(address).toScVal().toXDR('base64');
}

function encodeEventValue(addresses: string[], bytes: Uint8Array[]): string {
  const vec = [
    Address.fromString(addresses[0]).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(bytes[0])),
    xdr.ScVal.scvBytes(Buffer.from(bytes[1])),
  ];
  return xdr.ScVal.scvVec(vec).toXDR('base64');
}

describe('parseAnnouncementEvent', () => {
  const stealthAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  const caller = Keypair.random().publicKey();
  const ephemeralPubKey = new Uint8Array(32).fill(9);
  const metadata = new Uint8Array([0x2a]);

  test('parses v1 layout with stealth address in topics', () => {
    const event = {
      topic: [
        encodeSymbolTopic('announce'),
        encodeU32Topic(SCHEME_ID),
        encodeAddressTopic(stealthAddress),
      ],
      value: encodeEventValue([caller], [ephemeralPubKey, metadata]),
    };

    const parsed = parseAnnouncementEvent(event);
    expect(parsed).toEqual({
      schemeId: SCHEME_ID,
      stealthAddress,
      caller,
      ephemeralPubKey: bytesToHex(ephemeralPubKey),
      metadata: bytesToHex(metadata),
      viewTagBucket: undefined,
    });
  });

  test('parses v2 layout with view_tag_bucket in topics', () => {
    const bucket = 42;
    const event = {
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      topic: [
        encodeSymbolTopic('announce'),
        encodeU32Topic(SCHEME_ID_V2),
        encodeU32Topic(bucket),
        encodeU32Topic(0),
      ],
      value: encodeEventValue([stealthAddress], [ephemeralPubKey, metadata]),
    };

    const parsed = parseAnnouncementEvent(event);
    expect(parsed).toEqual({
      schemeId: SCHEME_ID_V2,
      stealthAddress,
      caller: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      ephemeralPubKey: bytesToHex(ephemeralPubKey),
      metadata: bytesToHex(metadata),
      viewTagBucket: bucket,
    });
  });

  test('returns null for unsupported topic counts', () => {
    expect(parseAnnouncementEvent({ topic: [encodeSymbolTopic('announce')] })).toBeNull();
    expect(
      parseAnnouncementEvent({
        topic: [
          encodeSymbolTopic('announce'),
          encodeU32Topic(1),
          encodeU32Topic(2),
          encodeU32Topic(3),
          encodeU32Topic(4),
        ],
        value: encodeEventValue(
          [Keypair.random().publicKey()],
          [new Uint8Array(32), new Uint8Array([0])],
        ),
      }),
    ).toBeNull();
  });
});

describe('mixed v1/v2 ingestion', () => {
  test('deduplicates identical events from overlapping filter batches', () => {
    const stealthAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const sharedEvent = {
      id: '0000000001-0000000001',
      topic: [
        encodeSymbolTopic('announce'),
        encodeU32Topic(SCHEME_ID_V2),
        encodeU32Topic(10),
        encodeU32Topic(0),
      ],
      value: encodeEventValue(
        [stealthAddress],
        [new Uint8Array(32).fill(1), new Uint8Array([0x10])],
      ),
    };

    const parsedOnce = parseAnnouncementEvent(sharedEvent);
    const parsedTwice = parseAnnouncementEvent(sharedEvent);

    expect(parsedOnce).not.toBeNull();
    expect(parsedTwice).toEqual(parsedOnce);
  });

  test('parses v1 and v2 events from the same ingestion batch', () => {
    const v1Stealth = Keypair.random().publicKey();
    const v2Stealth = Keypair.random().publicKey();

    const v1 = parseAnnouncementEvent({
      topic: [
        encodeSymbolTopic('announce'),
        encodeU32Topic(SCHEME_ID),
        encodeAddressTopic(v1Stealth),
      ],
      value: encodeEventValue(
        [Keypair.random().publicKey()],
        [new Uint8Array(32).fill(2), new Uint8Array([0x01])],
      ),
    });

    const v2 = parseAnnouncementEvent({
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      topic: [
        encodeSymbolTopic('announce'),
        encodeU32Topic(SCHEME_ID_V2),
        encodeU32Topic(1),
        encodeU32Topic(0),
      ],
      value: encodeEventValue([v2Stealth], [new Uint8Array(32).fill(3), new Uint8Array([0x01])]),
    });

    expect(v1?.schemeId).toBe(SCHEME_ID);
    expect(v2?.schemeId).toBe(SCHEME_ID_V2);
    expect(v1?.viewTagBucket).toBeUndefined();
    expect(v2?.viewTagBucket).toBe(1);
  });
});
