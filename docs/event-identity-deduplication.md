# Event Identity and Cross-Chunk Deduplication

## Overview

The Stellar announcement scanning system uses **deterministic event identity** to ensure reliable deduplication across RPC providers, pagination boundaries, and multiple scan sessions.

## Problem Statement

### Before (Provider-Dependent Deduplication)

```typescript
// Old approach: relies on provider-specific IDs
const dedupeKey = String(event.id ?? `${event.txHash}:${JSON.stringify(event.topic)}`);
```

**Issues:**

- Provider-specific `event.id` values differ across RPC endpoints
- `JSON.stringify(event.topic)` is not deterministic
- No way to persist deduplication state across scan sessions
- Duplicate events can appear when:
  - Switching RPC providers mid-scan
  - Resuming scans with pagination cursors
  - Scanning overlapping ledger ranges
  - Using multiple view-tag bucket filters

### After (Deterministic Identity)

```typescript
// New approach: computes stable identity from canonical fields
const identity = computeEventIdentity(event);
if (identity) {
  dedupeSet.add(identity.id); // SHA-256 hash of canonical data
}
```

**Benefits:**

- Stable across all RPC providers
- Survives pagination and chunking
- Can be persisted for stateful deduplication
- Works consistently in parallel scans

## Event Identity Structure

```typescript
interface EventIdentity {
  /** Hex-encoded SHA-256 hash of canonical event fields */
  id: string;
  /** Transaction hash containing this event */
  txHash: string;
  /** Ledger sequence number */
  ledger: number;
  /** Contract ID that emitted the event */
  contractId: string;
  /** Canonical hex encoding of the event topics */
  topicsHash: string;
}
```

## Identity Computation

The deterministic identity is computed as follows:

```
topicsHash = SHA-256(JSON.stringify(topics))
canonical = "stellar:{txHash}:{ledger}:{contractId}:{topicsHash}"
identity.id = SHA-256(canonical)
```

This ensures:

1. **Chain-specific**: Includes "stellar" prefix
2. **Transaction-unique**: Uses txHash
3. **Ledger-specific**: Includes ledger number
4. **Contract-specific**: Tied to contractId
5. **Topic-deterministic**: SHA-256 of topics for stable comparison

## Usage Examples

### Basic Scanning (Automatic Deduplication)

```typescript
import { fetchAnnouncementsStream } from '@wraith-protocol/sdk/chains/stellar';

// Automatic in-memory deduplication within a single scan
for await (const announcement of fetchAnnouncementsStream('stellar', {
  fromLedger: 1000,
  toLedger: 2000,
})) {
  // Process unique announcements
  console.log(announcement);
}
```

### Cross-Chunk Deduplication (Stateful)

```typescript
import {
  fetchAnnouncementsStream,
  computeEventIdentity,
} from '@wraith-protocol/sdk/chains/stellar';

// Persistent deduplication across multiple scan sessions
const seenIds = loadSeenIdsFromDatabase(); // Load previously seen IDs

for await (const announcement of fetchAnnouncementsStream('stellar', {
  fromLedger: 2000,
  toLedger: 3000,
  seenEventIds: seenIds, // Pass in previously seen IDs
})) {
  // Only new announcements will be yielded
  console.log(announcement);
}
```

### Manual Identity Computation

```typescript
import { computeEventIdentity } from '@wraith-protocol/sdk/chains/stellar';

const event = {
  txHash: 'abc123...',
  ledger: 12345,
  contractId: 'CAAAA...',
  topic: ['announce', '...'],
};

const identity = computeEventIdentity(event);

if (identity) {
  // Store identity for future deduplication
  await database.saveEventId(identity.id);

  // Check if already processed
  if (await database.hasEventId(identity.id)) {
    console.log('Already processed this event');
  }
}
```

### Parallel Scanning with Shared Deduplication

```typescript
import { fetchAnnouncementsStream } from '@wraith-protocol/sdk/chains/stellar';

const seenIds = new Set<string>();

// Scan multiple bucket ranges in parallel
const bucketRanges = [
  [0, 50],
  [51, 100],
  [101, 150],
  [151, 200],
  [201, 255],
];

const scanPromises = bucketRanges.map(async ([start, end]) => {
  const buckets = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  const announcements = [];
  for await (const ann of fetchAnnouncementsStream('stellar', {
    viewTagBuckets: buckets,
    seenEventIds: seenIds, // Shared deduplication set
  })) {
    announcements.push(ann);
  }
  return announcements;
});

const results = await Promise.all(scanPromises);
// All results will be deduplicated across bucket ranges
```

