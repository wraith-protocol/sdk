import type {
  ChainDifferenceSummary,
  CkbTransactionBuilderVector,
  EvmAnnounceVector,
  EvmSendErc20Vector,
  EvmSendEthVector,
  EvmTransactionBuilderVector,
  SolanaInstructionAccountMeta,
  SolanaTransactionBuilderVector,
  StellarTransactionBuilderVector,
  TransactionBuilderVectorFixture,
} from './transaction-builders.js';

export type {
  ChainDifferenceSummary,
  CkbTransactionBuilderVector,
  EvmAnnounceVector,
  EvmSendErc20Vector,
  EvmSendEthVector,
  EvmTransactionBuilderVector,
  SolanaInstructionAccountMeta,
  SolanaTransactionBuilderVector,
  StellarTransactionBuilderVector,
  TransactionBuilderVectorFixture,
};

export interface ChecksumManifest {
  algorithm: 'sha256';
  files: Record<string, string>;
}

export declare const STELLAR_VECTOR_SCHEMA_VERSION: string;
export declare const TRANSACTION_BUILDER_SCHEMA_VERSION: string;
export declare const stellarVectors: Record<string, unknown>;
export declare const transactionBuilderVectors: TransactionBuilderVectorFixture;
export declare const checksums: ChecksumManifest;
