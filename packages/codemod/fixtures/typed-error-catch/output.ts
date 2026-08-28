import { deriveStealthKeys } from '@wraith-protocol/sdk/chains/stellar';

import { InvalidSignatureError, KeyDerivationFailedError } from '@wraith-protocol/sdk';

export function tryDerive(signature: string) {
  try {
    return deriveStealthKeys(signature);
  } catch (e) {
    if (e instanceof InvalidSignatureError) {
      console.log('bad signature');
    } else if (e instanceof KeyDerivationFailedError) {
      console.log('derivation failed');
    } else {
      throw e;
    }
  }
}
