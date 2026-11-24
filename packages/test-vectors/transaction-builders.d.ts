export interface ChainDifferenceSummary {
  envelopeModel: string;
  schemeId: string;
  sendVsAnnounce: string;
}

export interface EvmSendEthVector {
  id: string;
  operation: 'send';
  builder: 'buildSendStealth';
  input: {
    chain: string;
    recipientMetaAddress: string;
    amount: string;
    ephemeralPrivateKey: `0x${string}`;
  };
  output: {
    to: `0x${string}`;
    data: `0x${string}`;
    selector: string;
    valueWei: string;
    stealthAddress: `0x${string}`;
    ephemeralPubKey: `0x${string}`;
    viewTag: number;
  };
}

export interface EvmSendErc20Vector {
  id: string;
  operation: 'send_erc20';
  builder: 'buildSendERC20';
  input: {
    chain: string;
    recipientMetaAddress: string;
    token: `0x${string}`;
    amount: string;
    gasTip?: string;
    ephemeralPrivateKey: `0x${string}`;
  };
  output: {
    to: `0x${string}`;
    data: `0x${string}`;
    selector: string;
    valueWei: string;
    stealthAddress: `0x${string}`;
    ephemeralPubKey: `0x${string}`;
    viewTag: number;
  };
}

export interface EvmAnnounceVector {
  id: string;
  operation: 'announce';
  builder: 'buildAnnounce';
  input: {
    chain: string;
    stealthAddress: `0x${string}`;
    ephemeralPubKey: `0x${string}`;
    viewTag: number;
  };
  output: {
    to: `0x${string}`;
    data: `0x${string}`;
    selector: string;
    valueWei: string;
  };
}

export type EvmTransactionBuilderVector = EvmSendEthVector | EvmSendErc20Vector | EvmAnnounceVector;

export interface StellarTransactionBuilderVector {
  id: string;
  operation: 'send_create_account' | 'send_payment' | 'send_issued_asset' | 'announce';
  builder: 'buildStealthPayment' | 'buildStealthAnnouncement';
  input: {
    sender: string;
    sequence: string;
    recipientMetaAddress?: string;
    ephemeralSeed?: string;
    stealthAddress: string;
    ephemeralPubKey: string;
    viewTag: number;
    amount?: string;
    asset?: 'native' | { code: string; issuer: string };
    announcerContract?: string;
    networkPassphrase: string;
    fee: string;
    stealthExists?: boolean;
    timeoutSeconds?: number;
    timeBounds: { minTime: number | string; maxTime: number | string } | null;
  };
  output: {
    envelopeXdrBase64: string;
    txHashHex: string;
    source: string;
    sequence: string;
    fee: string;
    timeBounds: { minTime: string; maxTime: string } | null;
    operationCount: number;
    operationType: string;
    schemeId?: number;
  };
}

export interface SolanaInstructionAccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface SolanaTransactionBuilderVector {
  id: string;
  operation: 'send' | 'announce';
  builder: 'buildSendSol' | 'buildAnnounce';
  input: {
    chain: string;
    recipientMetaAddress?: string;
    amount?: string;
    senderPubkey?: string;
    ephemeralSeed?: string;
    stealthAddress?: string;
    ephemeralPubKey?: string;
    viewTag?: number;
    callerPubkey?: string;
  };
  output: {
    programId: string;
    keys: SolanaInstructionAccountMeta[];
    dataHex: `0x${string}`;
    discriminatorHex: `0x${string}`;
    dataByteLength: number;
    stealthAddress?: string;
    ephemeralPubKey?: string;
    viewTag?: number;
  };
}

export interface CkbTransactionBuilderVector {
  id: string;
  operation: 'send_and_announce';
  builder: 'buildSendCkb';
  input: {
    chain: string;
    recipientMetaAddress: string;
    capacity: string;
    ephemeralPrivateKey: `0x${string}`;
  };
  output: {
    transaction: {
      version: `0x${string}`;
      cellDeps: Array<{
        outPoint: { txHash: `0x${string}`; index: `0x${string}` };
        depType: 'code' | 'depGroup';
      }>;
      headerDeps: `0x${string}`[];
      outputs: Array<{
        capacity: `0x${string}`;
        lock: {
          codeHash: `0x${string}`;
          hashType: 'data' | 'type' | 'data1' | 'data2';
          args: `0x${string}`;
        };
        type?: unknown;
      }>;
      outputsData: `0x${string}`[];
    };
    stealthPubKey: `0x${string}`;
    stealthPubKeyHash: `0x${string}`;
    ephemeralPubKey: `0x${string}`;
    lockArgs: `0x${string}`;
    lockArgsByteLength: number;
  };
}

export interface TransactionBuilderVectorFixture {
  schemaVersion: string;
  seed: string;
  timestampPolicy: string;
  chainDifferences: {
    evm: ChainDifferenceSummary;
    stellar: ChainDifferenceSummary;
    solana: ChainDifferenceSummary;
    ckb: ChainDifferenceSummary;
  };
  vectors: {
    evm: EvmTransactionBuilderVector[];
    stellar: StellarTransactionBuilderVector[];
    solana: SolanaTransactionBuilderVector[];
    ckb: CkbTransactionBuilderVector[];
  };
}

export declare const TRANSACTION_BUILDER_SCHEMA_VERSION: string;
export declare const transactionBuilderVectors: TransactionBuilderVectorFixture;
export default transactionBuilderVectors;
