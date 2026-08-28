const DOCS_BASE_URL = 'https://docs.wraith.dev/sdk/errors';

export abstract class WraithError extends Error {
  abstract readonly code: string;
  readonly docsLink: string;

  constructor(
    message: string,
    public readonly context?: Record<string, any>,
  ) {
    super(message);

    // Set prototype explicitly for correct instanceof behavior in ES5/older environments
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = this.constructor.name;

    const anchor = this.constructor.name
      .replace(/Error$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase();
    this.docsLink = `${DOCS_BASE_URL}#${anchor}`;

    // Overwrite the message to include the docs link
    this.message = `${message} (See ${this.docsLink})`;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      docsLink: this.docsLink,
      context: this.context,
    };
  }

  /**
   * Returns a short, actionable "what to try" hint for this error, derived
   * from its `context`. Concrete subclasses should override this with a hint
   * tailored to their specific failure mode. The default implementation is a
   * generic fallback so `describe()` is always safe to call.
   */
  describe(): string {
    return `No specific guidance is available for this error. See ${this.docsLink} for details.`;
  }
}

// Intermediary Base Error Classes
export abstract class WraithInputError extends WraithError {}
export abstract class WraithCryptoError extends WraithError {}
export abstract class WraithNetworkError extends WraithError {}
export abstract class WraithContractError extends WraithError {}
export abstract class WraithBuilderError extends WraithError {}

// WraithInputError Subclasses
export class InvalidMetaAddressError extends WraithInputError {
  readonly code = 'WRAITH/INPUT/INVALID_META_ADDRESS';

  constructor(metaAddress: string, reason?: string) {
    super(`Invalid stealth meta-address format: "${metaAddress}"${reason ? `. ${reason}` : ''}`, {
      metaAddress,
      reason,
    });
  }

  describe(): string {
    const { metaAddress, reason } = this.context ?? {};
    return (
      `"${metaAddress}" is not a valid stealth meta-address${reason ? ` (${reason})` : ''}. Try: ` +
      `re-generate it with encodeStealthMetaAddress() rather than building the string by hand, and ` +
      `confirm it targets the network you're actually using. See ${this.docsLink}.`
    );
  }
}

export class InvalidNameError extends WraithInputError {
  readonly code = 'WRAITH/INPUT/INVALID_NAME';

  constructor(name: string, reason?: string) {
    super(`Invalid name: "${name}"${reason ? `. ${reason}` : ''}`, { name, reason });
  }

  describe(): string {
    const { name, reason } = this.context ?? {};
    return (
      `"${name}" isn't a valid .wraith name${reason ? ` (${reason})` : ''}. Try: check the length ` +
      `and character rules in the docs, then re-submit. See ${this.docsLink}.`
    );
  }
}

export class InvalidSignatureError extends WraithInputError {
  readonly code = 'WRAITH/INPUT/INVALID_SIGNATURE';

  constructor(signature: string | Uint8Array, expectedLength?: number, actualLength?: number) {
    const sigStr = typeof signature === 'string' ? signature : '[Uint8Array]';
    super(
      `Invalid signature length or format: "${sigStr}"${
        expectedLength !== undefined && actualLength !== undefined
          ? `. Expected ${expectedLength} bytes, got ${actualLength}`
          : ''
      }`,
      { signature: sigStr, expectedLength, actualLength },
    );
  }

  describe(): string {
    const { expectedLength, actualLength } = this.context ?? {};
    const lengthHint =
      expectedLength !== undefined && actualLength !== undefined
        ? `Expected ${expectedLength} bytes but got ${actualLength}. `
        : '';
    return (
      `The signature is malformed. ${lengthHint}Try: confirm the signer produced a raw signature ` +
      `(not hex-prefixed or base64-wrapped) and that you're passing the right byte encoding. ` +
      `See ${this.docsLink}.`
    );
  }
}

export class InvalidScalarError extends WraithInputError {
  readonly code = 'WRAITH/INPUT/INVALID_SCALAR';

  constructor(scalar: string | bigint, reason?: string) {
    super(`Invalid cryptographic scalar: "${scalar.toString()}"${reason ? `. ${reason}` : ''}`, {
      scalar: scalar.toString(),
      reason,
    });
  }

