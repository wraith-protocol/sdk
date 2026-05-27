/**
 * Configuration for a deployed instance of the Wraith stealth address contracts on a
 * Stellar network.
 */
export interface StellarChainDeployment {
  /** Human-readable network name (e.g. `"testnet"`, `"mainnet"`). */
  network: string;
  /** Stellar network passphrase used when building and signing transactions. */
  networkPassphrase: string;
  /** Base URL of the Horizon REST API for this network. */
  horizonUrl: string;
  /** Base URL of the Soroban RPC endpoint used for contract queries and event fetching. */
  sorobanUrl: string;
  /** Addresses of the deployed Wraith smart contracts on this network. */
  contracts: {
    /** Soroban contract ID of the stealth address announcer contract. */
    announcer: string;
    /** Soroban contract ID of the `.wraith` name registry contract. */
    names: string;
  };
}

/**
 * Registry of all known Wraith contract deployments on Stellar, keyed by chain
 * identifier string.
 *
 * Pass a key from this object to {@link getDeployment} or {@link fetchAnnouncements}
 * to target a specific network. Currently contains `"stellar"` (testnet).
 *
 * @example
 * ```ts
 * import { DEPLOYMENTS } from '@wraith-protocol/sdk/chains/stellar';
 *
 * console.log(DEPLOYMENTS['stellar'].contracts.announcer);
 * // => "CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL"
 * ```
 */
export const DEPLOYMENTS: Record<string, StellarChainDeployment> = {
  stellar: {
    network: 'testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanUrl: 'https://soroban-testnet.stellar.org',
    contracts: {
      announcer: 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL',
      names: 'CDEMB3MAE62ZOCCKZPTYSXR5CS5WVENPOU5MDVK4PNKTZXFVDC74AFBV',
    },
  },
};

/**
 * Looks up the deployment configuration for the given chain identifier.
 *
 * Prefer this over accessing {@link DEPLOYMENTS} directly when you need a guaranteed
 * non-null value — it throws a descriptive error if the chain is unknown, making
 * misconfiguration obvious at call time rather than silently returning `undefined`.
 *
 * @param chain - The chain identifier key (e.g. `"stellar"`).
 * @returns The {@link StellarChainDeployment} for the requested chain.
 * @throws {Error} If `chain` is not a key in {@link DEPLOYMENTS}, with a message listing
 *   available chains.
 *
 * @example
 * ```ts
 * import { getDeployment } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const { sorobanUrl, contracts } = getDeployment('stellar');
 * ```
 */
export function getDeployment(chain: string): StellarChainDeployment {
  const deployment = DEPLOYMENTS[chain];
  if (!deployment) {
    throw new Error(
      `No Stellar deployment for "${chain}". Available: ${Object.keys(DEPLOYMENTS).join(', ')}`,
    );
  }
  return deployment;
}