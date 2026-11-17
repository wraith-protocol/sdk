import { readFileSync } from 'node:fs';
import {
  TRANSACTION_BUILDER_SCHEMA_VERSION,
  transactionBuilderVectors,
} from './transaction-builders.js';

export const stellarVectors = JSON.parse(
  readFileSync(new URL('./vectors/stellar.json', import.meta.url), 'utf8'),
);
export const checksums = JSON.parse(
  readFileSync(new URL('./checksum.json', import.meta.url), 'utf8'),
);

export const STELLAR_VECTOR_SCHEMA_VERSION = stellarVectors.version;
export { TRANSACTION_BUILDER_SCHEMA_VERSION, transactionBuilderVectors };
