/**
 * @internal
 */
export { installReactNativePolyfills } from './compat';
export { scanAll, UNKNOWN_TIMESTAMP } from './scanner/unified';
export { MultichainScannerPool } from './scanner-pool';
export { DEFAULT_CHAIN_REQUEST_BUDGET, resolveChainRequestBudget } from './scanner/boundedStream';
export type {
  BoundedStreamStats,
  ChainRequestBudget,
  ResolvedChainRequestBudget,
} from './scanner/boundedStream';
export type {
  CkbScanInput,
  EvmScanInput,
  MultichainScannerPoolOptions,
  ProgressEvent,
  ScanInput,
  ScanResults,
  SolanaScanInput,
  StellarScanInput,
} from './scanner-pool';
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
  ScanCancellationOptions,
  ChainScannerAdapter,
  CustomChainInput,
  EvmChainInput,
  StellarChainInput,
  SolanaChainInput,
  CkbChainInput,
} from './scanner/unified';
export { createWorkerScanner, ScannerWorkerError } from './scanner/worker-client';
export type {
  WorkerScanner,
  WorkerScannerOptions,
  WorkerScanOptions,
  ScannerWorkerEndpoint,
} from './scanner/worker-client';
export type {
  ScannerWorkerChain,
  ScannerWorkerCkbInput,
  ScannerWorkerEnvelope,
  ScannerWorkerEvmInput,
  ScannerWorkerFailure,
  ScannerWorkerFailureCode,
  ScannerWorkerInput,
  ScannerWorkerProgress,
  ScannerWorkerRequest,
  ScannerWorkerResponse,
  ScannerWorkerSolanaInput,
  ScannerWorkerStellarInput,
} from './scanner/worker-protocol';
export { getUnknownErrorMessage, isAbortError } from './chains/errorUtils';
export {
  DOMAIN_AUTH_MAGIC,
  normalizeDomainContract,
  validateSignatureDomain,
  encodeLengthPrefixedFields,
  encodeDomainAuthorizationBytes,
  buildDomainStealthSigningMessage,
  checkDomainGuards,
} from './auth/domain';
export type {
  AuthorizationChain,
  AuthorizationOperation,
  SignatureDomain,
  ReplayRejectionReason,
  VerifyDomainOptions,
  SignatureVerificationResult,
} from './auth/domain';
export {
  WraithError,
  WraithRuntimeError,
  WraithInputError,
  WraithCryptoError,
  WraithNetworkError,
  WraithContractError,
  WraithBuilderError,
  UnsupportedCapabilityError,
  InvalidMetaAddressError,
  InvalidNameError,
  InvalidSignatureError,
  InvalidScalarError,
  KeyDerivationFailedError,
  ViewTagMismatchError,
  ECDHFailedError,
  RPCRequestError,
  HorizonResponseError,
  AgentResponseError,
  RPCRetryExhaustedError,
  RPCTimeoutError,
  RPCAbortedError,
  RetentionExceededError,
  ScanBudgetExceededError,
  AnnouncementCursorError,
  AnnouncementProviderError,
  AnnouncementResponseError,
  AnnouncementBudgetExceededError,
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
  UnsupportedCapabilityDetails,
  WalletErrorDetails,
  WalletWrongNetworkDetails,
  RPCTimeoutDetails,
  RPCTimeoutPhase,
  AnnouncementCursorFailure,
  AnnouncementCursorErrorDetails,
  AnnouncementProviderErrorDetails,
  AnnouncementResponseErrorDetails,
  AnnouncementBudgetExceededDetails,
} from './errors';
