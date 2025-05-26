export const SMART_ACCOUNT_EVM = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    name: 'VERSION',
    inputs: [],
    outputs: [{ name: '', type: 'string', internalType: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'accountId',
    inputs: [],
    outputs: [
      {
        name: '',
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
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'domainSeparator',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'executePayload',
    inputs: [
      {
        name: 'payload',
        type: 'tuple',
        internalType: 'struct CrossChainPayload',
        components: [
          { name: 'target', type: 'address', internalType: 'address' },
          { name: 'value', type: 'uint256', internalType: 'uint256' },
          { name: 'data', type: 'bytes', internalType: 'bytes' },
          {
            name: 'gasLimit',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'maxFeePerGas',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'maxPriorityFeePerGas',
            type: 'uint256',
            internalType: 'uint256',
          },
          { name: 'nonce', type: 'uint256', internalType: 'uint256' },
          { name: 'deadline', type: 'uint256', internalType: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getTransactionHash',
    inputs: [
      {
        name: 'payload',
        type: 'tuple',
        internalType: 'struct CrossChainPayload',
        components: [
          { name: 'target', type: 'address', internalType: 'address' },
          { name: 'value', type: 'uint256', internalType: 'uint256' },
          { name: 'data', type: 'bytes', internalType: 'bytes' },
          {
            name: 'gasLimit',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'maxFeePerGas',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'maxPriorityFeePerGas',
            type: 'uint256',
            internalType: 'uint256',
          },
          { name: 'nonce', type: 'uint256', internalType: 'uint256' },
          { name: 'deadline', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'initialize',
    inputs: [
      {
        name: '_accountId',
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
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'nonce',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'verifyPayloadSignature',
    inputs: [
      { name: 'messageHash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'signature', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
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
    name: 'PayloadExecuted',
    inputs: [
      {
        name: 'caller',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
      {
        name: 'target',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'data',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'ECDSAInvalidSignature', inputs: [] },
  {
    type: 'error',
    name: 'ECDSAInvalidSignatureLength',
    inputs: [{ name: 'length', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'error',
    name: 'ECDSAInvalidSignatureS',
    inputs: [{ name: 's', type: 'bytes32', internalType: 'bytes32' }],
  },
  { type: 'error', name: 'ExecutionFailed', inputs: [] },
  { type: 'error', name: 'ExpiredDeadline', inputs: [] },
  { type: 'error', name: 'InvalidEVMSignature', inputs: [] },
  { type: 'error', name: 'InvalidInitialization', inputs: [] },
  { type: 'error', name: 'InvalidInputArgs', inputs: [] },
  { type: 'error', name: 'NotInitializing', inputs: [] },
  { type: 'error', name: 'ReentrancyGuardReentrantCall', inputs: [] },
];
