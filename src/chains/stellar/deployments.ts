/**
 * Network endpoints and contract IDs for a Wraith Stellar deployment.
 *
 * Use this when building integrations that need to submit Stellar transactions,
 * query Soroban events, or call the announcer and names contracts directly.
 *
 * @see {@link getDeployment}
 */
export interface StellarChainDeployment {
  /** Human-readable network name, for example `testnet`. */
  network: string;
  /** Stellar network passphrase used when signing transactions. */
  networkPassphrase: string;
  /** Horizon API URL for account and classic transaction operations. */
  horizonUrl: string;
  /** Soroban RPC URL for contract calls and event queries. */
  sorobanUrl: string;
  /** Deployed Soroban contract IDs used by Wraith on this network. */
  contracts: {
    /** Contract that stores stealth payment announcements. */
    announcer: string;
    /** Contract that resolves Wraith names to stealth meta-addresses. */
    names: string;
  };
}

/**
 * Built-in Stellar deployments supported by the SDK.
 *
 * The `stellar` key currently points to the Wraith Stellar testnet deployment
 * used by examples and announcement scanning.
 *
 * @see {@link getDeployment}
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
 * Returns the configured Stellar deployment for a chain key.
 *
 * Use this before constructing Horizon/Soroban clients or locating Wraith
 * contract IDs for a network.
 *
 * @param chain - Deployment key, such as `stellar`.
 * @returns Stellar endpoints, passphrase, and contract IDs for the chain.
 * @throws {Error} If `chain` is not present in {@link DEPLOYMENTS}.
 *
 * @example
 * ```ts
 * import { getDeployment } from "@wraith-protocol/sdk/chains/stellar";
 *
 * const deployment = getDeployment("stellar");
 * console.log(deployment.sorobanUrl, deployment.contracts.announcer);
 * ```
 *
 * @see {@link fetchAnnouncements}
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
