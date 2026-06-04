import 'react-native-get-random-values';
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as any).Buffer = Buffer;
}

if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (input: string) => {
    const base64 = input.replace(/=+$/, '');
    let str = '';
    let bc = 0;
    let bs = 0;
    let buffer;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

    for (let idx = 0; (buffer = base64.charAt(idx++)); ) {
      const code = chars.indexOf(buffer);
      if (code === -1) continue;
      bs = (bs << 6) | code;
      bc += 6;
      if (bc >= 8) {
        bc -= 8;
        str += String.fromCharCode((bs >> bc) & 0xff);
      }
    }

    return str;
  };
}

if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (input: string) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let str = input;
    let output = '';

    for (let block = 0, charCode, idx = 0, map = chars; str.charAt(idx | 0) || ((map = '='), idx % 1); ) {
      charCode = str.charCodeAt((idx += 3 / 4));
      if (charCode > 0xff) {
        throw new Error('Failed to execute btoa: The string to be encoded contains characters outside of the Latin1 range.');
      }
      output += map.charAt((block = (block << 8) | charCode) >> ((3.5 - (idx % 1)) * 8) & 0x3f);
    }

    return output;
  };
}
