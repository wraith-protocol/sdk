import { getDeployment } from './deployments';
import type { HexString, StealthCell } from './types';

/**
 * Fetches stealth cells from CKB via the indexer `get_cells` RPC.
 *
 * Queries all live cells using the stealth-lock code hash. On CKB,
 * cells ARE the announcements — the lock script args contain the
 * ephemeral pubkey and stealth pubkey hash.
 */
export async function fetchStealthCells(chain: string = 'ckb'): Promise<StealthCell[]> {
  const deployment = getDeployment(chain);
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

    const data = await res.json();
    const objects = data.result?.objects ?? [];

    for (const obj of objects) {
      const args: string = obj.output.lock.args;
      // 0x + 53 bytes * 2 = 108 hex chars
      if (args.length !== 108) continue;

      cells.push({
        txHash: obj.out_point.tx_hash as HexString,
        index: parseInt(obj.out_point.index, 16),
        capacity: BigInt(obj.output.capacity),
        lockArgs: args as HexString,
        ephemeralPubKey: `0x${args.slice(2, 68)}` as HexString,
        stealthPubKeyHash: `0x${args.slice(68)}` as HexString,
      });
    }

    cursor = data.result?.last_cursor;
    if (!cursor || objects.length === 0) break;
  }

  return cells;
}
