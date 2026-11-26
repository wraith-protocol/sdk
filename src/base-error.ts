import { redact, redactText } from './redaction';

const DOCS_BASE_URL = 'https://docs.wraith.dev/sdk/errors';

export abstract class WraithError extends Error {
  abstract readonly code: string;
  readonly docsLink: string;

  constructor(
    message: string,
    public readonly context?: Record<string, any>,
  ) {
    super(redactText(message));

    // Set prototype explicitly for correct instanceof behavior in ES5/older environments
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = this.constructor.name;

    const anchor = this.constructor.name
      .replace(/Error$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase();
    this.docsLink = `${DOCS_BASE_URL}#${anchor}`;

    // Overwrite the message to include the docs link
    this.message = `${redactText(message)} (See ${this.docsLink})`;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      docsLink: this.docsLink,
      context: redact(this.context),
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

export abstract class WraithRuntimeError extends WraithError {}

/** Details describing an unavailable runtime capability or optional peer. */
export interface UnsupportedCapabilityDetails {
  /** Missing capability or optional peer identifier (e.g. `'window'`, `'indexedDB'`, `'@solana/web3.js'`). */
  capability: string;
  /** Actionable remediation step for the caller. */
  remedy: string;
  /** Optional runtime identifier where the check failed. */
  runtime?: string;
  /** Underlying dynamic import or platform error, if any. */
  cause?: unknown;
}

/**
 * Thrown when an SDK helper requires a browser API, Web Crypto capability, or
 * optional peer dependency that is unavailable in the executing runtime.
 */
export class UnsupportedCapabilityError extends WraithRuntimeError {
  readonly code = 'WRAITH/RUNTIME/UNSUPPORTED_CAPABILITY';
  readonly capability: string;
  readonly remedy: string;

  constructor(message: string, details: UnsupportedCapabilityDetails) {
    const { capability, remedy, runtime, cause } = details;
    super(message, { capability, remedy, ...(runtime ? { runtime } : {}) });
    this.capability = capability;
    this.remedy = remedy;
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: cause,
        writable: true,
        configurable: true,
      });
    }
  }

  describe(): string {
    return `${this.capability} is not available in this runtime. Try: ${this.remedy} See ${this.docsLink}.`;
  }
}
