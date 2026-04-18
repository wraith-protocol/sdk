export interface CKBChainDeployment {
  network: string;
  rpcUrl: string;
  explorerUrl: string;
  contracts: {
    stealthLockCodeHash: string;
    namesTypeCodeHash: string;
  };
  cellDeps: {
    stealthLock: { txHash: string; index: number };
    ckbAuth: { txHash: string; index: number };
    namesType: { txHash: string; index: number };
  };
}

export const DEPLOYMENTS: Record<string, CKBChainDeployment> = {
  ckb: {
    network: 'testnet',
    rpcUrl: 'https://testnet.ckbapp.dev',
    explorerUrl: 'https://pudge.explorer.nervos.org',
    contracts: {
      stealthLockCodeHash: '0x31f6ab9c7e7a26ecba980b838ac3b5bd6c3a2f1b945e75b7cf7e6a46cb19cb87',
      namesTypeCodeHash: '0xc133817d433f72ea16a2404adaf961524e9572c8378829a21968710d6182e20d',
    },
    cellDeps: {
      stealthLock: {
        txHash: '0xde1e8e4bed2d1d7102b9ad3d7a74925ace007800ae49498f9c374cb4968dd32b',
        index: 0,
      },
      ckbAuth: {
        txHash: '0xa0e99b29fd154385815142b76668d5f4ecf30ae85bc2942bd21e9e51b9066f97',
        index: 0,
      },
      namesType: {
        txHash: '0x9acd640d35eadd893b358dddd415f4061fe81cb249e8ace51a866fee314141b8',
        index: 0,
      },
    },
  },
};

export function getDeployment(chain: string = 'ckb'): CKBChainDeployment {
  const deployment = DEPLOYMENTS[chain];
  if (!deployment) {
    throw new Error(`No CKB deployment found for chain: ${chain}`);
  }
  return deployment;
}
