import { describe, test, expect, beforeEach } from 'vitest';
import {
  decodeSorobanError,
  registerErrorRegistry,
  type DecodedSorobanError,
  type ErrorRegistry,
} from '../../../src/chains/stellar/errors';

describe('decodeSorobanError', () => {
  // -----------------------------------------------------------------------
  // Built-in: Stealth Registry
  // -----------------------------------------------------------------------
  describe('stealth-registry', () => {
    test('decodes InvalidMetaAddressLength (code 1)', () => {
      const result = decodeSorobanError(1, 'registry');
      expect(result.code).toBe(1);
      expect(result.name).toBe('InvalidMetaAddressLength');
      expect(result.description).toBeTruthy();
      expect(result.suggestedFix).toBeTruthy();
      expect(result.isKnown).toBe(true);
      expect(result.contractId).toBe('registry');
    });

    test('decodes NotRegistered (code 2)', () => {
      const result = decodeSorobanError(2, 'registry');
      expect(result.code).toBe(2);
      expect(result.name).toBe('NotRegistered');
      expect(result.description).toBeTruthy();
      expect(result.suggestedFix).toBeTruthy();
      expect(result.isKnown).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Built-in: Stealth Sender
  // -----------------------------------------------------------------------
  describe('stealth-sender', () => {
    test('decodes AlreadyInitialized (code 1)', () => {
      const result = decodeSorobanError(1, 'sender');
      expect(result.code).toBe(1);
      expect(result.name).toBe('AlreadyInitialized');
      expect(result.isKnown).toBe(true);
    });

    test('decodes NotInitialized (code 2)', () => {
      const result = decodeSorobanError(2, 'sender');
      expect(result.code).toBe(2);
      expect(result.name).toBe('NotInitialized');
      expect(result.isKnown).toBe(true);
    });

    test('decodes LengthMismatch (code 3)', () => {
      const result = decodeSorobanError(3, 'sender');
      expect(result.code).toBe(3);
      expect(result.name).toBe('LengthMismatch');
      expect(result.isKnown).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Built-in: Wraith Names
  // -----------------------------------------------------------------------
  describe('wraith-names', () => {
    test('decodes NameTaken (code 1)', () => {
      const result = decodeSorobanError(1, 'names');
      expect(result.code).toBe(1);
      expect(result.name).toBe('NameTaken');
      expect(result.isKnown).toBe(true);
    });

    test('decodes NameTooShort (code 2)', () => {
      const result = decodeSorobanError(2, 'names');
      expect(result.code).toBe(2);
      expect(result.name).toBe('NameTooShort');
      expect(result.isKnown).toBe(true);
    });

    test('decodes NameTooLong (code 3)', () => {
      const result = decodeSorobanError(3, 'names');
      expect(result.code).toBe(3);
      expect(result.name).toBe('NameTooLong');
      expect(result.isKnown).toBe(true);
    });

    test('decodes InvalidNameCharacter (code 4)', () => {
      const result = decodeSorobanError(4, 'names');
      expect(result.code).toBe(4);
      expect(result.name).toBe('InvalidNameCharacter');
      expect(result.isKnown).toBe(true);
    });

    test('decodes InvalidMetaAddress (code 5)', () => {
      const result = decodeSorobanError(5, 'names');
      expect(result.code).toBe(5);
      expect(result.name).toBe('InvalidMetaAddress');
      expect(result.isKnown).toBe(true);
    });

    test('decodes NameNotFound (code 6)', () => {
      const result = decodeSorobanError(6, 'names');
      expect(result.code).toBe(6);
      expect(result.name).toBe('NameNotFound');
      expect(result.isKnown).toBe(true);
    });

    test('decodes NotOwner (code 7)', () => {
      const result = decodeSorobanError(7, 'names');
      expect(result.code).toBe(7);
      expect(result.name).toBe('NotOwner');
      expect(result.isKnown).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Built-in: Stealth Announcer (no custom errors)
  // -----------------------------------------------------------------------
  describe('stealth-announcer', () => {
    test('announcer registry exists but has no errors', () => {
      const result = decodeSorobanError(1, 'announcer');
      expect(result.isKnown).toBe(false);
      expect(result.name).toBe('UnknownError');
      expect(result.contractId).toBe('announcer');
    });
  });

  // -----------------------------------------------------------------------
  // Cross-registry search (no contractId)
  // -----------------------------------------------------------------------
  describe('without contractId (cross-registry search)', () => {
    test('finds error across all registries', () => {
      // Code 6 is NameNotFound in the wraith-names registry
      const result = decodeSorobanError(6);
      expect(result.isKnown).toBe(true);
      expect(result.name).toBe('NameNotFound');
      expect(result.contractId).toBe('names');
    });

    test('finds code 1 - first registry match', () => {
      const result = decodeSorobanError(1);
      expect(result.isKnown).toBe(true);
      // Code 1 exists in both registry (InvalidMetaAddressLength) and names (NameTaken)
      // and sender (AlreadyInitialized). Should find one of them.
      expect(['InvalidMetaAddressLength', 'NameTaken', 'AlreadyInitialized']).toContain(
        result.name,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Unknown contract / error codes
  // -----------------------------------------------------------------------
  describe('unknown errors', () => {
    test('returns fallback for unknown contractId', () => {
      const result = decodeSorobanError(1, 'nonexistent-contract');
      expect(result.isKnown).toBe(false);
      expect(result.name).toBe('UnknownError');
      expect(result.contractId).toBe('nonexistent-contract');
      expect(result.suggestedFix).toBeTruthy();
    });

    test('returns fallback for unknown error code with known contract', () => {
      // wraith-names only has codes 1-7
      const result = decodeSorobanError(99, 'names');
      expect(result.isKnown).toBe(false);
      expect(result.name).toBe('UnknownError');
      expect(result.contractId).toBe('names');
      expect(result.suggestedFix).toBeTruthy();
    });

    test('returns fallback for unknown error code without contractId', () => {
      const result = decodeSorobanError(9999);
      expect(result.isKnown).toBe(false);
      expect(result.name).toBe('UnknownError');
      expect(result.contractId).toBeNull();
      expect(result.description).toContain('9999');
    });
  });

  // -----------------------------------------------------------------------
  // All built-in error codes are unique per contract
  // -----------------------------------------------------------------------
  describe('error data integrity', () => {
    test('all built-in errors have required fields', () => {
      const contractIds = ['registry', 'sender', 'names'];

      for (const contractId of contractIds) {
        // Test a few known codes for each contract
        if (contractId === 'registry') {
          for (const code of [1, 2]) {
            const result = decodeSorobanError(code, contractId);
            expect(result.isKnown).toBe(true);
            expect(result.name).toBeTruthy();
            expect(result.description).toBeTruthy();
            expect(result.code).toBe(code);
          }
        }
        if (contractId === 'sender') {
          for (const code of [1, 2, 3]) {
            const result = decodeSorobanError(code, contractId);
            expect(result.isKnown).toBe(true);
            expect(result.name).toBeTruthy();
            expect(result.description).toBeTruthy();
          }
        }
        if (contractId === 'names') {
          for (const code of [1, 2, 3, 4, 5, 6, 7]) {
            const result = decodeSorobanError(code, contractId);
            expect(result.isKnown).toBe(true);
            expect(result.name).toBeTruthy();
            expect(result.description).toBeTruthy();
          }
        }
      }
    });
  });
});

describe('registerErrorRegistry', () => {
  // Reset registries before each test by re-testing known behavior
  // Since we can't easily reset, we test that registration works by using
  // a unique contract ID that won't conflict with built-in ones

  test('registers and decodes custom errors', () => {
    const customRegistry: ErrorRegistry = {
      contractId: 'my-custom-contract',
      contractName: 'My Custom Contract',
      errors: [
        {
          code: 1,
          name: 'Unauthorized',
          description: 'Caller is not authorized.',
          suggestedFix: 'Use the authorized account.',
        },
        {
          code: 2,
          name: 'InsufficientBalance',
          description: 'Not enough balance to complete the operation.',
        },
      ],
    };

    registerErrorRegistry(customRegistry);

    const decoded = decodeSorobanError(1, 'my-custom-contract');
    expect(decoded.isKnown).toBe(true);
    expect(decoded.name).toBe('Unauthorized');
    expect(decoded.description).toBe('Caller is not authorized.');
    expect(decoded.suggestedFix).toBe('Use the authorized account.');
    expect(decoded.contractId).toBe('my-custom-contract');

    const decoded2 = decodeSorobanError(2, 'my-custom-contract');
    expect(decoded2.isKnown).toBe(true);
    expect(decoded2.name).toBe('InsufficientBalance');
    // suggestedFix was not provided, should be null
    expect(decoded2.suggestedFix).toBeNull();
  });

  test('custom registry is searchable without contractId', () => {
    const decoded = decodeSorobanError(2);
    // Should find InsufficientBalance from the custom registry
    // (may find other codes too, but at least code 2 shouldn't be UnknownError)
    expect(decoded.isKnown).toBe(true);
  });

  test('multiple contractId aliases for same errors', () => {
    registerErrorRegistry({
      contractId: 'alias-contract',
      contractName: 'Alias Contract',
      errors: [
        {
          code: 100,
          name: 'CustomError',
          description: 'A custom error.',
        },
      ],
    });

    const decoded = decodeSorobanError(100, 'alias-contract');
    expect(decoded.isKnown).toBe(true);
    expect(decoded.name).toBe('CustomError');
  });
});

describe('deployed contract ID resolution', () => {
  test('decodes errors by deployed Soroban contract ID for names', () => {
    // The known testnet names contract ID
    const namesContractId = 'CDEMB3MAE62ZOCCKZPTYSXR5CS5WVENPOU5MDVK4PNKTZXFVDC74AFBV';
    const result = decodeSorobanError(6, namesContractId);
    expect(result.isKnown).toBe(true);
    expect(result.name).toBe('NameNotFound');
  });

  test('decodes errors by deployed Soroban contract ID for announcer', () => {
    const announcerContractId = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
    const result = decodeSorobanError(1, announcerContractId);
    // Announcer has no custom errors, so it should be unknown
    expect(result.isKnown).toBe(false);
    expect(result.name).toBe('UnknownError');
  });
});
