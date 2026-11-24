import { readFileSync } from 'node:fs';

const raw = JSON.parse(
  readFileSync(new URL('./vectors/transaction-builders.json', import.meta.url), 'utf8'),
);

export const TRANSACTION_BUILDER_SCHEMA_VERSION = raw.schemaVersion;
export const transactionBuilderVectors = raw;
export default raw;
