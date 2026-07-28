/**
 * Fixture: pinned SEP-41 test contract IDs for Stellar futurenet.
 *
 * These IDs are used by `asset.test.ts` for integration-style tests.
 * The contract should implement the SEP-41 interface:
 *   - name() -> string
 *   - symbol() -> string
 *   - decimals() -> u32
 *   - balance(address) -> i128
 */

/** Futurenet SEP-41 test token contract (replace with actual deployed contract). */
export const FUTURENET_SEP41_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';

/** Test address on futurenet. */
export const FUTURENET_TEST_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
