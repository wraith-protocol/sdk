import { DEPLOYMENTS } from './deployments';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Definition of a single Soroban contract error.
 */
export interface SorobanContractError {
  /** Numeric error code returned by the contract. */
  code: number;
  /** Human-readable name of the error (e.g. `NameTaken`). */
  name: string;
  /** Human-readable description of what the error means. */
  description: string;
  /** Optional suggested fix for the end developer. */
  suggestedFix?: string;
}

/**
 * Result of decoding a Soroban contract error.
 */
export interface DecodedSorobanError {
  /** Numeric error code. */
  code: number;
  /** Human-readable error name. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Suggested fix, if available. */
  suggestedFix: string | null;
  /** Contract identifier that was used for the lookup. */
  contractId: string | null;
  /** Whether the error was found in a known registry. */
  isKnown: boolean;
}

/**
 * A registry that maps a contract to its set of known error codes.
 *
 * Register custom registries with {@link registerErrorRegistry} so that
 * {@link decodeSorobanError} can decode errors from non-Wraith contracts.
 */
export interface ErrorRegistry {
  /**
   * Contract identifier — this can be the Soroban contract ID
   * (e.g. `CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL`)
   * or a human-readable alias such as `names`.
   */
  contractId: string;
  /** Human-readable contract name for display purposes. */
  contractName: string;
  /** Known error definitions for this contract. */
  errors: SorobanContractError[];
}

// ---------------------------------------------------------------------------
// Registry storage
// ---------------------------------------------------------------------------

const _registries = new Map<string, ErrorRegistry>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a custom error registry so that {@link decodeSorobanError} can
 * decode errors from the given contract.
 *
 * Multiple identifiers can be registered for the same contract by calling
 * `registerErrorRegistry` more than once with the same error definitions
 * under different `contractId` values (e.g., a Soroban contract ID and a
 * human-readable alias).
 *
 * @param registry - The error registry to register.
 *
 * @example
 * ```ts
 * import { registerErrorRegistry, decodeSorobanError } from "@wraith-protocol/sdk/chains/stellar";
 *
 * registerErrorRegistry({
 *   contractId: 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL',
 *   contractName: 'My Custom Contract',
 *   errors: [
 *     { code: 1, name: 'Unauthorized', description: 'Caller is not authorized.' },
 *   ],
 * });
 * ```
 */
export function registerErrorRegistry(registry: ErrorRegistry): void {
  _registries.set(registry.contractId, registry);
}

/**
 * Decode a Soroban contract error code into a human-readable result.
 *
 * When `contractId` is provided, the decoder first looks up the registry for
 * that specific contract. If a match is found, the decoded error is returned.
 * If the contract is known but the error code is not in its registry, the
 * returned result will have `isKnown: false` and a descriptive message.
 *
 * When `contractId` is omitted, the decoder searches all registered registries
 * for the error code. If no registry has the error code, a generic fallback
 * with `isKnown: false` is returned.
 *
 * @param errorCode - The numeric error code from the Soroban contract.
 * @param contractId - Optional contract identifier (Soroban contract ID or
 *                     registered alias) to scope the lookup.
 * @returns The decoded error with human-readable fields.
 *
 * @example
 * ```ts
 * import { decodeSorobanError } from "@wraith-protocol/sdk/chains/stellar";
 *
 * // With contract ID
 * const result = decodeSorobanError(1, 'names');
 * // { code: 1, name: 'NameTaken', description: '...', isKnown: true }
 *
 * // Without contract ID (search all registries)
 * const result = decodeSorobanError(6);
 * // { code: 6, name: 'NameNotFound', description: '...', isKnown: true }
 *
 * // Unknown error code
 * const result = decodeSorobanError(99);
 * // { code: 99, name: 'UnknownError', description: '...', isKnown: false }
 * ```
 */
export function decodeSorobanError(errorCode: number, contractId?: string): DecodedSorobanError {
  // When contractId is provided, scope the lookup to that contract's registry
  if (contractId !== undefined) {
    const registry = _registries.get(contractId);
    if (registry) {
      const errorDef = registry.errors.find((e) => e.code === errorCode);
      if (errorDef) {
        return {
          code: errorDef.code,
          name: errorDef.name,
          description: errorDef.description,
          suggestedFix: errorDef.suggestedFix ?? null,
          contractId: registry.contractId,
          isKnown: true,
        };
      }
      // Contract is registered but this error code is not in its registry
      return {
        code: errorCode,
        name: 'UnknownError',
        description: `Unknown error code ${errorCode} for contract "${registry.contractName}" (${registry.contractId}).`,
        suggestedFix:
          'Check the contract source code or open an issue on the Wraith Protocol repository.',
        contractId: registry.contractId,
        isKnown: false,
      };
    }
    // Unknown contractId — return fallback
    return {
      code: errorCode,
      name: 'UnknownError',
      description: `No error registry found for contract "${contractId}".`,
      suggestedFix:
        'Ensure the contract ID is correct. You can register custom registries with registerErrorRegistry().',
      contractId,
      isKnown: false,
    };
  }

  // No contractId — search all registries for the error code
  for (const [, registry] of _registries) {
    const errorDef = registry.errors.find((e) => e.code === errorCode);
    if (errorDef) {
      return {
        code: errorDef.code,
        name: errorDef.name,
        description: errorDef.description,
        suggestedFix: errorDef.suggestedFix ?? null,
        contractId: registry.contractId,
        isKnown: true,
      };
    }
  }

  // Fallback: unknown error in any registry
  return {
    code: errorCode,
    name: 'UnknownError',
    description: `Unrecognized Soroban contract error code ${errorCode}.`,
    suggestedFix: null,
    contractId: null,
    isKnown: false,
  };
}

