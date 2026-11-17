'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  TRANSACTION_BUILDER_SCHEMA_VERSION,
  transactionBuilderVectors,
} = require('./transaction-builders.cjs');

const stellarVectors = JSON.parse(readFileSync(join(__dirname, 'vectors', 'stellar.json'), 'utf8'));
const checksums = JSON.parse(readFileSync(join(__dirname, 'checksum.json'), 'utf8'));

module.exports = {
  STELLAR_VECTOR_SCHEMA_VERSION: stellarVectors.version,
  TRANSACTION_BUILDER_SCHEMA_VERSION,
  stellarVectors,
  transactionBuilderVectors,
  checksums,
};
