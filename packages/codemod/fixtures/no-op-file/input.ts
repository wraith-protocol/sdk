import { deriveStealthKeys } from '@wraith-protocol/sdk/chains/stellar';

export function tryDerive(signature: string) {
  try {
    return deriveStealthKeys(signature);
  } catch (e) {
    // Generic catch, not matching any known @wraith-protocol/sdk error
    // message fragment -- should be left completely untouched.
    console.log('unexpected error', e.message.includes('some unrelated string'));
  }
}
