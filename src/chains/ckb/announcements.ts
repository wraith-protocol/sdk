import { getDeployment } from './deployments';
import type { StealthCell } from './types';
import { parseStealthCellPage } from './validation';
import { readBoundedJson, type RPCResponseContext } from '../rpcValidation';

/**
 * Fetches stealth cells from CKB via the indexer `get_cells` RPC.
 *
 * Queries all live cells using the stealth-lock code hash. On CKB,
 * cells ARE the announcements — the lock script args contain the
 * ephemeral pubkey and stealth pubkey hash.
 *
 * Each page is size-bounded and its cells are validated before use.
 *
 * @throws {RPCRequestError} If the indexer returns a non-2xx status.
 * @throws {RPCResponseError} If a page is oversized, malformed, or contains an
 *   invalid cell.
 */
export async function fetchStealthCells(chain: string = 'ckb'): Promise<StealthCell[]> {
  const deployment = getDeployment(chain);
  const context: RPCResponseContext = { chain, operation: 'fetchStealthCells' };
  const cells: StealthCell[] = [];
  let cursor: string | undefined;

  while (true) {
    const res = await fetch(deployment.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 0,
        jsonrpc: '2.0',
        method: 'get_cells',
        params: [
          {
            script: {
              code_hash: deployment.contracts.stealthLockCodeHash,
              hash_type: 'data2',
              args: '0x',
            },
            script_type: 'lock',
          },
          'asc',
          '0x64',
          cursor ?? null,
        ],
      }),
    });

    const payload = await readBoundedJson(res, context, deployment.rpcUrl);
    const page = parseStealthCellPage(payload, context);
    cells.push(...page.cells);

    if (!page.cursor || page.rawCount === 0) break;
    // An indexer that repeats the cursor would otherwise be polled forever.
    if (page.cursor === cursor) break;
    cursor = page.cursor;
  }

  return cells;
}
