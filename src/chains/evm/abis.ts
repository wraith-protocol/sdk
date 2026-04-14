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
  {
    type: 'event',
    name: 'Announcement',
    inputs: [
      { name: 'schemeId', type: 'uint256', indexed: true },
      { name: 'stealthAddress', type: 'address', indexed: true },
      { name: 'caller', type: 'address', indexed: true },
      { name: 'ephemeralPubKey', type: 'bytes', indexed: false },
      { name: 'metadata', type: 'bytes', indexed: false },
    ],
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
  {
    type: 'function',
    name: 'batchSendETH',
    inputs: [
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthAddresses', type: 'address[]' },
      { name: 'ephemeralPubKeys', type: 'bytes[]' },
      { name: 'metadatas', type: 'bytes[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'batchSendERC20',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'schemeId', type: 'uint256' },
      { name: 'stealthAddresses', type: 'address[]' },
      { name: 'ephemeralPubKeys', type: 'bytes[]' },
      { name: 'metadatas', type: 'bytes[]' },
      { name: 'amounts', type: 'uint256[]' },
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
  {
    type: 'function',
    name: 'nameOf',
    inputs: [{ name: 'stealthMetaAddress', type: 'bytes' }],
    outputs: [{ name: '', type: 'string' }],
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
  {
    type: 'function',
    name: 'registerKeysOnBehalf',
    inputs: [
      { name: 'registrant', type: 'address' },
      { name: 'schemeId', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
      { name: 'stealthMetaAddress', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'stealthMetaAddressOf',
    inputs: [
      { name: 'registrant', type: 'address' },
      { name: 'schemeId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'incrementNonce',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'nonceOf',
    inputs: [{ name: 'registrant', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
] as const;

export const WITHDRAWER_ABI = [
  {
    type: 'function',
    name: 'withdrawETH',
    inputs: [
      { name: 'destination', type: 'address' },
      { name: 'sponsorFee', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdrawERC20',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'destination', type: 'address' },
      { name: 'sponsorFee', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdrawETHDirect',
    inputs: [{ name: 'destination', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdrawERC20Direct',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'destination', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;
