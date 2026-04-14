export interface StellarChainDeployment {
  network: string;
  networkPassphrase: string;
  horizonUrl: string;
  sorobanUrl: string;
  contracts: {
    announcer: string;
    names: string;
  };
}

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

export function getDeployment(chain: string): StellarChainDeployment {
  const deployment = DEPLOYMENTS[chain];
  if (!deployment) {
    throw new Error(
      `No Stellar deployment for "${chain}". Available: ${Object.keys(DEPLOYMENTS).join(', ')}`,
    );
  }
  return deployment;
}
