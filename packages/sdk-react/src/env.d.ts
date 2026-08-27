declare module '@react-native-async-storage/async-storage' {
  const AsyncStorage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  export default AsyncStorage;
}

declare module 'expo-crypto' {
  export const CryptoDigestAlgorithm: {
    SHA256: string;
  };
  export function digestStringAsync(algorithm: string, data: string): Promise<string>;
}

declare module 'buffer' {
  export class Buffer {
    static from(data: any, encoding?: string): Buffer;
    static isBuffer(obj: any): boolean;
    toString(encoding?: string): string;
    [key: number]: number;
    length: number;
  }
}

declare module 'react-native-get-random-values' {
  const _: void;
  export default _;
}
