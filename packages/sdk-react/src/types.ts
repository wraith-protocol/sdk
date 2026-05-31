import type { HexString, StealthKeys, MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';

export interface UseStellarStealthKeysResult {
  keys: StealthKeys | null;
  isReady: boolean;
  error: Error | null;
}

export interface ScanOptions {
  intervalMs?: number;
  enabled?: boolean;
}

export interface UseStellarAnnouncementScanResult {
  matches: MatchedAnnouncement[];
  isScanning: boolean;
  lastScanAt: Date | null;
  error: Error | null;
  refetch: () => Promise<void>;
  cursor: string | null;
}

export interface SendStealthPaymentArgs {
  recipientMetaAddress: string;
  amount: string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
}

export interface UseStellarSendStealthPaymentResult {
  send: (args: SendStealthPaymentArgs) => Promise<void>;
  status: 'idle' | 'preparing' | 'signing' | 'submitting' | 'success' | 'error';
  txHash: string | null;
  stealthAddress: string | null;
  error: Error | null;
  reset: () => void;
}

export interface UseStellarNameResult {
  metaAddress: string | null;
  isResolving: boolean;
  error: Error | null;
}

export interface Asset {
  code: string;
  issuer: string;
  balance: string;
}

export interface BalanceOptions {
  intervalMs?: number;
  enabled?: boolean;
}

export interface UseStellarBalanceResult {
  xlm: string | null;
  assets: Asset[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}
