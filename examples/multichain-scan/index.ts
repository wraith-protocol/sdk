#!/usr/bin/env node
import { deriveStealthKeys as stellarDerive } from '@wraith-protocol/sdk/chains/stellar';
import { fetchAnnouncementsStream as stellarFetch } from '@wraith-protocol/sdk/chains/stellar';
import { scanAnnouncements as stellarScan } from '@wraith-protocol/sdk/chains/stellar';
import { bytesToHex as stellarHex } from '@wraith-protocol/sdk/chains/stellar';

import { deriveStealthKeys as evmDerive } from '@wraith-protocol/sdk/chains/evm';
import { fetchAnnouncements as evmFetch } from '@wraith-protocol/sdk/chains/evm';
import { scanAnnouncements as evmScan } from '@wraith-protocol/sdk/chains/evm';

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

async function scanStellar(sigHex: string): Promise<ScanResult> {
  const sig = hexToBytes(sigHex);
  const keys = stellarDerive(sig);
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

async function scanEvm(sigHex: string): Promise<ScanResult> {
  const sig = `0x${sigHex}` as `0x${string}`;
  const keys = evmDerive(sig);
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

  const secretKey = getEnv('SECRET_KEY');
  if (!secretKey) {
    console.error('ERROR: Missing SECRET_KEY');
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
  console.log(`Scanning all chains with key: ${secretKey.slice(0, 16)}...\n`);

  const scanners = [
    scanStellar(secretKey),
    scanEvm(secretKey),
    scanSolana(secretKey),
    scanCkb(secretKey),
  ];

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

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
