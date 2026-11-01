// Generated from feat/universal-evaluator-pre-post-reads@8666c2a.
export const EVALUATION_HOOK_ABI = [
  {
    type: 'function',
    name: 'AGW_FACTORY',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'EVALUATOR',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'KERNEL',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'SESSION_ENGINE',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'activeJobOf',
    inputs: [
      {
        name: 'agw',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'afterAction',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'selector',
        type: 'bytes4',
        internalType: 'bytes4',
      },
      {
        name: 'data',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'agwOfJob',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'beforeAction',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'selector',
        type: 'bytes4',
        internalType: 'bytes4',
      },
      {
        name: 'data',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'initialize',
    inputs: [
      {
        name: 'kernel_',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'agwFactory_',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'sessionEngine_',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'evaluator_',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'rulesOfJob',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'supportsInterface',
    inputs: [
      {
        name: 'interfaceId',
        type: 'bytes4',
        internalType: 'bytes4',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
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
    name: 'RulesBound',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'agw',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'rulesId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SpecFrozen',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'specHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SpecReplaced',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'byProvider',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
      {
        name: 'specHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'CallerIsNotAGW',
    inputs: [
      {
        name: 'caller',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'CallerIsNotKernel',
    inputs: [
      {
        name: 'caller',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'FlagChanged',
    inputs: [
      {
        name: 'expected',
        type: 'uint8',
        internalType: 'enum AllowedMutability',
      },
      {
        name: 'got',
        type: 'uint8',
        internalType: 'enum AllowedMutability',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidInitialization',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidOptParams',
    inputs: [
      {
        name: 'length',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'NotInitializing',
    inputs: [],
  },
  {
    type: 'error',
    name: 'RulesNotLive',
    inputs: [
      {
        name: 'agw',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'rulesId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'SpecChangeNotAllowed',
    inputs: [
      {
        name: 'flag',
        type: 'uint8',
        internalType: 'enum AllowedMutability',
      },
    ],
  },
  {
    type: 'error',
    name: 'SpecHashMismatch',
    inputs: [
      {
        name: 'expected',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'actual',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'WalletHasActiveJob',
    inputs: [
      {
        name: 'agw',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ZeroAddress',
    inputs: [],
  },
] as const;
