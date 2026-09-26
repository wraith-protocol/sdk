import { TransactionBuilder, Account, Keypair, xdr } from '@stellar/stellar-sdk';
import { getDeployment } from './deployments';
import { signWithScalar } from './scalar';
import { RPCRequestError, InvalidSignatureError } from '../../errors';

export interface OfflineSignParams {
  /** Stellar account public key (G...) of the transaction source. */
  source: string;
  /** Array of Stellar operations to include. Build via Operation.payment(), etc. */
  ops: xdr.Operation[];
  /** Current sequence number of the source account (as a string). */
  sequence: string;
  /** Stellar network passphrase, e.g. "Test SDF Network ; September 2015". */
  networkPassphrase: string;
  /** Base fee in stroops. Defaults to "100". */
  fee?: string;
  /** Transaction timeout in seconds. Defaults to 180. */
  timeout?: number;
}

export interface OfflineStellarEnvelope {
  /** Base64-encoded transaction envelope XDR, ready for signing. */
  transactionXdr: string;
  /** Network passphrase used to construct the envelope, required for signing. */
  networkPassphrase: string;
  /** Hex-encoded SHA-256 hash of the transaction envelope (the signing payload). */
  hash: string;
}

/**
 * Builds a Stellar transaction envelope offline without connecting to an RPC
 * or Horizon server. The caller provides the account sequence number and
 * operations directly, making this suitable for air-gapped or offline signing
 * workflows.
 *
 * Operations are added to the transaction in the order provided. The returned
 * envelope is serializable as plain JSON and can be transferred to a signing
 * environment.
 *
 * @param params - Source account, operations, sequence, and network config.
 * @returns A serializable envelope with the XDR, network passphrase, and hash.
 * @throws {Error} If required inputs are missing or invalid.
 *
 * @example
 * ```ts
 * import { Operation, Asset } from '@stellar/stellar-sdk';
 * import { prepareOfflineStellarTransaction } from '@wraith-protocol/sdk/chains/stellar';
 *
 * const envelope = prepareOfflineStellarTransaction({
 *   source: 'GB...',
 *   ops: [Operation.payment({ destination: 'GC...', asset: Asset.native(), amount: '100' })],
 *   sequence: '12345',
 *   networkPassphrase: 'Test SDF Network ; September 2015',
 * });
 * // → { transactionXdr: 'AAAA...', networkPassphrase: '...', hash: '...' }
 * ```
 *
 * @see {@link signOfflineStellarTransaction}
 * @see {@link submitOfflineStellarTransaction}
 */
export function prepareOfflineStellarTransaction(
  params: OfflineSignParams,
): OfflineStellarEnvelope {
  const { source, ops, sequence, networkPassphrase, fee = '100', timeout = 180 } = params;

  if (!source || typeof source !== 'string') {
    throw new Error('source must be a valid Stellar public key (G...)');
  }
  if (!ops || !Array.isArray(ops) || ops.length === 0) {
    throw new Error('at least one operation is required');
  }
  if (!sequence || typeof sequence !== 'string') {
    throw new Error('sequence must be a valid sequence number string');
  }
  if (!networkPassphrase || typeof networkPassphrase !== 'string') {
    throw new Error('networkPassphrase is required');
  }

  const sourceAccount = new Account(source, sequence);
  const builder = new TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase,
  }).setTimeout(timeout);

  for (const op of ops) {
    builder.addOperation(op);
  }

  const transaction = builder.build();
  const transactionXdr = transaction.toEnvelope().toXDR('base64');
  const hash = Buffer.from(transaction.hash()).toString('hex');

  return { transactionXdr, networkPassphrase, hash };
}

/**
 * Signs an offline-prepared Stellar transaction envelope and returns the signed
 * XDR string ready for submission.
 *
 * Accepts either:
 * - A Stellar secret key string (starting with `S`) for standard signers.
 * - A `bigint` stealth private scalar, which must be accompanied by the
 *   corresponding stealth public key bytes for the signature hint.
 *
 * @param envelope - The envelope returned by {@link prepareOfflineStellarTransaction}.
 * @param key - Stellar secret key (S...) or stealth private scalar (bigint).
 * @param stealthPubKey - Required when `key` is a stealth scalar; the 32-byte
 *   ed25519 stealth public key that corresponds to the scalar.
 * @returns Base64-encoded signed transaction envelope XDR.
 * @throws {InvalidSignatureError} If the key format is unrecognized.
 * @throws {Error} If `stealthPubKey` is missing for stealth scalar signing.
 *
 * @example
 * ```ts
 * // Standard signing with a Stellar secret key
 * const signed = signOfflineStellarTransaction(envelope, 'S...');
 *
 * // Stealth scalar signing
 * const signed = signOfflineStellarTransaction(envelope, stealthScalar, stealthPubKey);
 * ```
 *
 * @see {@link prepareOfflineStellarTransaction}
 * @see {@link submitOfflineStellarTransaction}
 */
export function signOfflineStellarTransaction(
  envelope: OfflineStellarEnvelope,
  key: string | bigint,
  stealthPubKey?: Uint8Array,
): string {
  if (!envelope || !envelope.transactionXdr || !envelope.networkPassphrase) {
    throw new Error('Invalid envelope: transactionXdr and networkPassphrase are required');
  }

  const tx = TransactionBuilder.fromXDR(envelope.transactionXdr, envelope.networkPassphrase);

  if (typeof key === 'string') {
    const keypair = Keypair.fromSecret(key);
    tx.sign(keypair);
    return tx.toEnvelope().toXDR('base64');
  }

  if (typeof key === 'bigint') {
    if (!stealthPubKey || stealthPubKey.length !== 32) {
      throw new Error(
        'stealthPubKey (32 bytes) is required when signing with a stealth private scalar',
      );
    }

    const txHash = new Uint8Array(tx.hash());
    const sigBytes = signWithScalar(txHash, key, stealthPubKey);

    const hint = Buffer.from(stealthPubKey.slice(stealthPubKey.length - 4));
    const decoratedSig = new xdr.DecoratedSignature({
      hint,
      signature: Buffer.from(sigBytes),
    });

    tx.signatures.push(decoratedSig);
    return tx.toEnvelope().toXDR('base64');
  }

  throw new InvalidSignatureError(String(key));
}

/**
 * Submits a signed Stellar transaction to the configured Horizon endpoint.
 *
 * Determines the Horizon URL from the chain deployment config. Returns the
 * parsed Horizon response, which includes the transaction hash, ledger
 * sequence, and result envelope on success.
 *
 * @param signedXdr - Base64-encoded signed transaction envelope XDR.
 * @param network - Chain deployment key (default: `"stellar"`).
 * @returns Parsed Horizon response JSON.
 * @throws {RPCRequestError} If the Horizon submission fails.
 * @throws {Error} If `signedXdr` is empty or invalid.
 *
 * @example
 * ```ts
 * const result = await submitOfflineStellarTransaction(signedXdr);
 * console.log(result.hash);
 * ```
 *
 * @see {@link prepareOfflineStellarTransaction}
 * @see {@link signOfflineStellarTransaction}
 */
export async function submitOfflineStellarTransaction(
  signedXdr: string,
  network: string = 'stellar',
): Promise<Record<string, unknown>> {
  if (!signedXdr || typeof signedXdr !== 'string') {
    throw new Error('signedXdr must be a non-empty base64 string');
  }

  const deployment = getDeployment(network);
  const horizonUrl = deployment.horizonUrl;

  const res = await fetch(`${horizonUrl}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx: signedXdr }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new RPCRequestError(horizonUrl, res.status, JSON.stringify(data));
  }

  return data;
}
