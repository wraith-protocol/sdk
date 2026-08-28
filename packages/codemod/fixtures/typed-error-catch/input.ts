import { deriveStealthKeys } from '@wraith-protocol/sdk/chains/stellar';

export function tryDerive(signature: string) {
  try {
    return deriveStealthKeys(signature);
  } catch (e) {
    if (e.message.includes('Invalid signature length or format')) {
      console.log('bad signature');
    } else if (e.message.includes('Key derivation failed')) {
      console.log('derivation failed');
    } else {
      throw e;
    }
  }
}
