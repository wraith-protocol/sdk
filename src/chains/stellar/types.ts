import type { StellarMemo } from './utils';

/** Hex-encoded value with a `0x` prefix. */
export type HexString = `0x${string}`;

/** Stellar network identifier. Used as a cache namespace to prevent testnet/mainnet collisions. */
export type Network = 'testnet' | 'mainnet';

/** Spending and viewing key pairs derived from a wallet signature. */
/**
 * Spending and viewing key material derived from a Stellar wallet signature.
 *
 * Keep the seed and scalar fields private. Public keys can be shared through a
 * stealth meta-address so senders can generate one-time receiving accounts.
 *
 * @see {@link deriveStealthKeys}
 */
export interface StealthKeys {
  /** 32-byte spending seed (ed25519). */
  spendingKey: Uint8Array;
  /** Clamped spending scalar derived via SHA-512 from the seed. */
  spendingScalar: bigint;
  /** 32-byte viewing seed (ed25519). */
  viewingKey: Uint8Array;
  /** Clamped viewing scalar derived via SHA-512 from the seed. */
  viewingScalar: bigint;
  /** 32-byte spending public key (ed25519). */
  spendingPubKey: Uint8Array;
  /** 32-byte viewing public key (ed25519). */
  viewingPubKey: Uint8Array;
}

/**
 * Parsed Stellar stealth meta-address components.
 *
 * The two public keys are safe to share and are enough for senders to generate
 * a stealth address, but not enough to scan or spend.
 *
 * @see {@link decodeStealthMetaAddress}
 */
export interface StealthMetaAddress {
  /** Stellar stealth meta-address prefix, currently `st:xlm:`. */
  prefix: string;
  /** 32-byte spending public key. */
  spendingPubKey: Uint8Array;
  /** 32-byte viewing public key. */
  viewingPubKey: Uint8Array;
}

/**
 * Result of generating a one-time Stellar stealth account for a recipient.
 *
 * The sender funds `stealthAddress` and publishes `ephemeralPubKey` plus the
 * view tag so the recipient can detect the payment while scanning.
 *
 * @see {@link generateStealthAddress}
 */
export interface GeneratedStealthAddress {
  /** The Stellar public key (G...) of the stealth address. */
  stealthAddress: string;
  /** 32-byte ephemeral public key (ed25519). */
  ephemeralPubKey: Uint8Array;
  /** The 1-byte view tag (0-255). */
  viewTag: number;
}

/**
 * Soroban event payload for a published Stellar stealth payment announcement.
 *
 * Announcements are public metadata. They reveal the generated stealth account
 * and sender/caller, but not which recipient can detect or spend the payment.
 *
 * @see {@link fetchAnnouncements}
 */
export interface Announcement {
  /** Scheme identifier (1 = v1 layout, 2 = v2 bucketed layout). */
  schemeId: number;
  /** The Stellar public key (G...) of the stealth address. */
  stealthAddress: string;
  /** The Stellar public key of the sender/caller. */
  caller: string;
  /** 32-byte ephemeral public key (hex-encoded). */
  ephemeralPubKey: string;
  /** Hex-encoded metadata; the first byte is the view tag. */
  metadata: string;
  /** Soroban ledger sequence number where this announcement was emitted. */
  ledger?: number;
  /** v2 RPC topic bucket (0–255); undefined for v1 announcements. */
  viewTagBucket?: number;
  /** Memo attached to the transaction that carried this announcement, if any. */
  memo?: StellarMemo;
}

/**
 * Announcement that matched the recipient's viewing key.
 *
 * Matched announcements include the derived private scalar needed to sign from
 * the stealth account. The viewing key alone can detect matches, but deriving
 * this result also requires the recipient's spending scalar.
 *
 * @see {@link scanAnnouncements}
 */
export interface MatchedAnnouncement extends Announcement {
  /** The stealth private scalar: (spending_scalar + hash_scalar) mod L. */
  stealthPrivateScalar: bigint;
  /** 32-byte stealth public key bytes used by the signing helpers. */
  stealthPubKeyBytes: Uint8Array;
}

/** Primitive Soroban types emitted in a contract spec. */
export type ContractPrimitiveTypeName =
  | 'val'
  | 'bool'
  | 'void'
  | 'error'
  | 'u32'
  | 'i32'
  | 'u64'
  | 'i64'
  | 'timepoint'
  | 'duration'
  | 'u128'
  | 'i128'
  | 'u256'
  | 'i256'
  | 'bytes'
  | 'string'
  | 'symbol'
  | 'address';

/** Normalized Soroban type reference returned by extractContractSpec(). */
export type ContractTypeRef =
  | { kind: 'primitive'; name: ContractPrimitiveTypeName }
  | { kind: 'option'; valueType: ContractTypeRef }
  | { kind: 'result'; okType: ContractTypeRef; errorType: ContractTypeRef }
  | { kind: 'vec'; elementType: ContractTypeRef }
  | { kind: 'map'; keyType: ContractTypeRef; valueType: ContractTypeRef }
  | { kind: 'tuple'; valueTypes: ContractTypeRef[] }
  | { kind: 'bytesN'; n: number }
  | { kind: 'udt'; name: string };

