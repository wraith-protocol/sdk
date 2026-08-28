import { describe, expect, test, vi } from 'vitest';
import { deriveStealthKeys as deriveEvmKeys } from '../../src/chains/evm/keys';
import { STEALTH_SIGNING_MESSAGE as EVM_MESSAGE } from '../../src/chains/evm/constants';
import { deriveStealthKeys as deriveSolanaKeys } from '../../src/chains/solana/keys';
import { STEALTH_SIGNING_MESSAGE as SOLANA_MESSAGE } from '../../src/chains/solana/constants';
import { deriveStealthKeys as deriveStellarKeys } from '../../src/chains/stellar/keys';
import { STEALTH_SIGNING_MESSAGE as STELLAR_MESSAGE } from '../../src/chains/stellar/constants';
import { deriveStealthKeysFromWallet } from '../../src/wallet/adapter';
import { FreighterWalletAdapter } from '../../src/wallet/adapters/freighter';
import { SolanaWalletAdapter } from '../../src/wallet/adapters/solana';
import { ViemWalletAdapter } from '../../src/wallet/adapters/viem';

describe('deriveStealthKeysFromWallet', () => {
  test('routes Stellar wallets with the Stellar derivation message', async () => {
    const signature = new Uint8Array(64).fill(0x11);
    const signMessage = vi.fn(async () => signature);
    const keys = await deriveStealthKeysFromWallet({
      chain: 'stellar',
      getAddress: async () => 'GABC',
      signMessage,
    });

    expect(new TextDecoder().decode(signMessage.mock.calls[0][0])).toBe(STELLAR_MESSAGE);
    expect(keys).toEqual(deriveStellarKeys(signature));
  });

  test('routes EVM wallets with the EVM derivation message', async () => {
    const signature = `0x${'22'.repeat(65)}` as `0x${string}`;
    const signMessage = vi.fn(async () => signature);
    const keys = await deriveStealthKeysFromWallet({
      chain: 'evm',
      getAddress: async () => '0x1234',
      signMessage,
    });

    expect(new TextDecoder().decode(signMessage.mock.calls[0][0])).toBe(EVM_MESSAGE);
    expect(keys).toEqual(deriveEvmKeys(signature));
  });

  test('routes Solana wallets with the Solana derivation message', async () => {
    const signature = new Uint8Array(64).fill(0x33);
    const signMessage = vi.fn(async () => signature);
    const keys = await deriveStealthKeysFromWallet({
      chain: 'solana',
      getAddress: async () => 'So1ana',
      signMessage,
    });

    expect(new TextDecoder().decode(signMessage.mock.calls[0][0])).toBe(SOLANA_MESSAGE);
    expect(keys).toEqual(deriveSolanaKeys(signature));
  });
});

describe('reference wallet adapters', () => {
  test('wraps Freighter without importing its package', async () => {
    const signature = new Uint8Array(64).fill(0x44);
    const wallet = {
      getAddress: vi.fn(async () => ({ address: 'GTEST' })),
      signMessage: vi.fn(async () => ({ signedMessage: signature })),
    };
    const adapter = new FreighterWalletAdapter(wallet);

    expect(adapter.chain).toBe('stellar');
    expect(await adapter.getAddress()).toBe('GTEST');
    expect(await adapter.signMessage(new TextEncoder().encode('hello'))).toEqual(signature);
    expect(wallet.signMessage).toHaveBeenCalledWith('hello');
  });

  test('wraps a viem WalletClient structurally', async () => {
    const signature = `0x${'55'.repeat(65)}` as `0x${string}`;
    const signMessage = vi.fn(async () => signature);
    const adapter = new ViemWalletAdapter({
      account: { address: '0xabc' },
      signMessage,
    });
    const message = new Uint8Array([1, 2, 3]);

    expect(await adapter.getAddress()).toBe('0xabc');
    expect(await adapter.signMessage(message)).toBe(signature);
    expect(signMessage).toHaveBeenCalledWith({
      account: { address: '0xabc' },
      message: { raw: message },
    });
  });

  test('wraps a Solana wallet-adapter wallet structurally', async () => {
    const signature = new Uint8Array(64).fill(0x66);
    const adapter = new SolanaWalletAdapter({
      publicKey: { toBase58: () => 'So1anaAddress' },
      signMessage: async () => signature,
    });

    expect(adapter.chain).toBe('solana');
    expect(await adapter.getAddress()).toBe('So1anaAddress');
    expect(await adapter.signMessage(new Uint8Array([1]))).toEqual(signature);
  });
});