  describe(): string {
    const { reason } = this.context ?? {};
    return (
      `The computed scalar is out of valid curve range${reason ? ` (${reason})` : ''}. Try: this is ` +
      `usually transient — retry the key derivation with fresh randomness, or check the inputs that ` +
      `fed into it. See ${this.docsLink}.`
    );
  }
}

// WraithCryptoError Subclasses
export class KeyDerivationFailedError extends WraithCryptoError {
  readonly code = 'WRAITH/CRYPTO/KEY_DERIVATION_FAILED';

  constructor(reason: string) {
    super(`Key derivation failed: ${reason}`, { reason });
  }

  describe(): string {
    const { reason } = this.context ?? {};
    return (
      `Stealth key derivation failed (${reason}). Try: verify the signature and spending/viewing ` +
      `keys used for derivation are from the same account, and retry. See ${this.docsLink}.`
    );
  }
}

export class ViewTagMismatchError extends WraithCryptoError {
  readonly code = 'WRAITH/CRYPTO/VIEW_TAG_MISMATCH';

  constructor(expectedTag: number, actualTag: number) {
    super(`View tag mismatch. Expected ${expectedTag}, got ${actualTag}`, {
      expectedTag,
      actualTag,
    });
  }

  describe(): string {
    const { expectedTag, actualTag } = this.context ?? {};
    return (
      `View tag ${actualTag} doesn't match the expected ${expectedTag}. Try: this announcement ` +
      `likely isn't for you — it's expected and safe to skip during a scan. Only investigate if ` +
      `this happens for an announcement you know is yours. See ${this.docsLink}.`
    );
  }
}

export class ECDHFailedError extends WraithCryptoError {
  readonly code = 'WRAITH/CRYPTO/ECDH_FAILED';

  constructor(reason: string) {
    super(`Elliptic Curve Diffie-Hellman (ECDH) operation failed: ${reason}`, { reason });
  }

  describe(): string {
    const { reason } = this.context ?? {};
    return (
      `ECDH failed (${reason}). Try: confirm the public point you're using is actually on the curve ` +
      `and wasn't corrupted or hex-decoded incorrectly upstream. See ${this.docsLink}.`
    );
  }
}

// WraithNetworkError Subclasses
export class RPCRequestError extends WraithNetworkError {
  readonly code = 'WRAITH/NETWORK/RPC_REQUEST';
  readonly statusCode: number;

  constructor(url: string, statusCode: number, responseText?: string) {
    super(
      `RPC request failed to "${url}" with status ${statusCode}${responseText ? `: ${responseText}` : ''}`,
      {
        url,
        statusCode,
        responseText,
      },
    );
    this.statusCode = statusCode;
  }

  describe(): string {
    const { url, statusCode } = this.context ?? {};
    const hint =
      statusCode >= 500
        ? 'the endpoint is likely having issues — retry with backoff or switch RPC providers'
        : statusCode === 429
          ? 'you are being rate-limited — slow down requests or use a different endpoint'
          : statusCode === 401 || statusCode === 403
            ? 'check your API key / auth header for this endpoint'
            : 'check the request payload and endpoint URL for correctness';
    return `RPC call to "${url}" returned ${statusCode}. Try: ${hint}. See ${this.docsLink}.`;
  }
}

export class RPCRetryExhaustedError extends WraithNetworkError {
  readonly code = 'WRAITH/NETWORK/RPC_RETRY_EXHAUSTED';

  constructor(url: string, attempts: number, lastError?: string) {
    super(
      `RPC request retries exhausted for "${url}" after ${attempts} attempts${
        lastError ? `. Last error: ${lastError}` : ''
      }`,
      { url, attempts, lastError },
    );
  }

  describe(): string {
    const { url, attempts, lastError } = this.context ?? {};
    return (
      `Gave up on "${url}" after ${attempts} attempts${lastError ? ` (last error: ${lastError})` : ''}. ` +
      `Try: check the endpoint is reachable and healthy, or configure a fallback RPC URL. ` +
      `See ${this.docsLink}.`
    );
  }
}

export class RetentionExceededError extends WraithNetworkError {
  readonly code = 'WRAITH/NETWORK/RETENTION_EXCEEDED';

  constructor(limit: number, actual: number) {
    super(`Retention limit exceeded. Max allowed is ${limit}, actual is ${actual}`, {
      limit,
      actual,
    });
  }

