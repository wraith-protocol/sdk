import type { HexString } from '../../chains/evm/types';
import { WalletRequestFailedError, WalletUnavailableError } from '../../errors';
import type { EvmWalletAdapter } from '../adapter';
import { normalizeWalletError } from '../errors';
import { toEvmNetwork } from '../network';

/** Structural subset of a viem WalletClient; viem is not imported at runtime. */
export interface ViemWalletClient {
  account?: { address: string } | null;
  getAddresses?: () => Promise<readonly string[]>;
  /** Used by `getNetwork()`; every viem WalletClient provides it. */
  getChainId?: () => Promise<number>;
  signMessage(args: {
    account?: { address: string } | string;
    message: { raw: Uint8Array };
  }): Promise<HexString>;
}

/** viem WalletClient reference adapter. */
export class ViemWalletAdapter implements EvmWalletAdapter {
  readonly chain = 'evm' as const;

  constructor(private readonly client: ViemWalletClient) {
    if (!client || typeof client.signMessage !== 'function') {
      throw new TypeError('A viem-compatible WalletClient with signMessage is required.');
    }
  }

  async signMessage(message: Uint8Array): Promise<HexString> {
    const account = this.client.account ?? (await this.getAddress());
    return this.client.signMessage({ account, message: { raw: message } });
  }

  async getAddress(): Promise<string> {
    if (this.client.account?.address) return this.client.account.address;
    const addresses = await this.client.getAddresses?.();
    if (!addresses?.[0]) throw new Error('The viem wallet client has no connected account.');
    return addresses[0];
  }

  /**
   * Returns the wallet's active chain as a CAIP-2 id, e.g. `eip155:1`.
   *
   * Unlike `signMessage` and `getAddress`, this method rejects with normalised
   * `WraithWalletError`s.
   */
  async getNetwork(): Promise<string> {
    if (typeof this.client.getChainId !== 'function') {
      throw new WalletUnavailableError({
        chain: 'evm',
        reason: 'The viem wallet client does not provide getChainId().',
      });
    }
    let chainId: number;
    try {
      chainId = await this.client.getChainId();
    } catch (error) {
      throw normalizeWalletError(error, 'evm');
    }
    const network = toEvmNetwork(chainId);
    if (!network) {
      throw new WalletRequestFailedError({
        chain: 'evm',
        reason: `The wallet reported an invalid chain ID: ${String(chainId)}`,
      });
    }
    return network;
  }
}

/** Creates a unified adapter from a viem WalletClient-shaped object. */
export function createViemWalletAdapter(client: ViemWalletClient): ViemWalletAdapter {
  return new ViemWalletAdapter(client);
}
