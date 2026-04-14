export const ANNOUNCER_ABI = [
  {
    type: 'function',
    name: 'announce',
    inputs: [
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthAddress', type: 'address' },
      { name: 'ephemeralPubKey', type: 'bytes' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const SENDER_ABI = [
  {
    type: 'function',
    name: 'sendETH',
    inputs: [
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthAddress', type: 'address' },
      { name: 'ephemeralPubKey', type: 'bytes' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'sendERC20',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthAddress', type: 'address' },
      { name: 'ephemeralPubKey', type: 'bytes' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const;

export const NAMES_ABI = [
  {
    type: 'function',
    name: 'register',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'stealthMetaAddress', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerOnBehalf',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'stealthMetaAddress', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'update',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'newMetaAddress', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'release',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'resolve',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
  },
] as const;

export const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerKeys',
    inputs: [
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthMetaAddress', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;
