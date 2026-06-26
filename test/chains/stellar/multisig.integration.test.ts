/**
 * Integration test: build a multisig stealth withdrawal against a real
 * futurenet multisig account.
 *
 * Required:
 *   INTEGRATION=1
 *   FUTURENET_HORIZON_URL=<current futurenet Horizon URL>
 *   FUTURENET_NETWORK_PASSPHRASE=<current futurenet network passphrase>
 *   FUTURENET_STEALTH_ACCOUNT=<G... multisig account to withdraw from>
 *   FUTURENET_DESTINATION=<G... account receiving accountMerge funds>
 *   FUTURENET_SIGNER_SECRETS=<S...,S...,S...>  # enough signer weight
 *
 * Optional:
 *   FUTURENET_REQUIRED_WEIGHT=3
 *   FUTURENET_SUBMIT=1  # destructive: submits accountMerge
 */

import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  addStealthMultisigSigner,
  buildMultisigStealthWithdraw,
  isStealthMultisigReady,
} from '../../../src/chains/stellar/multisig';

const SKIP = process.env['INTEGRATION'] !== '1';

describe('Integration: Stellar multisig stealth withdraw (futurenet)', { skip: SKIP }, () => {
  it('validates account config and reaches threshold with real signers', async () => {
    const horizonUrl = requireEnv('FUTURENET_HORIZON_URL');
    const networkPassphrase = requireEnv('FUTURENET_NETWORK_PASSPHRASE');
    const stealthAddress = requireEnv('FUTURENET_STEALTH_ACCOUNT');
    const destination = requireEnv('FUTURENET_DESTINATION');
    const signerSecrets = requireEnv('FUTURENET_SIGNER_SECRETS')
      .split(',')
      .map((secret) => secret.trim())
      .filter(Boolean);
    const signers = signerSecrets.map((secret) => Keypair.fromSecret(secret));
    const requiredWeight = Number(process.env['FUTURENET_REQUIRED_WEIGHT'] ?? '3');

    const tx = await buildMultisigStealthWithdraw({
      stealthAddress,
      destination,
      requiredWeight,
      signers: signers.map((signer) => signer.publicKey()),
      horizonUrl,
      networkPassphrase,
      timeout: 900,
    });

    for (const signer of signers) {
      addStealthMultisigSigner(tx, signer);
      if (isStealthMultisigReady(tx)) break;
    }

    expect(isStealthMultisigReady(tx)).toBe(true);

    if (process.env['FUTURENET_SUBMIT'] === '1') {
      const res = await fetch(`${horizonUrl.replace(/\/$/, '')}/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ tx: tx.toXDR() }),
      });
      expect(res.ok).toBe(true);
    }
  }, 30_000);
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the futurenet multisig integration test`);
  }
  return value;
}
