export interface PlatformStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PlatformCrypto {
  getRandomValues(array: Uint8Array): Uint8Array;
  sha256(data: Uint8Array): Promise<Uint8Array>;
}

export interface Platform {
  name: string;
  storage: PlatformStorage;
  crypto: PlatformCrypto;
  setup(): void;
}

const webPlatform: Platform = {
  name: 'web',
  storage: {
    async getItem(key: string): Promise<string | null> {
      return globalThis.localStorage?.getItem(key) ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      globalThis.localStorage?.setItem(key, value);
    },
    async removeItem(key: string): Promise<void> {
      globalThis.localStorage?.removeItem(key);
    },
  },
  crypto: {
    getRandomValues(array: Uint8Array): Uint8Array {
      return globalThis.crypto.getRandomValues(array);
    },
    async sha256(data: Uint8Array): Promise<Uint8Array> {
      const hash = await globalThis.crypto.subtle.digest('SHA-256', data as any);
      return new Uint8Array(hash);
    },
  },
  setup(): void {},
};

let currentPlatform: Platform = webPlatform;

export function getPlatform(): Platform {
  return currentPlatform;
}

export function setPlatform(platform: Platform): void {
  currentPlatform = platform;
  currentPlatform.setup();
}
