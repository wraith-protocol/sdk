function btoaPolyfill(input: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  const bytes = new TextEncoder().encode(input);
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    output += chars.charAt(b0 >> 2);
    output += chars.charAt(((b0 & 3) << 4) | (b1 >> 4));
    output += i + 1 < bytes.length ? chars.charAt(((b1 & 15) << 2) | (b2 >> 6)) : '=';
    output += i + 2 < bytes.length ? chars.charAt(b2 & 63) : '=';
  }
  return output;
}

function atobPolyfill(input: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let str = input.replace(/=+$/, '');
  let output = '';
  if (str.length % 4 === 1) throw new Error('InvalidCharacterError');
  for (let i = 0; i < str.length; i += 4) {
    const c0 = chars.indexOf(str[i]);
    const c1 = chars.indexOf(str[i + 1]);
    const c2 = chars.indexOf(str[i + 2]);
    const c3 = chars.indexOf(str[i + 3]);
    output += String.fromCharCode(((c0 << 2) | (c1 >> 4)) & 0xff);
    if (c2 !== -1) output += String.fromCharCode(((c1 << 4) | (c2 >> 2)) & 0xff);
    if (c3 !== -1) output += String.fromCharCode(((c2 << 6) | c3) & 0xff);
  }
  return output;
}

function ensureTextEncoding(): void {
  if (typeof globalThis.TextEncoder === 'undefined') {
    // Minimal TextEncoder fallback for browsers and React Native engines
    globalThis.TextEncoder = class TextEncoder {
      encode(input: string): Uint8Array {
        const utf8 = unescape(encodeURIComponent(input));
        const result = new Uint8Array(utf8.length);
        for (let i = 0; i < utf8.length; i += 1) {
          result[i] = utf8.charCodeAt(i);
        }
        return result;
      }
    } as any;
  }

  if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = class TextDecoder {
      decode(input: Uint8Array | ArrayBuffer): string {
        const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
        let str = '';
        for (let i = 0; i < bytes.length; i += 1) {
          str += String.fromCharCode(bytes[i]);
        }
        return decodeURIComponent(escape(str));
      }
    } as any;
  }
}

export function installReactNativePolyfills(): void {
  ensureTextEncoding();

  if (typeof globalThis.atob === 'undefined') {
    globalThis.atob = atobPolyfill as any;
  }

  if (typeof globalThis.btoa === 'undefined') {
    globalThis.btoa = btoaPolyfill as any;
  }

  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error(
      'React Native requires a crypto polyfill. Install and import react-native-get-random-values before using @wraith-protocol/sdk.',
    );
  }
}
