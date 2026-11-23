'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const raw = JSON.parse(
  readFileSync(join(__dirname, 'vectors', 'transaction-builders.json'), 'utf8'),
);

module.exports = {
  TRANSACTION_BUILDER_SCHEMA_VERSION: raw.schemaVersion,
  transactionBuilderVectors: raw,
  default: raw,
};
