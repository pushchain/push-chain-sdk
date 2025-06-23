export const FACTORY_V1 = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    name: 'CHAIN_to_VM',
    inputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'UEA_VM',
    inputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'UOA_to_UEA',
    inputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'computeUEA',
    inputs: [
      {
        name: '_id',
        type: 'tuple',
        internalType: 'struct UniversalAccount',
        components: [
          { name: 'chain', type: 'string', internalType: 'string' },
          { name: 'owner', type: 'bytes', internalType: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'deployUEA',
    inputs: [
      {
        name: '_id',
        type: 'tuple',
        internalType: 'struct UniversalAccount',
        components: [
          { name: 'chain', type: 'string', internalType: 'string' },
          { name: 'owner', type: 'bytes', internalType: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'generateSalt',
    inputs: [
      {
        name: '_id',
        type: 'tuple',
        internalType: 'struct UniversalAccount',
        components: [
          { name: 'chain', type: 'string', internalType: 'string' },
          { name: 'owner', type: 'bytes', internalType: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'getOriginForUEA',
    inputs: [{ name: 'addr', type: 'address', internalType: 'address' }],
    outputs: [
      {
        name: 'account',
        type: 'tuple',
        internalType: 'struct UniversalAccount',
        components: [
          { name: 'chain', type: 'string', internalType: 'string' },
          { name: 'owner', type: 'bytes', internalType: 'bytes' },
        ],
      },
      { name: 'isUEA', type: 'bool', internalType: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUEA',
    inputs: [{ name: '_chainHash', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getUEAForOrigin',
    inputs: [
      {
        name: '_id',
        type: 'tuple',
        internalType: 'struct UniversalAccount',
        components: [
          { name: 'chain', type: 'string', internalType: 'string' },
          { name: 'owner', type: 'bytes', internalType: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'uea', type: 'address', internalType: 'address' },
      { name: 'isDeployed', type: 'bool', internalType: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getVMType',
    inputs: [{ name: '_chainHash', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      { name: 'vmHash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'isRegistered', type: 'bool', internalType: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hasCode',
    inputs: [{ name: '_addr', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'initialize',
    inputs: [
      { name: 'initialOwner', type: 'address', internalType: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'registerMultipleUEA',
    inputs: [
      {
        name: '_chainHashes',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
      {
        name: '_vmHashes',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
      { name: '_UEA', type: 'address[]', internalType: 'address[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerNewChain',
    inputs: [
      { name: '_chainHash', type: 'bytes32', internalType: 'bytes32' },
      { name: '_vmHash', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerUEA',
    inputs: [
      { name: '_chainHash', type: 'bytes32', internalType: 'bytes32' },
      { name: '_vmHash', type: 'bytes32', internalType: 'bytes32' },
      { name: '_UEA', type: 'address', internalType: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'renounceOwnership',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transferOwnership',
    inputs: [{ name: 'newOwner', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'ChainRegistered',
    inputs: [
      {
        name: 'chainHash',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'vmHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Initialized',
    inputs: [
      {
        name: 'version',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OwnershipTransferred',
    inputs: [
      {
        name: 'previousOwner',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'newOwner',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'UEADeployed',
    inputs: [
      {
        name: 'UEA',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'owner',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
      {
        name: 'chainHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'UEARegistered',
    inputs: [
      {
        name: 'chainHash',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'UEA_Logic',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'vmHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'AccountAlreadyExists', inputs: [] },
  { type: 'error', name: 'FailedDeployment', inputs: [] },
  {
    type: 'error',
    name: 'InsufficientBalance',
    inputs: [
      { name: 'balance', type: 'uint256', internalType: 'uint256' },
      { name: 'needed', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'InvalidInitialization', inputs: [] },
  { type: 'error', name: 'InvalidInputArgs', inputs: [] },
  { type: 'error', name: 'NotInitializing', inputs: [] },
  {
    type: 'error',
    name: 'OwnableInvalidOwner',
    inputs: [{ name: 'owner', type: 'address', internalType: 'address' }],
  },
  {
    type: 'error',
    name: 'OwnableUnauthorizedAccount',
    inputs: [{ name: 'account', type: 'address', internalType: 'address' }],
  },
];
