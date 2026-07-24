export { Wraith, WraithAgent } from './agent/client';
export { Chain } from './agent/types';
/**
 * @internal
 */
export { installReactNativePolyfills } from './compat';
export { scanAll } from './scanner/unified';
export type {
  WraithConfig,
  AgentConfig,
  AgentInfo,
  ChatResponse,
  ToolCall,
  Balance,
  Payment,
  Invoice,
  Schedule,
  TxResult,
  PrivacyReport,
  Notification,
  Conversation,
} from './agent/types';
export type {
  ScanAllInput,
  MatchedAnnouncement,
  SupportedChain,
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
