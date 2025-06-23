export const UEA_SVM = [
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    name: 'VERIFIER_PRECOMPILE',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'VERSION',
    inputs: [],
    outputs: [{ name: '', type: 'string', internalType: 'string' }],
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
        internalType: 'struct UniversalPayload',
        components: [
          { name: 'to', type: 'address', internalType: 'address' },
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
          {
            name: 'deadline',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'sigType',
            type: 'uint8',
            internalType: 'enum SignatureType',
          },
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
        internalType: 'struct UniversalPayload',
        components: [
          { name: 'to', type: 'address', internalType: 'address' },
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
          {
            name: 'deadline',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'sigType',
            type: 'uint8',
            internalType: 'enum SignatureType',
          },
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
        name: '_id',
        type: 'tuple',
        internalType: 'struct UniversalAccount',
        components: [
          { name: 'chain', type: 'string', internalType: 'string' },
          { name: 'owner', type: 'bytes', internalType: 'bytes' },
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
    name: 'universalAccount',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct UniversalAccount',
        components: [
          { name: 'chain', type: 'string', internalType: 'string' },
          { name: 'owner', type: 'bytes', internalType: 'bytes' },
        ],
      },
    ],
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
  { type: 'error', name: 'AlreadyInitialized', inputs: [] },
  { type: 'error', name: 'ExecutionFailed', inputs: [] },
  { type: 'error', name: 'ExpiredDeadline', inputs: [] },
  { type: 'error', name: 'InvalidSVMSignature', inputs: [] },
  { type: 'error', name: 'PrecompileCallFailed', inputs: [] },
  { type: 'error', name: 'ReentrancyGuardReentrantCall', inputs: [] },
];
