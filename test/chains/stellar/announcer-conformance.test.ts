/**
 * Builder-to-contract conformance for the Stellar announcer.
 *
 * Every announcement the SDK builds must be a valid call of the deployed v2 announcer, as described
 * by the vendored fixture in `fixtures/stealth-announcer-v2.json` (the contract ABI plus the
 * scheme id and metadata rules that `announce()` enforces).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Address, Asset, Keypair, Networks, Operation, xdr } from '@stellar/stellar-sdk';
import { ACTIVE_SCHEME_ID, SCHEME_ID_V2 } from '../../../src/chains/stellar/constants';
import { buildStealthAnnouncement } from '../../../src/chains/stellar/builders';
import { buildPathStealthPayment } from '../../../src/chains/stellar/path-payment';
import { buildStellarSwapAndStealth } from '../../../src/chains/stellar/swap';
import { buildAnnouncementData } from '../../../src/chains/stellar/tx-builder';
import { decodeAnnouncementData, encodeAnnouncementData } from '../../../src/chains/stellar/batch';
import { deriveStealthKeys } from '../../../src/chains/stellar/keys';
import { encodeStealthMetaAddress } from '../../../src/chains/stellar/meta-address';
import { generateStealthAddress } from '../../../src/chains/stellar/stealth';

interface AbiInput {
  name: string;
  type_: unknown;
}

interface AnnouncerFixture {
  schemeId: number;
  metadata: { minLength: number; viewTagIndex: number };
  abi: Array<{ function_v0?: { name: string; inputs: AbiInput[] } }>;
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/stealth-announcer-v2.json', import.meta.url), 'utf8'),
) as AnnouncerFixture;

const announceSpec = fixture.abi.find(
  (entry) => entry.function_v0?.name === 'announce',
)?.function_v0;

const ANNOUNCER = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const NETWORK = Networks.TESTNET;
const USDC = new Asset('USDC', Keypair.random().publicKey());

const recipientKeys = deriveStealthKeys(new Uint8Array(64).fill(0xab));
const recipientMeta = encodeStealthMetaAddress(
  recipientKeys.spendingPubKey,
  recipientKeys.viewingPubKey,
);

const base = {
  sender: Keypair.random().publicKey(),
  sequence: '100',
  announcerContract: ANNOUNCER,
  networkPassphrase: NETWORK,
  recipientMeta,
  _ephemeralSeed: new Uint8Array(32).fill(0xee),
};

/** Whether `value` has the Soroban type the ABI declares for an argument. */
function matchesAbiType(type: unknown, value: xdr.ScVal): boolean {
  switch (type) {
    case 'u32':
      return value.switch() === xdr.ScValType.scvU32();
    case 'address':
      return value.switch() === xdr.ScValType.scvAddress();
    case 'bytes':
      return value.switch() === xdr.ScValType.scvBytes();
  }
  if (typeof type === 'object' && type !== null && 'bytes_n' in type) {
    const { n } = (type as { bytes_n: { n: number } }).bytes_n;
    return value.switch() === xdr.ScValType.scvBytes() && value.bytes().length === n;
  }
  throw new Error(`The conformance test does not handle ABI type ${JSON.stringify(type)}`);
}

/** Decodes the contract call of an invokeHostFunction operation. */
function decodeCall(op: Operation) {
  expect(op.type).toBe('invokeHostFunction');
  const call = (op as Operation.InvokeHostFunction).func.invokeContract();
  return {
    contract: Address.fromScAddress(call.contractAddress()).toString(),
    functionName: call.functionName().toString(),
    args: call.args(),
  };
}

interface StealthFields {
  stealthAddress: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
}

const builders: Array<{ name: string; build: () => { op: Operation; stealth: StealthFields } }> = [
  {
    name: 'buildStealthAnnouncement',
    build: () => {
      const stealth = generateStealthAddress(
        recipientKeys.spendingPubKey,
        recipientKeys.viewingPubKey,
        base._ephemeralSeed,
      );
      const tx = buildStealthAnnouncement({
        sender: base.sender,
        sequence: base.sequence,
        stealthResult: stealth,
        announcerContract: ANNOUNCER,
        networkPassphrase: NETWORK,
      });
      return { op: tx.operations[0], stealth };
    },
  },
  {
    name: 'buildPathStealthPayment',
    build: () => {
      const { transaction, stealthResult } = buildPathStealthPayment({
        ...base,
        sendAsset: USDC,
        receiveAsset: Asset.native(),
        destAmount: '100',
        sendMax: '50.025',
      });
      return {
        op: transaction.operations[transaction.operations.length - 1],
        stealth: stealthResult,
      };
    },
  },
  {
    name: 'buildStellarSwapAndStealth',
    build: () => {
      const { transaction, stealthResult } = buildStellarSwapAndStealth({
        ...base,
        fromAsset: USDC,
        toAsset: Asset.native(),
        destAmount: '100',
        sendMax: '50.025',
      });
      return {
        op: transaction.operations[transaction.operations.length - 1],
        stealth: stealthResult,
      };
    },
  },
];

describe('Stellar announcer conformance fixture', () => {
  it('describes announce() with the v2 scheme id', () => {
    expect(announceSpec).toBeDefined();
    expect(fixture.schemeId).toBe(SCHEME_ID_V2);
  });

  it('matches the scheme id the SDK emits', () => {
    expect(ACTIVE_SCHEME_ID).toBe(fixture.schemeId);
  });
});

describe.each(builders)('$name builds a valid announce() call', ({ build }) => {
  it('calls announce on the announcer contract with the ABI argument types', () => {
    const { op } = build();
    const { contract, functionName, args } = decodeCall(op);

    expect(contract).toBe(ANNOUNCER);
    expect(functionName).toBe(announceSpec!.name);
    expect(args).toHaveLength(announceSpec!.inputs.length);
    announceSpec!.inputs.forEach((input, index) => {
      expect(matchesAbiType(input.type_, args[index]), input.name).toBe(true);
    });
  });

  it('passes the scheme id, stealth address, ephemeral key and view tag the contract expects', () => {
    const { op, stealth } = build();
    const [schemeId, stealthAddress, ephemeralPubKey, metadata] = decodeCall(op).args;

    expect(schemeId.u32()).toBe(fixture.schemeId);
    expect(Address.fromScVal(stealthAddress).toString()).toBe(stealth.stealthAddress);
    expect(new Uint8Array(ephemeralPubKey.bytes())).toEqual(
      new Uint8Array(stealth.ephemeralPubKey),
    );

    const metadataBytes = new Uint8Array(metadata.bytes());
    expect(metadataBytes.length).toBeGreaterThanOrEqual(fixture.metadata.minLength);
    expect(metadataBytes[fixture.metadata.viewTagIndex]).toBe(stealth.viewTag);
  });
});

describe('announcement data helpers', () => {
  it('buildAnnouncementData emits the contract scheme id', () => {
    const stealth = generateStealthAddress(
      recipientKeys.spendingPubKey,
      recipientKeys.viewingPubKey,
      base._ephemeralSeed,
    );
    const [data] = buildAnnouncementData([stealth], base.sender);
    expect(data.schemeId).toBe(fixture.schemeId);
  });

  it('encodeAnnouncementData writes the contract scheme id into byte 0', () => {
    const encoded = encodeAnnouncementData(new Uint8Array(32).fill(7), 0x2a);
    expect(encoded[0]).toBe(fixture.schemeId);
    expect(decodeAnnouncementData(encoded).schemeId).toBe(fixture.schemeId);
  });
});
