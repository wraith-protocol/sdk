export interface SolanaChainDeployment {
  cluster: string;
  rpcUrl: string;
  explorerUrl: string;
  contracts: {
    announcer: string;
    sender: string;
    names: string;
  };
}

export const DEPLOYMENTS: Record<string, SolanaChainDeployment> = {
  solana: {
    cluster: 'devnet',
    rpcUrl: 'https://api.devnet.solana.com',
    explorerUrl: 'https://explorer.solana.com',
    contracts: {
      announcer: '9Ko7TuXHpLUH1ZsZWQEpeA9Tv7hX325ooWk5SD7Y9nuq',
      sender: 'E6J7GBSTjKbYANWjfTo5HfnXZ4Tg3LAasN7NrvCwn5Dq',
      names: '4JrrQh5aK7iLvx6MgtEQk7K7X3SsWfTLxVJu1jXEwNjD',
    },
  },
};

export function getDeployment(chain: string): SolanaChainDeployment {
  const deployment = DEPLOYMENTS[chain];
  if (!deployment) {
    throw new Error(
      `No Solana deployment for "${chain}". Available: ${Object.keys(DEPLOYMENTS).join(', ')}`,
    );
  }
  return deployment;
}
