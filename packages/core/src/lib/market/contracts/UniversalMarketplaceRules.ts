// Generated from sdk-iteration-v1@443b4e2; Donut marketplace v2.
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
        name: 'session',
        type: 'tuple',
        internalType: 'struct Session',
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
            name: 'chainHash',
            type: 'bytes32',
            internalType: 'bytes32',
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
            name: 'expectedCEA',
            type: 'address',
            internalType: 'address',
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
    ],
    outputs: [
      {
        name: 'tokens',
        type: 'address[]',
        internalType: 'address[]',
      },
    ],
    stateMutability: 'pure',
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
    name: 'GasCapMismatch',
    inputs: [],
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
] as const;
