import type { Platform } from './platform';

export const nativePlatform: Platform = {
  name: 'native',
  storage: {
    async getItem(key: string): Promise<string | null> {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      return AsyncStorage.getItem(key);
    },
    async setItem(key: string, value: string): Promise<void> {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      return AsyncStorage.setItem(key, value);
    },
    async removeItem(key: string): Promise<void> {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      return AsyncStorage.removeItem(key);
    },
  },
  crypto: {
    getRandomValues(array: Uint8Array): Uint8Array {
      if (typeof globalThis.crypto?.getRandomValues === 'function') {
        return globalThis.crypto.getRandomValues(array);
      }
      throw new Error(
        'crypto.getRandomValues unavailable. Install expo-crypto or react-native-get-random-values.',
      );
    },
    async sha256(data: Uint8Array): Promise<Uint8Array> {
      const { CryptoDigestAlgorithm, digestStringAsync } = require('expo-crypto');
      const hex = await digestStringAsync(
        CryptoDigestAlgorithm.SHA256,
        String.fromCharCode(...data),
      );
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
      }
      return bytes;
    },
  },
  setup(): void {
    require('react-native-get-random-values');
    const { Buffer } = require('buffer');
    if (typeof globalThis.Buffer === 'undefined') {
      (globalThis as any).Buffer = Buffer;
    }
  },
};
