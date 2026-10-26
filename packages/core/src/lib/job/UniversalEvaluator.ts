// Generated from feat/universal-evaluator-pre-post-reads@8666c2a.
export const EVALUATOR_ABI = [
  {
    type: 'function',
    name: 'BUDGET_MULTIPLIER',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'CALLBACK_GAS_LIMIT',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'FEE_RECIPIENT',
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
    name: 'HOOK',
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
        internalType: 'contract IAgenticCommerce',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_CONFIRMATIONS',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint16',
        internalType: 'uint16',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_HEIGHT_AGE',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'READ_STATE',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IUniversalCallback',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'READ_TTL',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'SNAPSHOT_CALLBACK_GAS_LIMIT',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'UNIVERSAL_CORE',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IUniversalCoreHeights',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'answerOf',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'read',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: 'ok',
        type: 'bool',
        internalType: 'bool',
      },
      {
        name: 'value',
        type: 'int256',
        internalType: 'int256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'claimPrepaid',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'currentSpec',
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
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decodeAnswer',
    inputs: [
      {
        name: 'outputs',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: 'field',
        type: 'uint8[]',
        internalType: 'uint8[]',
      },
      {
        name: 'res',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
      {
        name: '',
        type: 'int256',
        internalType: 'int256',
      },
    ],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'endHeightOf',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'read',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'evaluationOf',
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
        type: 'tuple',
        internalType: 'struct UniversalEvaluator.Evaluation',
        components: [
          {
            name: 'endFixed',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'started',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'reads',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'pending',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'done',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'verdict',
            type: 'uint8',
            internalType: 'enum Verdict',
          },
          {
            name: 'applied',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'ownerCheck',
            type: 'uint8',
            internalType: 'enum OwnerCheck',
          },
          {
            name: 'checkRes',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'answered',
            type: 'uint32',
            internalType: 'uint32',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'evidenceOf',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'read',
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
    name: 'fundHeightOf',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'read',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'onUniversalData',
    inputs: [
      {
        name: 'requestId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'result',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'prefund',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'prefundCost',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: 'snapshot',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'evaluation',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'prepaidOf',
    inputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ready',
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
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'requestOf',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'read',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'retryEvaluation',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'retrySnapshot',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'sendFromSubmit',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setSpec',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'spec',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'settle',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'specHashOf',
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
    name: 'startSnapshot',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'spec',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'sweepFees',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verifyFromSubmit',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'EndBlocksFixed',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FeesSwept',
    inputs: [
      {
        name: 'to',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Prefunded',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'from',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PrepaidRefunded',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'to',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ReadAnswered',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'read',
        type: 'uint8',
        indexed: true,
        internalType: 'uint8',
      },
      {
        name: 'requestId',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'height',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
      {
        name: 'ok',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
      {
        name: 'value',
        type: 'int256',
        indexed: false,
        internalType: 'int256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ReadsNotSent',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'reason',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ReadsSent',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'reads',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'paid',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SettleFailed',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'reason',
        type: 'bytes',
        indexed: false,
        internalType: 'bytes',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SnapshotAnswered',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'read',
        type: 'uint8',
        indexed: true,
        internalType: 'uint8',
      },
      {
        name: 'requestId',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'ok',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
      {
        name: 'value',
        type: 'int256',
        indexed: false,
        internalType: 'int256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SnapshotReady',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SnapshotRequested',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'read',
        type: 'uint8',
        indexed: true,
        internalType: 'uint8',
      },
      {
        name: 'requestId',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'height',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SpecFrozenHere',
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
      {
        name: 'checkpointRead',
        type: 'uint8',
        indexed: false,
        internalType: 'enum OwnerCheck',
      },
      {
        name: 'checkpointAtFund',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Verified',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'verdict',
        type: 'uint8',
        indexed: false,
        internalType: 'enum Verdict',
      },
      {
        name: 'ownerCheck',
        type: 'uint8',
        indexed: false,
        internalType: 'enum OwnerCheck',
      },
      {
        name: 'reason',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'CallerIsNotClientOrProvider',
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
    name: 'CallerIsNotHook',
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
    name: 'CallerIsNotReadState',
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
    name: 'CallerIsNotSelf',
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
    name: 'ChainNotTracked',
    inputs: [
      {
        name: 'chainKey',
        type: 'string',
        internalType: 'string',
      },
    ],
  },
  {
    type: 'error',
    name: 'EndBlocksNotFixed',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'EndHeightNotAfterFund',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'read',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'fundHeight',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'endHeight',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'HeightStale',
    inputs: [
      {
        name: 'chainKey',
        type: 'string',
        internalType: 'string',
      },
      {
        name: 'observedAt',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'JobStillLive',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'NotOurJob',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'NothingToSend',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'NothingToSettle',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'PrepaidTooLow',
    inputs: [
      {
        name: 'needed',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'available',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ReadDomainBlocked',
    inputs: [
      {
        name: 'read',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ReentrancyGuardReentrantCall',
    inputs: [],
  },
  {
    type: 'error',
    name: 'RefundFailed',
    inputs: [
      {
        name: 'to',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'SafeERC20FailedOperation',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'SnapshotNotReady',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'SpecFrozen',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'SpecTooLong',
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
    name: 'UnknownJob',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'WrongStatus',
    inputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ZeroValue',
    inputs: [],
  },
] as const;