/** Named function argument in a normalized contract spec. */
export interface ContractArgumentSpec {
  /** Argument name as declared in the contract spec. */
  name: string;
  /** Optional Rust doc comment emitted into the spec. */
  doc?: string;
  /** Normalized Soroban argument type. */
  type: ContractTypeRef;
}

/** One function exposed by a deployed Soroban contract. */
export interface ContractFunctionSpec {
  /** Contract function name. */
  name: string;
  /** Optional Rust doc comment emitted into the spec. */
  doc?: string;
  /** Ordered function inputs. */
  inputs: ContractArgumentSpec[];
  /** Ordered function outputs. Usually empty or length 1. */
  outputs: ContractTypeRef[];
}

/** Field in a normalized Soroban struct type. */
export interface ContractStructFieldSpec {
  /** Field name. */
  name: string;
  /** Optional field documentation. */
  doc?: string;
  /** Field type. */
  type: ContractTypeRef;
}

/** Case in a numeric Soroban enum or error enum. */
export interface ContractEnumCaseSpec {
  /** Case name. */
  name: string;
  /** Optional case documentation. */
  doc?: string;
  /** Numeric discriminant value. */
  value: number;
}

/** Case in a Soroban union type. */
export type ContractUnionCaseSpec =
  | {
      kind: 'void';
      name: string;
      doc?: string;
    }
  | {
      kind: 'tuple';
      name: string;
      doc?: string;
      valueTypes: ContractTypeRef[];
    };

/** User-defined type emitted in the Soroban contract spec. */
export type ContractUserTypeSpec =
  | {
      kind: 'struct';
      name: string;
      doc?: string;
      library?: string;
      fields: ContractStructFieldSpec[];
    }
  | {
      kind: 'union';
      name: string;
      doc?: string;
      library?: string;
      cases: ContractUnionCaseSpec[];
    }
  | {
      kind: 'enum';
      name: string;
      doc?: string;
      library?: string;
      cases: ContractEnumCaseSpec[];
    }
  | {
      kind: 'errorEnum';
      name: string;
      doc?: string;
      library?: string;
      cases: ContractEnumCaseSpec[];
    };

/** Optional settings for TypeScript generation from a normalized contract spec. */
export interface GenerateContractTypesOptions {
  /** Override the generated contract interface name. */
  contractName?: string;
}

/** Options for dynamic Soroban contract spec extraction. */
export interface ExtractContractSpecOptions {
  /** Target Stellar network. Defaults to testnet. */
  network?: Network;
  /** Custom Soroban RPC URL. Overrides the default for the selected network. */
  rpcUrl?: string;
  /** Skip the module-level `(network, contractId, wasmHash)` cache. */
  bypassCache?: boolean;
  /** Also return generated TypeScript declarations. */
  generateTypes?: boolean | GenerateContractTypesOptions;
}

/** Normalized on-chain contract spec extracted from a deployed Soroban contract. */
export interface ExtractedContractSpec {
  /** Contract identifier used for extraction. */
  contractId: string;

  /** Stellar network used to resolve the RPC URL. */
  network: Network;

  /** Effective Soroban RPC URL used for extraction. */
  rpcUrl: string;

  /** Current deployed Wasm hash for cache versioning. */
  wasmHash: HexString;

  /** Normalized function signatures. */
  functions: ContractFunctionSpec[];

  /** Normalized user-defined types. */
  types: ContractUserTypeSpec[];

  /** Generated TypeScript declarations when requested. */
  typescript?: string;
}

/** Payment details for a single stealth payment recipient. */
export interface StealthPayment {
  /** Recipient's stealth meta-address (st:xlm:...) */
  metaAddress: string;
  /** Amount in XLM (string to preserve precision) */
  amount: string;
}

/** Parameters for building a batch send transaction. */
export interface BuildBatchSendTxParams {
  /** Array of stealth payments to include in the batch */
  payments: StealthPayment[];
  /** Stellar source account object with sequence number */
  sourceAccount: any;
  /** Optional memo for the transaction */
  memo?: string;
  /** Network passphrase (e.g., 'Test SDF Network ; September 2015') */
  networkPassphrase: string;
  /** Base fee per operation in stroops (default: 100) */
  baseFee?: number;
  /** Maximum operations allowed per transaction (default: 100) */
  maxOperations?: number;
  /** Threshold for using stealth-batch-sender contract (default: 10) */
  batchSenderThreshold?: number;
  /** Optional stealth-batch-sender contract address */
  batchSenderContract?: string;
}

/** Result of building a batch send transaction. */
export interface BuildBatchSendTxResult {
  /** The built Stellar transaction (TransactionBuilder output) */
  transaction: any;
  /** Generated stealth addresses for each payment */
  stealthAddresses: GeneratedStealthAddress[];
  /** Total fee in stroops */
  totalFee: number;
  /** Whether stealth-batch-sender contract was used */
  usedBatchSender: boolean;
}
