/**
 * @internal
 */
export { installReactNativePolyfills } from './compat';
export { scanAll, UNKNOWN_TIMESTAMP } from './scanner/unified';
export {
  deriveStealthKeysFromWallet,
  FreighterWalletAdapter,
  createFreighterWalletAdapter,
  ViemWalletAdapter,
  createViemWalletAdapter,
  SolanaWalletAdapter,
  createSolanaWalletAdapter,
  normalizeWalletError,
  withNormalizedWalletErrors,
  assertWalletNetwork,
  watchWalletEvents,
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
  WalletEvent,
  WalletEventListener,
  WalletEventSource,
  Eip1193EventProvider,
  SolanaWalletEventEmitter,
  FreighterWalletWatcher,
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
  RPCTimeoutError,
  RetentionExceededError,
  NameNotFoundError,
  NameAlreadyRegisteredError,
  InsufficientAuthError,
  ContractRevertError,
  InsufficientBalanceError,
  UnsupportedAssetError,
  WraithWalletError,
  WalletNotConnectedError,
  WalletUserRejectedError,
  WalletWrongNetworkError,
  WalletUnavailableError,
  WalletRequestFailedError,
} from './errors';
export type {
  WalletErrorDetails,
  WalletWrongNetworkDetails,
  RPCTimeoutDetails,
  RPCTimeoutPhase,
} from './errors';
