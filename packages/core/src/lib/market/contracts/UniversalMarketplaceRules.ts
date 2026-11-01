// Generated from sdk_iteration_v2@5aad039; marketplace 2.1.0.
export const MARKET_RULES_ABI = [
  {
    type: 'function',
    name: 'checkRulesMatchCard',
    inputs: [
      {
        name: 'cardRules',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: 'sessions',
        type: 'tuple[]',
        internalType: 'struct Session[]',
        components: [
          {
            name: 'sessionValidator',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'sessionValidatorInitData',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'salt',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'userOpPolicies',
            type: 'tuple[]',
            internalType: 'struct PolicyData[]',
            components: [
              {
                name: 'policy',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'initData',
                type: 'bytes',
                internalType: 'bytes',
              },
            ],
          },
          {
            name: 'erc7739Policies',
            type: 'tuple',
            internalType: 'struct ERC7739Data',
            components: [
              {
                name: 'allowedERC7739Content',
                type: 'tuple[]',
                internalType: 'struct ERC7739Context[]',
                components: [
                  {
                    name: 'appDomainSeparator',
                    type: 'bytes32',
                    internalType: 'bytes32',
                  },
                  {
                    name: 'contentNames',
                    type: 'string[]',
                    internalType: 'string[]',
                  },
                ],
              },
              {
                name: 'erc1271Policies',
                type: 'tuple[]',
                internalType: 'struct PolicyData[]',
                components: [
                  {
                    name: 'policy',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'initData',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
            ],
          },
          {
            name: 'actions',
            type: 'tuple[]',
            internalType: 'struct ActionData[]',
            components: [
              {
                name: 'actionTargetSelector',
                type: 'bytes4',
                internalType: 'bytes4',
              },
              {
                name: 'actionTarget',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'actionPolicies',
                type: 'tuple[]',
                internalType: 'struct PolicyData[]',
                components: [
                  {
                    name: 'policy',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'initData',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
            ],
          },
          {
            name: 'permitERC4337Paymaster',
            type: 'bool',
            internalType: 'bool',
          },
        ],
      },
      {
        name: 'ctx',
        type: 'tuple',
        internalType: 'struct SessionContext',
        components: [
          {
            name: 'agent',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'principal',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'expiredAt',
            type: 'uint48',
            internalType: 'uint48',
          },
          {
            name: 'expectedCEAs',
            type: 'address[]',
            internalType: 'address[]',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'validateAgentCardRules',
    inputs: [
      {
        name: 'rules',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: 'maxRules',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: 'chainHashes',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
      {
        name: 'tokens',
        type: 'address[]',
        internalType: 'address[]',
      },
      {
        name: 'tokenChains',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
    ],
    stateMutability: 'pure',
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
] as const;
