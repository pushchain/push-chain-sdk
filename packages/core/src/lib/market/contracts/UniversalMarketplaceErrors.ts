// Generated from sdk_iteration_v2@5aad039; marketplace 2.1.0.
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
    inputs: [
      {
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ActionsMismatch',
    inputs: [
      {
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
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
    inputs: [
      {
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'AssetCountMismatch',
    inputs: [
      {
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
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
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
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
        name: 'rule',
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
    name: 'DuplicateChain',
    inputs: [
      {
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'EnvelopeVersionMismatch',
    inputs: [
      {
        name: 'rule',
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
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
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
    inputs: [
      {
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
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
    inputs: [
      {
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
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
    name: 'InvalidMaxRules',
    inputs: [
      {
        name: 'n',
        type: 'uint8',
        internalType: 'uint8',
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
    name: 'ManyPrincipals',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NoPrincipal',
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
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
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
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'ProviderIsEvaluator',
    inputs: [],
  },
  {
    type: 'error',
    name: 'RuleHasAgent',
    inputs: [
      {
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'RulesEmpty',
    inputs: [],
  },
  {
    type: 'error',
    name: 'RulesNotGranted',
    inputs: [
      {
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'SessionCountMismatch',
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
    name: 'TooManyRules',
    inputs: [
      {
        name: 'n',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'max',
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
    name: 'UnpinnedApprove',
    inputs: [
      {
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'call',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'UnpinnedTransfer',
    inputs: [
      {
        name: 'rule',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'call',
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
  {
    type: 'error',
    name: 'ZeroPrincipal',
    inputs: [],
  },
] as const;
