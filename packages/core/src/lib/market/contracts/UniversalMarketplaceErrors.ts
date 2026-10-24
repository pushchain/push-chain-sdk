// Generated from sdk-iteration-v1@443b4e2; Donut marketplace v2.
export const MARKET_ERRORS_ABI = [
  {
    type: 'error',
    name: 'AGWMismatch',
    inputs: [
      {
        name: 'expected',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'actual',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'ActionCount',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ActionsMismatch',
    inputs: [],
  },
  {
    type: 'error',
    name: 'AgentCardAlreadyRegistered',
    inputs: [
      {
        name: 'provider',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'AgentCardDisabled',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'AgentCardIdentityImmutable',
    inputs: [],
  },
  {
    type: 'error',
    name: 'AgentCardInactive',
    inputs: [],
  },
  {
    type: 'error',
    name: 'AgentCardVersionMismatch',
    inputs: [
      {
        name: 'provided',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'current',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'AgentMismatch',
    inputs: [],
  },
  {
    type: 'error',
    name: 'AssetCountMismatch',
    inputs: [
      {
        name: 'expected',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'actual',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'AssetMismatch',
    inputs: [
      {
        name: 'index',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'CallerIsNotProvider',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ChainMismatch',
    inputs: [
      {
        name: 'i',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ChainNotSupported',
    inputs: [
      {
        name: 'chainHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'EnvelopeVersionMismatch',
    inputs: [
      {
        name: 'actual',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ExecuteByOutOfRange',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ExecutorMismatch',
    inputs: [
      {
        name: 'expected',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'actual',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'ExpectedCEAMismatch',
    inputs: [
      {
        name: 'expected',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'actual',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'ExpiryMismatch',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ExpiryOutOfRange',
    inputs: [],
  },
  {
    type: 'error',
    name: 'FillOutOfBounds',
    inputs: [
      {
        name: 'read',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'fill',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'GasCapMismatch',
    inputs: [],
  },
  {
    type: 'error',
    name: 'HookNotWhitelisted',
    inputs: [],
  },
  {
    type: 'error',
    name: 'IntentExecMismatch',
    inputs: [
      {
        name: 'actualCalldataHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'IntentSessionMismatch',
    inputs: [
      {
        name: 'actual',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'IntentWalletMismatch',
    inputs: [
      {
        name: 'expected',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'provided',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidAgentCard',
    inputs: [
      {
        name: 'reason',
        type: 'string',
        internalType: 'string',
      },
    ],
  },
  {
    type: 'error',
    name: 'JobMismatch',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ParamCountMismatch',
    inputs: [
      {
        name: 'expected',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'actual',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ParamOutOfRange',
    inputs: [
      {
        name: 'index',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'value',
        type: 'int256',
        internalType: 'int256',
      },
    ],
  },
  {
    type: 'error',
    name: 'PinMismatch',
    inputs: [
      {
        name: 'call',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'pin',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'PolicyShape',
    inputs: [
      {
        name: 'i',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'PrincipalCapMismatch',
    inputs: [],
  },
  {
    type: 'error',
    name: 'PrincipalOutOfRange',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ProviderIsEvaluator',
    inputs: [],
  },
  {
    type: 'error',
    name: 'TargetOverflow',
    inputs: [
      {
        name: 'check',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'UnexpectedJobCount',
    inputs: [
      {
        name: 'before',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'afterCount',
        type: 'uint256',
        internalType: 'uint256',
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
    name: 'WalletOwnerMismatch',
    inputs: [
      {
        name: 'expected',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'actual',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'ZeroAddress',
    inputs: [],
  },
] as const;
