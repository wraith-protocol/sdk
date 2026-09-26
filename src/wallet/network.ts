import { WalletUnavailableError, WalletWrongNetworkError } from '../errors';
import type { WalletAdapter } from './adapter';
import { normalizeWalletError } from './errors';

/**
 * Formats an EVM chain ID (a number, a bigint, or a decimal or `0x` string as
 * EIP-1193 events deliver it) as the CAIP-2 id `eip155:<chainId>`.
 */
export function toEvmNetwork(chainId: unknown): string | undefined {
  if (typeof chainId === 'number') {
    return Number.isSafeInteger(chainId) && chainId >= 0 ? `eip155:${chainId}` : undefined;
  }
  if (typeof chainId === 'bigint') return chainId >= 0n ? `eip155:${chainId}` : undefined;
  if (typeof chainId === 'string' && /^(0x[0-9a-f]+|[0-9]+)$/i.test(chainId)) {
    return `eip155:${BigInt(chainId)}`;
  }
  return undefined;
}

/**
 * Checks that the wallet behind `adapter` is on `expectedNetwork`.
 *
 * Networks use the same format as `getNetwork()` and wallet events:
 * `eip155:<chainId>` for EVM and the network passphrase for Stellar.
 *
 * @throws {@link WalletWrongNetworkError} when the wallet reports another network.
 * @throws {@link WalletUnavailableError} when the adapter cannot report its network
 * (Solana wallet-adapter wallets do not expose one).
 * @throws The normalised wallet error when reading the network fails.
 */
export async function assertWalletNetwork(
  adapter: WalletAdapter,
  expectedNetwork: string,
): Promise<void> {
  const { chain } = adapter;
  if (typeof adapter.getNetwork !== 'function') {
    throw new WalletUnavailableError({
      chain,
      reason: `This ${chain} wallet adapter cannot report its network.`,
    });
  }
  let actualNetwork: string;
  try {
    actualNetwork = await adapter.getNetwork();
  } catch (error) {
    throw normalizeWalletError(error, chain);
  }
  if (actualNetwork !== expectedNetwork) {
    throw new WalletWrongNetworkError({ chain, expectedNetwork, actualNetwork });
  }
}
