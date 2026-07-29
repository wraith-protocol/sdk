import { describe, test, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { KeyDerivationFailedError } from '../../../src/errors';
import { deriveStealthKeys, deriveStealthKeysFromSigner } from '../../../src/chains/stellar/keys';
import { STEALTH_SIGNING_MESSAGE } from '../../../src/chains/stellar/constants';
import {
  FreighterStealthSigner,
  WebAuthnPasskeyStealthSigner,
  type WebAuthnCredentialsContainer,
} from '../../../src/chains/stellar/signer';

const message = new TextEncoder().encode(STEALTH_SIGNING_MESSAGE);

describe('FreighterStealthSigner', () => {
  test('existing Freighter path is unchanged: signature bytes pass straight through', async () => {
    const rawSignature = new Uint8Array(64).fill(0xab);
    const signer = new FreighterStealthSigner({
      signMessage: async () => ({ signedMessage: rawSignature }),
    });

    const bytes = await signer.signMessage(message);
    expect(bytes).toEqual(rawSignature);

    const viaSigner = await deriveStealthKeysFromSigner(signer);
    const direct = deriveStealthKeys(rawSignature);
    expect(viaSigner).toEqual(direct);
  });

  test('decodes a base64-encoded signedMessage', async () => {
    const rawSignature = new Uint8Array(64).fill(0xcd);
    const base64 = Buffer.from(rawSignature).toString('base64');
    const signer = new FreighterStealthSigner({
      signMessage: async () => ({ signedMessage: base64 }),
    });

    const bytes = await signer.signMessage(message);
    expect(bytes).toEqual(rawSignature);
  });
});

/** Simulates a PRF-capable authenticator: deterministic per credential + salt. */
function mockPasskeyCredentials(credentialId: Uint8Array): WebAuthnCredentialsContainer {
  return {
    get: async (options: any) => {
      const eval_ = options.publicKey.extensions.prf.eval;
      const derive = (salt: Uint8Array) => {
        const input = new Uint8Array(credentialId.length + salt.length);
        input.set(credentialId);
        input.set(salt, credentialId.length);
        return sha256(input).buffer;
      };
      return {
        getClientExtensionResults: () => ({
          prf: {
            results: {
              first: derive(new Uint8Array(eval_.first)),
              second: derive(new Uint8Array(eval_.second)),
            },
          },
        }),
      };
    },
  };
}

describe('WebAuthnPasskeyStealthSigner', () => {
  const credentialId = new Uint8Array(16).fill(0x11);

  test('derives the same stealth keys across two separate sessions', async () => {
    const session1 = new WebAuthnPasskeyStealthSigner({
      credentialId,
      credentials: mockPasskeyCredentials(credentialId),
    });
    const session2 = new WebAuthnPasskeyStealthSigner({
      credentialId,
      credentials: mockPasskeyCredentials(credentialId),
    });

    const keys1 = await deriveStealthKeysFromSigner(session1);
    const keys2 = await deriveStealthKeysFromSigner(session2);

    expect(keys1.spendingKey).toEqual(keys2.spendingKey);
    expect(keys1.viewingKey).toEqual(keys2.viewingKey);
    expect(keys1.spendingPubKey).toEqual(keys2.spendingPubKey);
    expect(keys1.viewingPubKey).toEqual(keys2.viewingPubKey);
  });

  test('different credentials derive different keys', async () => {
    const otherCredentialId = new Uint8Array(16).fill(0x22);
    const signerA = new WebAuthnPasskeyStealthSigner({
      credentialId,
      credentials: mockPasskeyCredentials(credentialId),
    });
    const signerB = new WebAuthnPasskeyStealthSigner({
      credentialId: otherCredentialId,
      credentials: mockPasskeyCredentials(otherCredentialId),
    });

    const keysA = await deriveStealthKeysFromSigner(signerA);
    const keysB = await deriveStealthKeysFromSigner(signerB);

    expect(keysA.spendingKey).not.toEqual(keysB.spendingKey);
  });

  test('throws when no credentials container is available', () => {
    expect(
      () =>
        new WebAuthnPasskeyStealthSigner({
          credentialId,
        }),
    ).toThrow(KeyDerivationFailedError);
  });

  test('throws when the authenticator does not return PRF results', async () => {
    const signer = new WebAuthnPasskeyStealthSigner({
      credentialId,
      credentials: {
        get: async () => ({
          getClientExtensionResults: () => ({}),
        }),
      },
    });

    await expect(signer.signMessage(message)).rejects.toThrow(KeyDerivationFailedError);
  });
});
