export { Wraith, WraithAgent } from './agent/client';
export { Chain } from './agent/types';
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

export { MultichainScannerPool } from './scanner-pool';
export type {
  SupportedChain,
  ScanInput,
  EvmScanInput,
  StellarScanInput,
  SolanaScanInput,
  CkbScanInput,
  ScanResults,
  ProgressEvent,
  MultichainScannerPoolOptions,
} from './scanner-pool';
