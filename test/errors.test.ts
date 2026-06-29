import { describe, test, expect } from 'vitest';
import {
  WraithError,
  WraithInputError,
  WraithCryptoError,
  WraithNetworkError,
  WraithContractError,
  WraithBuilderError,
  InvalidMetaAddressError,
  InvalidNameError,
  InvalidSignatureError,
  InvalidScalarError,
  KeyDerivationFailedError,
  ViewTagMismatchError,
  ECDHFailedError,
  RPCRequestError,
  RPCRetryExhaustedError,
  RetentionExceededError,
  NameNotFoundError,
  NameAlreadyRegisteredError,
  InsufficientAuthError,
  ContractRevertError,
  InsufficientBalanceError,
  UnsupportedAssetError,
} from '../src/errors';

describe('Wraith Custom Errors Taxonomy', () => {
  // Test 1: Validate instanceof chain for WraithInputError and its subclasses
  test('InvalidMetaAddressError instanceof checks', () => {
    const error = new InvalidMetaAddressError('st:eth:0x123', 'bad length');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithInputError);
    expect(error).toBeInstanceOf(InvalidMetaAddressError);
    expect(error.code).toBe('WRAITH/INPUT/INVALID_META_ADDRESS');
    expect(error.name).toBe('InvalidMetaAddressError');
    expect(error.context).toEqual({ metaAddress: 'st:eth:0x123', reason: 'bad length' });
    expect(error.docsLink).toBe('https://docs.wraith.dev/sdk/errors#invalid-meta-address');
    expect(error.message).toContain('Invalid stealth meta-address format');
    expect(error.message).toContain(error.docsLink);
  });

  test('InvalidNameError instanceof checks', () => {
    const error = new InvalidNameError('alice.wraith', 'too short');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithInputError);
    expect(error).toBeInstanceOf(InvalidNameError);
    expect(error.code).toBe('WRAITH/INPUT/INVALID_NAME');
    expect(error.name).toBe('InvalidNameError');
    expect(error.context).toEqual({ name: 'alice.wraith', reason: 'too short' });
  });

  test('InvalidSignatureError instanceof checks', () => {
    const error = new InvalidSignatureError('0xabc', 65, 3);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithInputError);
    expect(error).toBeInstanceOf(InvalidSignatureError);
    expect(error.code).toBe('WRAITH/INPUT/INVALID_SIGNATURE');
    expect(error.name).toBe('InvalidSignatureError');
    expect(error.context).toEqual({ signature: '0xabc', expectedLength: 65, actualLength: 3 });
  });

  test('InvalidScalarError instanceof checks', () => {
    const error = new InvalidScalarError(0n, 'is zero');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithInputError);
    expect(error).toBeInstanceOf(InvalidScalarError);
    expect(error.code).toBe('WRAITH/INPUT/INVALID_SCALAR');
    expect(error.name).toBe('InvalidScalarError');
    expect(error.context).toEqual({ scalar: '0', reason: 'is zero' });
  });

  // Test 2: Validate instanceof chain for WraithCryptoError and its subclasses
  test('KeyDerivationFailedError instanceof checks', () => {
    const error = new KeyDerivationFailedError('invalid scalar addition');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithCryptoError);
    expect(error).toBeInstanceOf(KeyDerivationFailedError);
    expect(error.code).toBe('WRAITH/CRYPTO/KEY_DERIVATION_FAILED');
    expect(error.name).toBe('KeyDerivationFailedError');
    expect(error.context).toEqual({ reason: 'invalid scalar addition' });
  });

  test('ViewTagMismatchError instanceof checks', () => {
    const error = new ViewTagMismatchError(42, 24);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithCryptoError);
    expect(error).toBeInstanceOf(ViewTagMismatchError);
    expect(error.code).toBe('WRAITH/CRYPTO/VIEW_TAG_MISMATCH');
    expect(error.name).toBe('ViewTagMismatchError');
    expect(error.context).toEqual({ expectedTag: 42, actualTag: 24 });
  });

  test('ECDHFailedError instanceof checks', () => {
    const error = new ECDHFailedError('point off curve');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithCryptoError);
    expect(error).toBeInstanceOf(ECDHFailedError);
    expect(error.code).toBe('WRAITH/CRYPTO/ECDH_FAILED');
    expect(error.name).toBe('ECDHFailedError');
    expect(error.context).toEqual({ reason: 'point off curve' });
  });

  // Test 3: Validate instanceof chain for WraithNetworkError and its subclasses
  test('RPCRequestError instanceof checks', () => {
    const error = new RPCRequestError('https://horizon.stellar.org', 404, 'Not Found');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithNetworkError);
    expect(error).toBeInstanceOf(RPCRequestError);
    expect(error.code).toBe('WRAITH/NETWORK/RPC_REQUEST');
    expect(error.name).toBe('RPCRequestError');
    expect(error.statusCode).toBe(404);
    expect(error.context).toEqual({
      url: 'https://horizon.stellar.org',
      statusCode: 404,
      responseText: 'Not Found',
    });
  });

  test('RPCRetryExhaustedError instanceof checks', () => {
    const error = new RPCRetryExhaustedError('https://horizon.stellar.org', 5, 'timeout');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithNetworkError);
    expect(error).toBeInstanceOf(RPCRetryExhaustedError);
    expect(error.code).toBe('WRAITH/NETWORK/RPC_RETRY_EXHAUSTED');
    expect(error.name).toBe('RPCRetryExhaustedError');
    expect(error.context).toEqual({
      url: 'https://horizon.stellar.org',
      attempts: 5,
      lastError: 'timeout',
    });
  });

  test('RetentionExceededError instanceof checks', () => {
    const error = new RetentionExceededError(100, 105);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithNetworkError);
    expect(error).toBeInstanceOf(RetentionExceededError);
    expect(error.code).toBe('WRAITH/NETWORK/RETENTION_EXCEEDED');
    expect(error.name).toBe('RetentionExceededError');
    expect(error.context).toEqual({ limit: 100, actual: 105 });
  });

  // Test 4: Validate instanceof chain for WraithContractError and its subclasses
  test('NameNotFoundError instanceof checks', () => {
    const error = new NameNotFoundError('missing.wraith');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithContractError);
    expect(error).toBeInstanceOf(NameNotFoundError);
    expect(error.code).toBe('WRAITH/CONTRACT/NAME_NOT_FOUND');
    expect(error.name).toBe('NameNotFoundError');
    expect(error.context).toEqual({ name: 'missing.wraith' });
  });

  test('NameAlreadyRegisteredError instanceof checks', () => {
    const error = new NameAlreadyRegisteredError('taken.wraith', 'owner_address');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithContractError);
    expect(error).toBeInstanceOf(NameAlreadyRegisteredError);
    expect(error.code).toBe('WRAITH/CONTRACT/NAME_ALREADY_REGISTERED');
    expect(error.name).toBe('NameAlreadyRegisteredError');
    expect(error.context).toEqual({ name: 'taken.wraith', owner: 'owner_address' });
  });

  test('InsufficientAuthError instanceof checks', () => {
    const error = new InsufficientAuthError('admin', 'user');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithContractError);
    expect(error).toBeInstanceOf(InsufficientAuthError);
    expect(error.code).toBe('WRAITH/CONTRACT/INSUFFICIENT_AUTH');
    expect(error.name).toBe('InsufficientAuthError');
    expect(error.context).toEqual({ required: 'admin', actual: 'user' });
  });

  test('ContractRevertError instanceof checks', () => {
    const error = new ContractRevertError('execution reverted: out of gas', '0x111');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithContractError);
    expect(error).toBeInstanceOf(ContractRevertError);
    expect(error.code).toBe('WRAITH/CONTRACT/CONTRACT_REVERT');
    expect(error.name).toBe('ContractRevertError');
    expect(error.reason).toBe('execution reverted: out of gas');
    expect(error.context).toEqual({ reason: 'execution reverted: out of gas', txHash: '0x111' });
  });

  // Test 5: Validate instanceof chain for WraithBuilderError and its subclasses
  test('InsufficientBalanceError instanceof checks', () => {
    const error = new InsufficientBalanceError(100n, 50n, 'XLM');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithBuilderError);
    expect(error).toBeInstanceOf(InsufficientBalanceError);
    expect(error.code).toBe('WRAITH/BUILDER/INSUFFICIENT_BALANCE');
    expect(error.name).toBe('InsufficientBalanceError');
    expect(error.context).toEqual({ required: '100', actual: '50', asset: 'XLM' });
  });

  test('UnsupportedAssetError instanceof checks', () => {
    const error = new UnsupportedAssetError('SOL', 'horizen');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(WraithError);
    expect(error).toBeInstanceOf(WraithBuilderError);
    expect(error).toBeInstanceOf(UnsupportedAssetError);
    expect(error.code).toBe('WRAITH/BUILDER/UNSUPPORTED_ASSET');
    expect(error.name).toBe('UnsupportedAssetError');
    expect(error.context).toEqual({ asset: 'SOL', chain: 'horizen' });
  });

  // Test 6: Validate JSON serialization and code preservation
  test('JSON serialization preserves code, context, name, and docsLink', () => {
    const error = new InsufficientBalanceError(500n, 100n, 'ETH');
    const jsonStr = JSON.stringify(error);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.name).toBe('InsufficientBalanceError');
    expect(parsed.code).toBe('WRAITH/BUILDER/INSUFFICIENT_BALANCE');
    expect(parsed.docsLink).toBe('https://docs.wraith.dev/sdk/errors#insufficient-balance');
    expect(parsed.message).toContain('Insufficient balance to build transaction for ETH');
    expect(parsed.message).toContain(parsed.docsLink);
    expect(parsed.context).toEqual({ required: '500', actual: '100', asset: 'ETH' });
  });
});