## API Reference

### `computeEventIdentity(event)`

Computes a deterministic event identity from a Soroban RPC event object.

**Parameters:**

- `event: Record<string, unknown>` - Raw event object from Soroban RPC

**Returns:**

- `EventIdentity | null` - Event identity, or null if required fields are missing

**Required Event Fields:**

- `txHash: string` - Transaction hash
- `ledger: number` - Ledger sequence number
- `contractId` or `contract_id: string` - Contract address
- `topic: unknown[]` - Event topics array

**Example:**

```typescript
const identity = computeEventIdentity(event);
if (identity) {
  console.log('Event ID:', identity.id);
  console.log('From ledger:', identity.ledger);
}
```

### `FetchAnnouncementsOptions.seenEventIds`

Pass a Set of previously seen event identity hashes to skip them during scanning.

**Type:** `Set<string> | undefined`

**Usage:**

```typescript
const seenIds = new Set(['abc123...', 'def456...']);

for await (const ann of fetchAnnouncementsStream('stellar', {
  seenEventIds: seenIds,
})) {
  // ann is guaranteed not to match any ID in seenIds
  const identity = computeEventIdentity(ann);
  if (identity) {
    seenIds.add(identity.id); // Update for next scan
  }
}
```

## Testing

The implementation includes comprehensive test coverage:

- **Unit Tests** (`test/chains/stellar/event-identity.test.ts`):
  - Identity computation edge cases
  - Field variations and null handling
  - Provider-independent behavior
  - Cross-chunk deduplication scenarios

- **Integration Tests** (`test/chains/stellar/announcements.test.ts`):
  - Multi-page deduplication
  - Stateful deduplication with `seenEventIds`
  - v1/v2 announcement mixing
  - Filter group boundary deduplication
  - View-tag bucket overlaps

## Migration Guide

### From v1.x to v2.0

**No breaking changes for existing code** - automatic deduplication works the same way.

**New capabilities available:**

1. **Persist deduplication state:**

```typescript
// Before: in-memory only
for await (const ann of fetchAnnouncementsStream('stellar')) {
  // Process
}

// After: persistent across sessions
const seenIds = await loadFromDatabase();
for await (const ann of fetchAnnouncementsStream('stellar', { seenEventIds: seenIds })) {
  // Process only new events
  const identity = computeEventIdentity(ann);
  if (identity) await saveToDatabase(identity.id);
}
```

2. **Manual event identity computation:**

```typescript
import { computeEventIdentity } from '@wraith-protocol/sdk/chains/stellar';

// Compute stable IDs for custom deduplication logic
const identity = computeEventIdentity(event);
```

## Performance Considerations

- **Identity Computation**: ~0.05ms per event (2 SHA-256 hashes)
- **Memory Usage**: ~64 bytes per unique event ID in deduplication set
- **Persistence**: Event IDs are 64-character hex strings, easily stored in databases

**Recommendations:**

- For long-running applications, periodically prune old event IDs based on ledger range
- Use indexed database columns for fast event ID lookups
- Consider bloom filters for very large historical deduplication sets

## Architecture Notes

The implementation follows these principles:

1. **Provider-Independent**: Never relies on RPC-specific event.id values
2. **Deterministic**: Same event always produces same identity hash
3. **Collision-Resistant**: SHA-256 ensures negligible collision probability
4. **Efficient**: Single pass through events with O(1) set lookups
5. **Stateless**: Event identity can be recomputed from event data alone
6. **Composable**: Works with all scan modes (v1, v2, buckets, cursors)

## Related Documentation

- [Stellar Announcements API](./stellar-announcements.md)
- [View Tag Batching](./chains/stellar-view-tag-batching.md)
- [Offline Scanning Patterns](./offline-signing.md)

## Support

For questions or issues related to event identity and deduplication:

- GitHub Issues: https://github.com/wraith-protocol/sdk/issues
- Documentation: https://docs.wraith.dev/sdk
