/** Builders for EVM subgraph response fixtures used by the validation tests. */

export const STEALTH_ADDRESS = '0x' + '11'.repeat(20);
export const CALLER = '0x' + '22'.repeat(20);
export const EPHEMERAL_PUB_KEY = '0x02' + '33'.repeat(32);
export const METADATA = '0x01';

/** A valid announcement record as the subgraph returns it. */
export function announcementRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemeId: '1',
    stealthAddress: STEALTH_ADDRESS,
    caller: CALLER,
    ephemeralPubKey: EPHEMERAL_PUB_KEY,
    metadata: METADATA,
    ...overrides,
  };
}

/** A valid subgraph page, optionally shaped like a gateway variant. */
export function subgraphPage(
  records: unknown[] = [announcementRecord()],
  variant: 'plain' | 'result' | 'double-data' | 'nodes' = 'plain',
): Record<string, unknown> {
  switch (variant) {
    case 'result':
      return { result: { data: { announcements: records } } };
    case 'double-data':
      return { data: { data: { announcements: records } } };
    case 'nodes':
      return { data: { announcements: { nodes: records } } };
    default:
      return { data: { announcements: records } };
  }
}
