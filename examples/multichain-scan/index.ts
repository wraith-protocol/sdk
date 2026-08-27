#!/usr/bin/env node
import {
  deriveStealthKeysFromWallet,
  type EvmWalletAdapter,
  type StellarWalletAdapter,
  type WalletAdapter,
} from '@wraith-protocol/sdk';
import { fetchAnnouncementsStream as stellarFetch } from '@wraith-protocol/sdk/chains/stellar';
import { scanAnnouncements as stellarScan } from '@wraith-protocol/sdk/chains/stellar';
import { bytesToHex as stellarHex } from '@wraith-protocol/sdk/chains/stellar';
import type { StealthKeys as StellarStealthKeys } from '@wraith-protocol/sdk/chains/stellar';

import { fetchAnnouncements as evmFetch } from '@wraith-protocol/sdk/chains/evm';
import { scanAnnouncements as evmScan } from '@wraith-protocol/sdk/chains/evm';
import type { StealthKeys as EvmStealthKeys } from '@wraith-protocol/sdk/chains/evm';

import { deriveStealthKeys as solanaDerive } from '@wraith-protocol/sdk/chains/solana';
import { fetchAnnouncements as solanaFetch } from '@wraith-protocol/sdk/chains/solana';
import { scanAnnouncements as solanaScan } from '@wraith-protocol/sdk/chains/solana';

import { deriveStealthKeys as ckbDerive } from '@wraith-protocol/sdk/chains/ckb';
import { fetchStealthCells } from '@wraith-protocol/sdk/chains/ckb';
import { scanStealthCells } from '@wraith-protocol/sdk/chains/ckb';

interface ScanResult {
  chain: string;
  total: number;
  matches: number;
  error?: string;
  details: string[];
}

function getEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
}

async function scanStellar(keys: StellarStealthKeys): Promise<ScanResult> {
  const announcements = [];
  for await (const ann of stellarFetch('stellar')) {
    announcements.push(ann);
  }
  const matches = await stellarScan(
    announcements,
    keys.viewingKey,
    keys.spendingPubKey,
    keys.spendingScalar,
  );
  return {
    chain: 'Stellar',
    total: announcements.length,
    matches: matches.length,
    details: matches.map(
      (m) =>
        `  Address: ${m.stealthAddress}\n  Ephemeral: ${stellarHex(m.ephemeralPubKey as unknown as Uint8Array)}\n  Scalar: ${m.stealthPrivateScalar}`,
    ),
  };
}

async function scanEvm(keys: EvmStealthKeys): Promise<ScanResult> {
  const announcements = await evmFetch('horizen');
  const matches = evmScan(announcements, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);
  return {
    chain: 'EVM',
    total: announcements.length,
    matches: matches.length,
    details: matches.map(
      (m) => `  Address: ${m.stealthAddress}\n  Private key: ${m.stealthPrivateKey}`,
    ),
  };
}

async function scanSolana(sigHex: string): Promise<ScanResult> {
  const sig = hexToBytes(sigHex);
  const keys = solanaDerive(sig);
  const announcements = await solanaFetch('solana');
  const matches = solanaScan(
    announcements,
    keys.viewingKey,
    keys.spendingPubKey,
    keys.spendingScalar,
  );
  return {
    chain: 'Solana',
    total: announcements.length,
    matches: matches.length,
    details: matches.map(
      (m) => `  Address: ${m.stealthAddress}\n  Scalar: ${m.stealthPrivateScalar}`,
    ),
  };
}

async function scanCkb(sigHex: string): Promise<ScanResult> {
  const sig = `0x${sigHex}` as `0x${string}`;
  const keys = ckbDerive(sig);
  const cells = await fetchStealthCells('ckb');
  const matches = scanStealthCells(cells, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);
  return {
    chain: 'CKB',
    total: cells.length,
    matches: matches.length,
    details: matches.map(
      (m) =>
        `  Lock args: ${m.lockArgs}\n  Capacity: ${m.capacity}\n  Private key: ${m.stealthPrivateKey}`,
    ),
  };
}

async function main() {
  console.log('=== Wraith Multichain Scanner ===\n');

  const registryModule = getEnv('WALLET_REGISTRY_MODULE');
  const secretKey = getEnv('SECRET_KEY');
  if (!registryModule) {
    console.error('ERROR: Missing WALLET_REGISTRY_MODULE');
    console.error('Export a WalletAdapter registry as shown in the README.');
    process.exit(1);
  }

  const registry = await loadWalletRegistry(registryModule);
  const stellarAdapter = requireAdapter(registry, 'stellar');
  const evmAdapter = requireAdapter(registry, 'evm');
  const [stellarKeys, evmKeys, stellarAddress, evmAddress] = await Promise.all([
    deriveStealthKeysFromWallet(stellarAdapter),
    deriveStealthKeysFromWallet(evmAdapter),
    stellarAdapter.getAddress(),
    evmAdapter.getAddress(),
  ]);
  console.log(`Signed with Stellar ${stellarAddress} and EVM ${evmAddress}.\n`);

  const scanners = [scanStellar(stellarKeys), scanEvm(evmKeys)];
  if (secretKey) scanners.push(scanSolana(secretKey), scanCkb(secretKey));

  const results = await Promise.allSettled(scanners);
  let totalMatches = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const r = result.value;
      console.log(`--- ${r.chain} ---`);
      console.log(`  Total announcements: ${r.total}`);
      console.log(`  Matches: ${r.matches}`);
      for (const detail of r.details) {
        console.log(detail);
      }
      totalMatches += r.matches;
    } else {
      console.error(`  Error: ${result.reason}`);
    }
    console.log('');
  }

  console.log(`=== Done — ${totalMatches} total match(es) across all chains ===`);
}

async function loadWalletRegistry(modulePath: string): Promise<Map<string, WalletAdapter>> {
  const loaded = (await import(modulePath)) as {
    walletAdapters?: Map<string, WalletAdapter>;
    default?: Map<string, WalletAdapter>;
  };
  const registry = loaded.walletAdapters ?? loaded.default;
  if (!(registry instanceof Map)) {
    throw new TypeError('The wallet registry module must export a Map as `walletAdapters`.');
  }
  return registry;
}

function requireAdapter(
  registry: Map<string, WalletAdapter>,
  chain: 'stellar',
): StellarWalletAdapter;
function requireAdapter(registry: Map<string, WalletAdapter>, chain: 'evm'): EvmWalletAdapter;
function requireAdapter(
  registry: Map<string, WalletAdapter>,
  chain: 'stellar' | 'evm',
): StellarWalletAdapter | EvmWalletAdapter {
  const adapter = registry.get(chain);
  if (!adapter || adapter.chain !== chain) {
    throw new Error(`Wallet registry is missing a ${chain} adapter.`);
  }
  return adapter as StellarWalletAdapter | EvmWalletAdapter;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
