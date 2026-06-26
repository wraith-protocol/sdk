import {
  Account,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  type Horizon,
} from '@stellar/stellar-sdk';

interface WeightedSigner {
  key: string;
  weight: number;
}

interface AccountConfig {
  sequence: string;
  thresholds: {
    med_threshold?: number;
    high_threshold?: number;
  };
  signers: WeightedSigner[];
}

export interface BuildMultisigStealthWithdrawOptions {
  /** Stealth source account to close. */
  stealthAddress: string;
  /** Destination that receives the stealth account's remaining native balance. */
  destination: string;
  /** Signature weight required before submission. Defaults to the account high threshold. */
  requiredWeight?: number;
  /** Signer public keys expected to approve this withdrawal. */
  signers: Array<string | WeightedSigner>;
  /** Network passphrase for the built transaction. */
  networkPassphrase: string;
  /** Current stealth account sequence. Optional when account or horizonUrl is supplied. */
  sequence?: string;
  /** Prefetched Horizon account record for on-chain validation without a network call. */
  account?: Pick<Horizon.ServerApi.AccountRecord, 'sequence' | 'thresholds' | 'signers'>;
  /** Horizon URL used to load and validate the stealth account. */
  horizonUrl?: string;
  /** Base fee in stroops. Defaults to 100. */
  fee?: string;
  /** Transaction timeout in seconds. Defaults to 180. */
  timeout?: number;
}

interface MultisigState {
  requiredWeight: number;
  signers: Map<string, number>;
}

const txState = new WeakMap<Transaction, MultisigState>();

/**
 * Builds an unsigned account-merge withdrawal from a Stellar stealth account.
 *
 * The helper validates the requested signers against the stealth account's
 * configured signer weights when `account` or `horizonUrl` is supplied. The
 * resulting transaction closes the stealth account and sends its native XLM
 * balance to `destination`.
 */
export async function buildMultisigStealthWithdraw(
  options: BuildMultisigStealthWithdrawOptions,
): Promise<Transaction> {
  const accountConfig = await resolveAccountConfig(options);
  const requiredWeight =
    options.requiredWeight ??
    accountConfig?.thresholds.high_threshold ??
    accountConfig?.thresholds.med_threshold;

  if (requiredWeight === undefined || requiredWeight <= 0) {
    throw new Error('requiredWeight must be supplied or available from the account thresholds');
  }

  const expectedSigners = normalizeRequestedSigners(options.signers, accountConfig);
  const availableWeight = [...expectedSigners.values()].reduce((sum, weight) => sum + weight, 0);

  if (availableWeight < requiredWeight) {
    throw new Error(
      `Requested signers only provide weight ${availableWeight}; required weight is ${requiredWeight}`,
    );
  }

  const sequence = options.sequence ?? accountConfig?.sequence;
  if (!sequence) {
    throw new Error('sequence must be supplied or available from account/horizonUrl');
  }

  const source = new Account(options.stealthAddress, sequence);
  const tx = new TransactionBuilder(source, {
    fee: options.fee ?? '100',
    networkPassphrase: options.networkPassphrase,
  })
    .addOperation(Operation.accountMerge({ destination: options.destination }))
    .setTimeout(options.timeout ?? 180)
    .build();

  txState.set(tx, { requiredWeight, signers: expectedSigners });
  return tx;
}

/**
 * Appends a signer signature to a multisig stealth withdrawal transaction.
 *
 * `signerKey` may be a Stellar `Keypair` or a secret seed string. The helper
 * verifies that the signer was declared when the transaction was built.
 */
export function addStealthMultisigSigner(
  tx: Transaction,
  signerKey: Keypair | string,
): Transaction {
  const keypair = typeof signerKey === 'string' ? Keypair.fromSecret(signerKey) : signerKey;
  const publicKey = keypair.publicKey();
  const state = txState.get(tx);

  if (state && !state.signers.has(publicKey)) {
    throw new Error(`Signer ${publicKey} is not authorized for this stealth withdrawal`);
  }

  if (hasSignatureFrom(tx, publicKey)) {
    return tx;
  }

  tx.sign(keypair);
  return tx;
}

/**
 * Returns true once appended signer weights meet the withdrawal threshold.
 */
export function isStealthMultisigReady(tx: Transaction): boolean {
  const state = txState.get(tx);
  if (!state) {
    throw new Error(
      'Missing multisig metadata; build the transaction with buildMultisigStealthWithdraw',
    );
  }

  let weight = 0;
  for (const [publicKey, signerWeight] of state.signers) {
    if (hasSignatureFrom(tx, publicKey)) {
      weight += signerWeight;
    }
  }
  return weight >= state.requiredWeight;
}

async function resolveAccountConfig(
  options: BuildMultisigStealthWithdrawOptions,
): Promise<AccountConfig | null> {
  if (options.account) {
    return accountRecordToConfig(options.account);
  }

  if (!options.horizonUrl) {
    return null;
  }

  const res = await fetch(
    `${options.horizonUrl.replace(/\/$/, '')}/accounts/${options.stealthAddress}`,
  );
  if (!res.ok) {
    throw new Error(`Horizon account lookup failed: ${res.status} ${res.statusText}`);
  }
  return accountRecordToConfig((await res.json()) as Horizon.ServerApi.AccountRecord);
}

function accountRecordToConfig(
  account: Pick<Horizon.ServerApi.AccountRecord, 'sequence' | 'thresholds' | 'signers'>,
): AccountConfig {
  return {
    sequence: account.sequence,
    thresholds: account.thresholds,
    signers: account.signers.map((signer) => ({
      key: signer.key,
      weight: signer.weight,
    })),
  };
}

function normalizeRequestedSigners(
  requested: Array<string | WeightedSigner>,
  accountConfig: AccountConfig | null,
): Map<string, number> {
  if (requested.length === 0) {
    throw new Error('At least one signer is required');
  }

  const accountWeights = new Map(
    accountConfig?.signers.map((signer) => [signer.key, signer.weight]) ?? [],
  );
  const normalized = new Map<string, number>();

  for (const signer of requested) {
    const key = typeof signer === 'string' ? signer : signer.key;
    const declaredWeight = typeof signer === 'string' ? undefined : signer.weight;
    const accountWeight = accountWeights.get(key);

    if (accountConfig && accountWeight === undefined) {
      throw new Error(`Signer ${key} is not configured on the stealth account`);
    }

    const weight = accountWeight ?? declaredWeight;
    if (weight === undefined || weight <= 0) {
      throw new Error(`Signer ${key} must have a positive weight`);
    }

    normalized.set(key, weight);
  }

  return normalized;
}

function hasSignatureFrom(tx: Transaction, publicKey: string): boolean {
  const hint = Keypair.fromPublicKey(publicKey).signatureHint().toString('hex');
  return tx.signatures.some((signature) => signature.hint().toString('hex') === hint);
}
