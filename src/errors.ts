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
}

export class InvalidNameError extends WraithInputError {
  readonly code = 'WRAITH/INPUT/INVALID_NAME';

  constructor(name: string, reason?: string) {
    super(`Invalid name: "${name}"${reason ? `. ${reason}` : ''}`, { name, reason });
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
}

export class InvalidScalarError extends WraithInputError {
  readonly code = 'WRAITH/INPUT/INVALID_SCALAR';

  constructor(scalar: string | bigint, reason?: string) {
    super(`Invalid cryptographic scalar: "${scalar.toString()}"${reason ? `. ${reason}` : ''}`, {
      scalar: scalar.toString(),
      reason,
    });
  }
}

// WraithCryptoError Subclasses
export class KeyDerivationFailedError extends WraithCryptoError {
  readonly code = 'WRAITH/CRYPTO/KEY_DERIVATION_FAILED';

  constructor(reason: string) {
    super(`Key derivation failed: ${reason}`, { reason });
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
}

export class ECDHFailedError extends WraithCryptoError {
  readonly code = 'WRAITH/CRYPTO/ECDH_FAILED';

  constructor(reason: string) {
    super(`Elliptic Curve Diffie-Hellman (ECDH) operation failed: ${reason}`, { reason });
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
}

export class RetentionExceededError extends WraithNetworkError {
  readonly code = 'WRAITH/NETWORK/RETENTION_EXCEEDED';

  constructor(limit: number, actual: number) {
    super(`Retention limit exceeded. Max allowed is ${limit}, actual is ${actual}`, {
      limit,
      actual,
    });
  }
}

// WraithContractError Subclasses
export class NameNotFoundError extends WraithContractError {
  readonly code = 'WRAITH/CONTRACT/NAME_NOT_FOUND';

  constructor(name: string) {
    super(`Name not found: "${name}"`, { name });
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
}

export class UnsupportedAssetError extends WraithBuilderError {
  readonly code = 'WRAITH/BUILDER/UNSUPPORTED_ASSET';

  constructor(asset: string, chain?: string) {
    super(`Asset "${asset}" is not supported${chain ? ` on chain ${chain}` : ''}`, {
      asset,
      chain,
    });
  }
}