  describe(): string {
    const { limit, actual } = this.context ?? {};
    return (
      `Requested a range of ${actual}, but the max retention window is ${limit}. Try: narrow the ` +
      `query to a smaller time/block range, or paginate across multiple requests. See ${this.docsLink}.`
    );
  }
}

// WraithContractError Subclasses
export class NameNotFoundError extends WraithContractError {
  readonly code = 'WRAITH/CONTRACT/NAME_NOT_FOUND';

  constructor(name: string) {
    super(`Name not found: "${name}"`, { name });
  }

  describe(): string {
    const { name } = this.context ?? {};
    return (
      `"${name}" isn't registered in the Wraith Names registry. Try: double-check the spelling, or ` +
      `confirm it has actually been registered on the network you're querying. See ${this.docsLink}.`
    );
  }
}

export class NameAlreadyRegisteredError extends WraithContractError {
  readonly code = 'WRAITH/CONTRACT/NAME_ALREADY_REGISTERED';

  constructor(name: string, owner?: string) {
    super(`Name is already registered: "${name}"${owner ? ` (owner: ${owner})` : ''}`, {
      name,
      owner,
    });
  }

  describe(): string {
    const { name, owner } = this.context ?? {};
    return (
      `"${name}" is already taken${owner ? ` (owned by ${owner})` : ''}. Try: pick a different name, ` +
      `or if you believe you own it, verify you're signing with the correct account. ` +
      `See ${this.docsLink}.`
    );
  }
}

export class InsufficientAuthError extends WraithContractError {
  readonly code = 'WRAITH/CONTRACT/INSUFFICIENT_AUTH';

  constructor(required?: string, actual?: string) {
    super(
      `Insufficient authority to perform operation${
        required && actual ? `. Required: ${required}, actual: ${actual}` : ''
      }`,
      { required, actual },
    );
  }

  describe(): string {
    const { required, actual } = this.context ?? {};
    const detail = required && actual ? ` Required "${required}", but got "${actual}".` : '';
    return (
      `You don't have permission to perform this operation.${detail} Try: sign with the account ` +
      `that owns this resource, or request the correct role/authorization. See ${this.docsLink}.`
    );
  }
}

export class ContractRevertError extends WraithContractError {
  readonly code = 'WRAITH/CONTRACT/CONTRACT_REVERT';
  readonly reason: string;

  constructor(reason: string, txHash?: string) {
    super(`Smart contract transaction reverted: ${reason}${txHash ? ` (txHash: ${txHash})` : ''}`, {
      reason,
      txHash,
    });
    this.reason = reason;
  }

  describe(): string {
    const { reason, txHash } = this.context ?? {};
    return (
      `Transaction reverted on-chain: ${reason}${txHash ? ` (tx: ${txHash})` : ''}. Try: decode the ` +
      `revert reason with decodeSorobanError() for a contract-specific explanation, or inspect the ` +
      `transaction in an explorer. See ${this.docsLink}.`
    );
  }
}

// WraithBuilderError Subclasses
export class InsufficientBalanceError extends WraithBuilderError {
  readonly code = 'WRAITH/BUILDER/INSUFFICIENT_BALANCE';

  constructor(required: string | bigint, actual: string | bigint, asset?: string) {
    super(
      `Insufficient balance to build transaction${asset ? ` for ${asset}` : ''}. Required: ${required.toString()}, actual: ${actual.toString()}`,
      { required: required.toString(), actual: actual.toString(), asset },
    );
  }

  describe(): string {
    const { required, actual, asset } = this.context ?? {};
    return (
      `Not enough balance${asset ? ` of ${asset}` : ''} to build this transaction — need ${required}, ` +
      `have ${actual}. Try: fund the account, reduce the amount, or account for network fees ` +
      `separately from the transfer amount. See ${this.docsLink}.`
    );
  }
}

export class UnsupportedAssetError extends WraithBuilderError {
  readonly code = 'WRAITH/BUILDER/UNSUPPORTED_ASSET';

  constructor(asset: string, chain?: string) {
    super(`Asset "${asset}" is not supported${chain ? ` on chain ${chain}` : ''}`, {
      asset,
      chain,
    });
  }

  describe(): string {
    const { asset, chain } = this.context ?? {};
    return (
      `"${asset}" isn't supported${chain ? ` on ${chain}` : ''} by this SDK build. Try: check the ` +
      `supported asset list for this chain, or register the asset if the SDK exposes a way to. ` +
      `See ${this.docsLink}.`
    );
  }
}
