import type { HexString } from './types';

export interface EVMChainDeployment {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  subgraphUrl: string;
  contracts: {
    announcer: HexString;
    registry: HexString;
    sender: HexString;
    names: HexString;
  };
}

export const DEPLOYMENTS: Record<string, EVMChainDeployment> = {
  horizen: {
    chainId: 2651420,
    name: 'Horizen Testnet',
    rpcUrl: 'https://horizen-testnet.rpc.caldera.xyz/http',
    explorerUrl: 'https://horizen-testnet.explorer.caldera.xyz',
    subgraphUrl:
      'https://api.goldsky.com/api/public/project_cmhp1xyw0qu8901xcdayke69d/subgraphs/wraith-protocol-horizen-testnet/1.0.0/gn',
    contracts: {
      announcer: '0x8AE65c05E7eb48B9bA652781Bc0a3DBA09A484F3',
      registry: '0x953E6cEdcdfAe321796e7637d33653F6Ce05c527',
      sender: '0x226C5eb4e139D9fa01cc09eA318638b090b12095',
      names: '0x3d46f709a99A3910f52bD292211Eb5D557F882D6',
    },
  },
};

export function getDeployment(chain: string): EVMChainDeployment {
  const deployment = DEPLOYMENTS[chain];
  if (!deployment) {
    throw new Error(
      `No EVM deployment for "${chain}". Available: ${Object.keys(DEPLOYMENTS).join(', ')}`,
    );
  }
  return deployment;
}
