export const FEE_LOCKER_EVM = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    name: 'accountImplmentationForVM',
    inputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'computeSmartAccountAddress',
    inputs: [
      {
        name: '_id',
        type: 'tuple',
        internalType: 'struct AccountId',
        components: [
          { name: 'namespace', type: 'string', internalType: 'string' },
          { name: 'chainId', type: 'string', internalType: 'string' },
          { name: 'ownerKey', type: 'bytes', internalType: 'bytes' },
          {
            name: 'vmType',
            type: 'uint8',
            internalType: 'enum VM_TYPE',
          },
        ],
      },
    ],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'deploySmartAccount',
    inputs: [
      {
        name: '_id',
        type: 'tuple',
        internalType: 'struct AccountId',
        components: [
          { name: 'namespace', type: 'string', internalType: 'string' },
          { name: 'chainId', type: 'string', internalType: 'string' },
          { name: 'ownerKey', type: 'bytes', internalType: 'bytes' },
          {
            name: 'vmType',
            type: 'uint8',
            internalType: 'enum VM_TYPE',
          },
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
        internalType: 'struct AccountId',
        components: [
          { name: 'namespace', type: 'string', internalType: 'string' },
          { name: 'chainId', type: 'string', internalType: 'string' },
          { name: 'ownerKey', type: 'bytes', internalType: 'bytes' },
          {
            name: 'vmType',
            type: 'uint8',
            internalType: 'enum VM_TYPE',
          },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'getImplementation',
    inputs: [{ name: '_vmType', type: 'uint8', internalType: 'enum VM_TYPE' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
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
    name: 'registerImplementation',
    inputs: [
      { name: '_vmType', type: 'uint256', internalType: 'uint256' },
      {
        name: '_implementation',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerMultipleImplementations',
    inputs: [
      {
        name: '_vmTypes',
        type: 'uint256[]',
        internalType: 'uint256[]',
      },
      {
        name: '_implementations',
        type: 'address[]',
        internalType: 'address[]',
      },
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
    type: 'function',
    name: 'userAccounts',
    inputs: [{ name: '', type: 'bytes', internalType: 'bytes' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'ImplementationRegistered',
    inputs: [
      {
        name: 'vmType',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'implementation',
        type: 'address',
        indexed: false,
        internalType: 'address',
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
    name: 'SmartAccountDeployed',
    inputs: [
      {
        name: 'smartAccount',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'ownerKey',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
      {
        name: 'id',
        type: 'tuple',
        indexed: false,
        internalType: 'struct AccountId',
        components: [
          { name: 'namespace', type: 'string', internalType: 'string' },
          { name: 'chainId', type: 'string', internalType: 'string' },
          { name: 'ownerKey', type: 'bytes', internalType: 'bytes' },
          {
            name: 'vmType',
            type: 'uint8',
            internalType: 'enum VM_TYPE',
          },
        ],
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
  { type: 'error', name: 'InvalidInputArgs', inputs: [] },
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