// ---------------------------------------------------------------------------
// Built-in error definitions
// ---------------------------------------------------------------------------

const STEALTH_REGISTRY_ERRORS: SorobanContractError[] = [
  {
    code: 1,
    name: 'InvalidMetaAddressLength',
    description:
      'The provided stealth meta-address has an invalid length. Expected a properly encoded 64-byte (128 hex chars) payload.',
    suggestedFix:
      'Ensure the meta-address is properly encoded using encodeStealthMetaAddress() and is valid for the Stellar network.',
  },
  {
    code: 2,
    name: 'NotRegistered',
    description:
      'The specified account does not have a registered stealth meta-address in the registry.',
    suggestedFix: 'Register a stealth meta-address first using the registry contract.',
  },
];

const SENDER_ERRORS: SorobanContractError[] = [
  {
    code: 1,
    name: 'AlreadyInitialized',
    description: 'The sender contract has already been initialized.',
    suggestedFix: 'Do not attempt to re-initialize the sender contract.',
  },
  {
    code: 2,
    name: 'NotInitialized',
    description: 'The sender contract has not yet been initialized.',
    suggestedFix: 'Initialize the contract before using it.',
  },
  {
    code: 3,
    name: 'LengthMismatch',
    description: 'Array length mismatch in contract parameters.',
    suggestedFix: 'Ensure all arrays provided to the contract have matching lengths.',
  },
];

const NAMES_ERRORS: SorobanContractError[] = [
  {
    code: 1,
    name: 'NameTaken',
    description: 'The requested name is already registered to another account.',
    suggestedFix: 'Choose a different name that is not yet registered.',
  },
  {
    code: 2,
    name: 'NameTooShort',
    description: 'The name is shorter than the minimum allowed length.',
    suggestedFix: 'Use a name that meets the minimum length requirement.',
  },
  {
    code: 3,
    name: 'NameTooLong',
    description: 'The name exceeds the maximum allowed length.',
    suggestedFix: 'Use a shorter name that fits within the limit.',
  },
  {
    code: 4,
    name: 'InvalidNameCharacter',
    description: 'The name contains characters that are not allowed.',
    suggestedFix: 'Use only alphanumeric characters and other allowed special characters.',
  },
  {
    code: 5,
    name: 'InvalidMetaAddress',
    description: 'The provided stealth meta-address is not valid for registration.',
    suggestedFix:
      'Provide a valid stealth meta-address encoded for the Stellar network using encodeStealthMetaAddress().',
  },
  {
    code: 6,
    name: 'NameNotFound',
    description: 'The specified name was not found in the Wraith Names registry.',
    suggestedFix: 'Check that the name has been registered.',
  },
  {
    code: 7,
    name: 'NotOwner',
    description:
      'The caller is not the owner of the name and is not authorized to perform this operation.',
    suggestedFix: 'Use the owner account to perform this operation.',
  },
];

// ---------------------------------------------------------------------------
// Built-in registry registration
// ---------------------------------------------------------------------------

/** @internal */
function registerBuiltinRegistries(): void {
  // stealth-announcer: no custom errors (stateless event emitter)
  registerErrorRegistry({
    contractId: 'announcer',
    contractName: 'Stealth Announcer',
    errors: [],
  });

  // stealth-registry
  registerErrorRegistry({
    contractId: 'registry',
    contractName: 'Stealth Registry',
    errors: STEALTH_REGISTRY_ERRORS,
  });

  // stealth-sender
  registerErrorRegistry({
    contractId: 'sender',
    contractName: 'Stealth Sender',
    errors: SENDER_ERRORS,
  });

  // wraith-names
  registerErrorRegistry({
    contractId: 'names',
    contractName: 'Wraith Names',
    errors: NAMES_ERRORS,
  });

  // Register by known deployed Soroban contract IDs for direct lookup
  for (const [, deployment] of Object.entries(DEPLOYMENTS)) {
    if (deployment.contracts.announcer) {
      registerErrorRegistry({
        contractId: deployment.contracts.announcer,
        contractName: 'Stealth Announcer',
        errors: [],
      });
    }
    if (deployment.contracts.names) {
      registerErrorRegistry({
        contractId: deployment.contracts.names,
        contractName: 'Wraith Names',
        errors: NAMES_ERRORS,
      });
    }
  }
}

// Register built-in registries at module load time
registerBuiltinRegistries();
