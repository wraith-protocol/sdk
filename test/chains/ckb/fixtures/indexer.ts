/** Builders for CKB indexer `get_cells` response fixtures. */

export const TX_HASH = '0x' + 'ab'.repeat(32);
export const LOCK_ARGS = '0x' + '02' + 'cd'.repeat(32) + 'ef'.repeat(20);

/** A valid `get_cells` object as the indexer returns it. */
export function cellRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    out_point: { tx_hash: TX_HASH, index: '0x0' },
    output: {
      capacity: '0x174876e800',
      lock: {
        code_hash: '0x' + '99'.repeat(32),
        hash_type: 'data2',
        args: LOCK_ARGS,
      },
    },
    ...overrides,
  };
}

/** A valid `get_cells` page, optionally wrapped like a gateway variant. */
export function cellsPage(
  objects: unknown[] = [cellRecord()],
  options: { cursor?: unknown; variant?: 'result' | 'data' } = {},
): Record<string, unknown> {
  const result = {
    objects,
    last_cursor: options.cursor === undefined ? null : options.cursor,
  };
  return options.variant === 'data' ? { data: result } : { result };
}
