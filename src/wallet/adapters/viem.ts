import type { HexString } from '../../chains/evm/types';
import type { EvmWalletAdapter } from '../adapter';

/** Structural subset of a viem WalletClient; viem is not imported at runtime. */
export interface ViemWalletClient {
  account?: { address: string } | null;
  getAddresses?: () => Promise<readonly string[]>;
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
}

/** Creates a unified adapter from a viem WalletClient-shaped object. */
export function createViemWalletAdapter(client: ViemWalletClient): ViemWalletAdapter {
  return new ViemWalletAdapter(client);
}
