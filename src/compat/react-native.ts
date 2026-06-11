function btoaPolyfill(input: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = input;
  let output = '';

  for (let block = 0, charCode, idx = 0, map = chars; str.charAt(idx | 0) || ((map = '='), idx % 1); ) {
    charCode = str.charCodeAt((idx += 3 / 4));
    if (charCode > 0xff) {
      throw new Error("Unable to encode character as binary data");
    }
    output +=
      map.charAt((block = (block << 8) | charCode) >> ((3.5 - (idx % 1)) * 8) & 0x3f);
  }

  return output;
}

function atobPolyfill(input: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = input.replace(/=+$/, '');
  let output = '';

  if (str.length % 4 === 1) {
    throw new Error("InvalidCharacterError: Incorrect base64 string length");
  }

  for (let bc = 0, bs = 0, buffer, idx = 0; (buffer = str.charAt(idx++)); ) {
    const code = chars.indexOf(buffer);
    if (code === -1) {
      continue;
    }
    bs = (bs << 6) | code;
    bc += 6;
    if (bc >= 8) {
      output += String.fromCharCode((bs >> (bc -= 8)) & 0xff);
    }
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
