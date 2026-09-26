import { describe, expect, it } from 'vitest';
import { Keypair, Networks, Operation } from '@stellar/stellar-sdk';
import {
  addStealthMultisigSigner,
  buildMultisigStealthWithdraw,
  isStealthMultisigReady,
} from '../../../src/chains/stellar/multisig';

function accountConfig(
  stealthAddress: string,
  sequence: string,
  signers: Array<{ key: string; weight: number }>,
) {
  return {
    sequence,
    thresholds: {
      low_threshold: 1,
      med_threshold: 2,
      high_threshold: 3,
    },
    signers: [{ key: stealthAddress, weight: 0, type: 'ed25519_public_key' }, ...signers],
  };
}

describe('Stellar multisig stealth withdraw', () => {
  it('builds an accountMerge withdrawal and waits for enough signer weight', async () => {
    const stealth = Keypair.random();
    const destination = Keypair.random();
    const signers = Array.from({ length: 5 }, () => Keypair.random());

    const tx = await buildMultisigStealthWithdraw({
      stealthAddress: stealth.publicKey(),
      destination: destination.publicKey(),
      requiredWeight: 3,
      signers: signers.map((signer) => signer.publicKey()),
      account: accountConfig(
        stealth.publicKey(),
        '12345',
        signers.map((signer) => ({ key: signer.publicKey(), weight: 1 })),
      ),
      networkPassphrase: Networks.TESTNET,
    });

    expect(tx.source).toBe(stealth.publicKey());
    expect(tx.operations).toHaveLength(1);
    expect((tx.operations[0] as Operation.AccountMerge).type).toBe('accountMerge');
    expect((tx.operations[0] as Operation.AccountMerge).destination).toBe(destination.publicKey());
    expect(isStealthMultisigReady(tx)).toBe(false);

    addStealthMultisigSigner(tx, signers[0]);
    addStealthMultisigSigner(tx, signers[1]);
    expect(isStealthMultisigReady(tx)).toBe(false);

    addStealthMultisigSigner(tx, signers[2]);
    expect(isStealthMultisigReady(tx)).toBe(true);
  });

  it('uses on-chain high threshold by default', async () => {
    const stealth = Keypair.random();
    const signerA = Keypair.random();
    const signerB = Keypair.random();

    const tx = await buildMultisigStealthWithdraw({
      stealthAddress: stealth.publicKey(),
      destination: Keypair.random().publicKey(),
      signers: [signerA.publicKey(), signerB.publicKey()],
      account: accountConfig(stealth.publicKey(), '12345', [
        { key: signerA.publicKey(), weight: 2 },
        { key: signerB.publicKey(), weight: 1 },
      ]),
      networkPassphrase: Networks.TESTNET,
    });

    addStealthMultisigSigner(tx, signerA);
    expect(isStealthMultisigReady(tx)).toBe(false);
    addStealthMultisigSigner(tx, signerB.secret());
    expect(isStealthMultisigReady(tx)).toBe(true);
  });

  it('rejects signers that are not configured on the account', async () => {
    const stealth = Keypair.random();
    const configured = Keypair.random();
    const unknown = Keypair.random();

    await expect(
      buildMultisigStealthWithdraw({
        stealthAddress: stealth.publicKey(),
        destination: Keypair.random().publicKey(),
        requiredWeight: 1,
        signers: [configured.publicKey(), unknown.publicKey()],
        account: accountConfig(stealth.publicKey(), '12345', [
          { key: configured.publicKey(), weight: 1 },
        ]),
        networkPassphrase: Networks.TESTNET,
      }),
    ).rejects.toThrow('is not configured');
  });

  it('rejects signer sets that cannot meet the required weight', async () => {
    const stealth = Keypair.random();
    const signer = Keypair.random();

    await expect(
      buildMultisigStealthWithdraw({
        stealthAddress: stealth.publicKey(),
        destination: Keypair.random().publicKey(),
        requiredWeight: 3,
        signers: [signer.publicKey()],
        account: accountConfig(stealth.publicKey(), '12345', [
          { key: signer.publicKey(), weight: 1 },
        ]),
        networkPassphrase: Networks.TESTNET,
      }),
    ).rejects.toThrow('required weight is 3');
  });

  it('does not append duplicate signatures for the same signer', async () => {
    const stealth = Keypair.random();
    const signer = Keypair.random();

    const tx = await buildMultisigStealthWithdraw({
      stealthAddress: stealth.publicKey(),
      destination: Keypair.random().publicKey(),
      requiredWeight: 1,
      signers: [{ key: signer.publicKey(), weight: 1 }],
      sequence: '12345',
      networkPassphrase: Networks.TESTNET,
    });

    addStealthMultisigSigner(tx, signer);
    addStealthMultisigSigner(tx, signer);
    expect(tx.signatures).toHaveLength(1);
    expect(isStealthMultisigReady(tx)).toBe(true);
  });
});
