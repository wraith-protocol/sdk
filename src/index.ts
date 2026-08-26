/**
 * @deprecated Import from '@wraith-protocol/sdk-agent' instead. Agent functionality has been moved to a separate package.
 */
export { Wraith, WraithAgent } from './agent/client';
/**
 * @deprecated Import from '@wraith-protocol/sdk-agent' instead. Agent functionality has been moved to a separate package.
 */
export { Chain } from './agent/types';
/**
 * @internal
 */
export { installReactNativePolyfills } from './compat';
export { scanAll } from './scanner/unified';
export {
  deriveStealthKeysFromWallet,
  FreighterWalletAdapter,
  createFreighterWalletAdapter,
  ViemWalletAdapter,
  createViemWalletAdapter,
  SolanaWalletAdapter,
  createSolanaWalletAdapter,
} from './wallet';
export type {
  WalletAdapterChain,
  BaseWalletAdapter,
  StellarWalletAdapter,
  EvmWalletAdapter,
  SolanaChainWalletAdapter,
  WalletAdapter,
  FreighterWalletApi,
  ViemWalletClient,
  SolanaWalletAdapterLike,
} from './wallet';
export { setTracer, getTracer, withSpan, NOOP_TRACER } from './telemetry';
export type { Tracer, Span } from './telemetry';
export type {
  ScanAllInput,
  MatchedAnnouncement,
  SupportedChain,
  ChainScannerAdapter,
  CustomChainInput,
  EvmChainInput,
  StellarChainInput,
  SolanaChainInput,
  CkbChainInput,
} from './scanner/unified';

export {
  WraithError,
  WraithInputError,
  WraithCryptoError,
  WraithNetworkError,
  WraithContractError,
  WraithBuilderError,
  InvalidMetaAddressError,
  InvalidNameError,
  InvalidSignatureError,
  InvalidScalarError,
  KeyDerivationFailedError,
  ViewTagMismatchError,
  ECDHFailedError,
  RPCRequestError,
  RPCRetryExhaustedError,
  RetentionExceededError,
  NameNotFoundError,
  NameAlreadyRegisteredError,
  InsufficientAuthError,
  ContractRevertError,
  InsufficientBalanceError,
  UnsupportedAssetError,
} from './errors';
