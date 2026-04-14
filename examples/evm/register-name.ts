/**
 * Register a .wraith name on Horizen.
 *
 * The name is bound to the spending key in the stealth meta-address.
 * Ownership is proven via secp256k1 signature — no wallet address stored.
 */
import {
  deriveStealthKeys,
  buildRegisterName,
  buildResolveName,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/evm';

// 1. Derive stealth keys
const signature = '0x...'; // wallet.signMessage(STEALTH_SIGNING_MESSAGE)
const keys = deriveStealthKeys(signature as `0x${string}`);

// 2. Build the register transaction
const tx = buildRegisterName({
  name: 'alice',
  stealthKeys: keys,
  chain: 'horizen',
});

console.log('Register tx:', tx);
// { to: "0x3d46...", data: "0x..." }

// Submit: await walletClient.sendTransaction(tx);

// 3. Later, anyone can resolve the name
const resolveCall = buildResolveName({
  name: 'alice',
  chain: 'horizen',
});

// Read: await publicClient.call({ to: resolveCall.to, data: resolveCall.data });
