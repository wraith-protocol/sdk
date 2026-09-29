import { describe, test, expect } from 'vitest';
import { computeEventIdentity } from '../../../src/chains/stellar/announcements';
import { encodeSymbolTopic, encodeU32Topic } from '../../../src/chains/stellar/event-filters';
import { SCHEME_ID_V2 } from '../../../src/chains/stellar/constants';

describe('computeEventIdentity', () => {
  test('returns null for events missing required fields', () => {
    expect(computeEventIdentity({})).toBeNull();
    expect(computeEventIdentity({ txHash: 'abc' })).toBeNull();
    expect(computeEventIdentity({ txHash: 'abc', ledger: 100 })).toBeNull();
    expect(computeEventIdentity({ txHash: 'abc', ledger: 100, contractId: 'CTEST' })).toBeNull();
  });

  test('computes deterministic identity from complete event', () => {
    const event = {
      id: '0000000100-0000000001',
      txHash: 'abc123',
      ledger: 100,
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      topic: [encodeSymbolTopic('announce'), encodeU32Topic(SCHEME_ID_V2), encodeU32Topic(10)],
    };

    const identity = computeEventIdentity(event);

    expect(identity).not.toBeNull();
    expect(identity?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(identity?.txHash).toBe('abc123');
    expect(identity?.ledger).toBe(100);
    expect(identity?.contractId).toBe('CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4');
    expect(identity?.topicsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('produces identical identities for identical events', () => {
    const event1 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce'), encodeU32Topic(1)],
    };

    const event2 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce'), encodeU32Topic(1)],
    };

    const identity1 = computeEventIdentity(event1);
    const identity2 = computeEventIdentity(event2);

    expect(identity1).not.toBeNull();
    expect(identity2).not.toBeNull();
    expect(identity1?.id).toBe(identity2?.id);
  });

  test('produces different identities for events with different txHash', () => {
    const event1 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    const event2 = {
      id: '0000000200-0000000001',
      txHash: 'tx456',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    const identity1 = computeEventIdentity(event1);
    const identity2 = computeEventIdentity(event2);

    expect(identity1?.id).not.toBe(identity2?.id);
  });

  test('produces different identities for events with different ledger', () => {
    const event1 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    const event2 = {
      id: '0000000201-0000000001',
      txHash: 'tx123',
      ledger: 201,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    const identity1 = computeEventIdentity(event1);
    const identity2 = computeEventIdentity(event2);

    expect(identity1?.id).not.toBe(identity2?.id);
  });

  test('produces different identities for events with different contractId', () => {
    const event1 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST1',
      topic: [encodeSymbolTopic('announce')],
    };

    const event2 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST2',
      topic: [encodeSymbolTopic('announce')],
    };

    const identity1 = computeEventIdentity(event1);
    const identity2 = computeEventIdentity(event2);

    expect(identity1?.id).not.toBe(identity2?.id);
  });

  test('produces different identities for events with different topics', () => {
    const event1 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce'), encodeU32Topic(1)],
    };

    const event2 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce'), encodeU32Topic(2)],
    };

    const identity1 = computeEventIdentity(event1);
    const identity2 = computeEventIdentity(event2);

    expect(identity1?.id).not.toBe(identity2?.id);
  });

  test('handles both contractId and contract_id field names', () => {
    const event1 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    const event2 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contract_id: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    const identity1 = computeEventIdentity(event1);
    const identity2 = computeEventIdentity(event2);

    expect(identity1?.id).toBe(identity2?.id);
  });

  test('produces different identities for multiple events in same transaction', () => {
    // Two announcements in the same transaction, same ledger, same contract, same topics
    // but different event indices should have different identities
    const event1 = {
      id: '0000000100-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    const event2 = {
      id: '0000000100-0000000002',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    const identity1 = computeEventIdentity(event1);
    const identity2 = computeEventIdentity(event2);

    // Different event indices within the same transaction should produce different identities
    expect(identity1?.id).not.toBe(identity2?.id);
  });
});

describe('cross-chunk deduplication', () => {
  test('deduplicates events from different RPC pages', () => {
    const sharedEvent = {
      txHash: 'shared-tx',
      ledger: 100,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce'), encodeU32Topic(SCHEME_ID_V2)],
    };

    // Simulate same event appearing in two different RPC responses with same event index
    const page1Event = { ...sharedEvent, id: '0000000100-0000000001' };
    const page2Event = { ...sharedEvent, id: '0000000100-0000000001' }; // Same event index

    const identity1 = computeEventIdentity(page1Event);
    const identity2 = computeEventIdentity(page2Event);

    expect(identity1?.id).toBe(identity2?.id);
  });

  test('deduplicates events from different RPC providers', () => {
    const baseEvent = {
      txHash: 'provider-test-tx',
      ledger: 500,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    // Same event with same event index from different providers
    const providerA = { ...baseEvent, id: '0000000500-0000000003' };
    const providerB = { ...baseEvent, id: '0000000500-0000000003' }; // Same ledger-index

    const identityA = computeEventIdentity(providerA);
    const identityB = computeEventIdentity(providerB);

    expect(identityA?.id).toBe(identityB?.id);
  });

  test('handles event batches with overlapping results', () => {
    const baseEvent = {
      txHash: 'overlap-tx',
      ledger: 300,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce'), encodeU32Topic(42)],
    };

    // Multiple instances of the same event (same event index) with different provider metadata
    const instances = [
      { ...baseEvent, id: '0000000300-0000000005' },
      { ...baseEvent, id: '0000000300-0000000005' },
      { ...baseEvent, id: '0000000300-0000000005' },
    ];

    const identities = instances.map(computeEventIdentity);

    // All should have the same deterministic identity
    expect(identities[0]?.id).toBe(identities[1]?.id);
    expect(identities[1]?.id).toBe(identities[2]?.id);
  });
});

describe('provider variations', () => {
  test('handles missing optional fields consistently', () => {
    const event1 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
      extraField: 'ignored',
    };

    const event2 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    const identity1 = computeEventIdentity(event1);
    const identity2 = computeEventIdentity(event2);

    expect(identity1?.id).toBe(identity2?.id);
  });

  test('topic order matters for identity', () => {
    const event1 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce'), encodeU32Topic(1), encodeU32Topic(2)],
    };

    const event2 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce'), encodeU32Topic(2), encodeU32Topic(1)],
    };

    const identity1 = computeEventIdentity(event1);
    const identity2 = computeEventIdentity(event2);

    // Different topic order should produce different identities
    expect(identity1?.id).not.toBe(identity2?.id);
  });

  test('handles numeric ledger field variants', () => {
    const event1 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: 200,
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    const event2 = {
      id: '0000000200-0000000001',
      txHash: 'tx123',
      ledger: '200',
      contractId: 'CTEST',
      topic: [encodeSymbolTopic('announce')],
    };

    const identity1 = computeEventIdentity(event1);
    const identity2 = computeEventIdentity(event2);

    // String ledger should result in null identity
    expect(identity1).not.toBeNull();
    expect(identity2).toBeNull();
  });
});
