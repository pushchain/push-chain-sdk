// Generated from sdk-iteration-v1@443b4e2; Donut marketplace v2.
export const MARKETPLACE_ABI = [
  {
    type: 'constructor',
    inputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'ADMIN_ROLE',
    inputs: [],
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
    name: 'AGW_FACTORY',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IAGWFactory',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'DEFAULT_ADMIN_ROLE',
    inputs: [],
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
    name: 'MODE_SINGLE',
    inputs: [],
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
    name: 'OPENJOB_LANE',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint192',
        internalType: 'uint192',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'PUSH_CHAIN_HASH',
    inputs: [],
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
    name: 'RULES',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract IUniversalMarketplaceRules',
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
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'agentCardCount',
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
    name: 'agentCardOf',
    inputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
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
    name: 'agentCardVersion',
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
    name: 'agwOfJob',
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
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'buildCreateJobCalldata',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'owner',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'index',
        type: 'uint96',
        internalType: 'uint96',
      },
      {
        name: 'job',
        type: 'tuple',
        internalType: 'struct JobInputs',
        components: [
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
            name: 'executeBy',
            type: 'uint48',
            internalType: 'uint48',
          },
          {
            name: 'params',
            type: 'int256[]',
            internalType: 'int256[]',
          },
        ],
      },
    ],
    outputs: [
      {
        name: 'mode',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'executionCalldata',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'cardOfJob',
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
    name: 'cardVersionOfJob',
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
    name: 'ceaDeployment',
    inputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: 'ceaFactory',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'ceaProxyImpl',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'computeCEA',
    inputs: [
      {
        name: 'agw',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'chainHash',
        type: 'bytes32',
        internalType: 'bytes32',
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
    name: 'disableAgentCard',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'evaluator',
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
    name: 'getAgentCard',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: 'v',
        type: 'tuple',
        internalType: 'struct AgentCardView',
        components: [
          {
            name: 'card',
            type: 'tuple',
            internalType: 'struct AgentCard',
            components: [
              {
                name: 'provider',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'jobType',
                type: 'bytes32',
                internalType: 'bytes32',
              },
              {
                name: 'metadataURI',
                type: 'string',
                internalType: 'string',
              },
              {
                name: 'metadataHash',
                type: 'bytes32',
                internalType: 'bytes32',
              },
              {
                name: 'chainNamespace',
                type: 'string',
                internalType: 'string',
              },
              {
                name: 'providerFee',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'paymentToken',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'principalMin',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'principalMax',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'minDuration',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'maxDuration',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'minExecuteWindow',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'settleWindow',
                type: 'uint32',
                internalType: 'uint32',
              },
              {
                name: 'active',
                type: 'bool',
                internalType: 'bool',
              },
            ],
          },
          {
            name: 'rules',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'jobSpecTemplate',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'version',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'verified',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'disabled',
            type: 'bool',
            internalType: 'bool',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAgentRating',
    inputs: [
      {
        name: 'agent',
        type: 'address',
        internalType: 'address',
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
    name: 'getRoleAdmin',
    inputs: [
      {
        name: 'role',
        type: 'bytes32',
        internalType: 'bytes32',
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
    name: 'grantRole',
    inputs: [
      {
        name: 'role',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'hasRole',
    inputs: [
      {
        name: 'role',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
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
    name: 'hook',
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
    name: 'initialize',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        internalType: 'struct InitParams',
        components: [
          {
            name: 'agwFactory',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'kernel',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'hook',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'evaluator',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'rules',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'admin',
            type: 'address',
            internalType: 'address',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isAgentCardDisabled',
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
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isAgentCardVerified',
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
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'openJob',
    inputs: [
      {
        name: 'p',
        type: 'tuple',
        internalType: 'struct OpenJobParams',
        components: [
          {
            name: 'cardId',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'cardVersion',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'job',
            type: 'tuple',
            internalType: 'struct JobInputs',
            components: [
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
                name: 'executeBy',
                type: 'uint48',
                internalType: 'uint48',
              },
              {
                name: 'params',
                type: 'int256[]',
                internalType: 'int256[]',
              },
            ],
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
            name: 'intent',
            type: 'tuple',
            internalType: 'struct OwnerIntent',
            components: [
              {
                name: 'owner',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'wallet',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'executor',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'index',
                type: 'uint96',
                internalType: 'uint96',
              },
              {
                name: 'sessionHash',
                type: 'bytes32',
                internalType: 'bytes32',
              },
              {
                name: 'mode',
                type: 'bytes32',
                internalType: 'bytes32',
              },
              {
                name: 'execCalldataHash',
                type: 'bytes32',
                internalType: 'bytes32',
              },
              {
                name: 'nonceKey',
                type: 'uint192',
                internalType: 'uint192',
              },
              {
                name: 'nonceSeq',
                type: 'uint64',
                internalType: 'uint64',
              },
              {
                name: 'grantNonce',
                type: 'uint64',
                internalType: 'uint64',
              },
              {
                name: 'deadline',
                type: 'uint48',
                internalType: 'uint48',
              },
              {
                name: 'signerChainId',
                type: 'uint256',
                internalType: 'uint256',
              },
            ],
          },
          {
            name: 'sig',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'label',
            type: 'string',
            internalType: 'string',
          },
        ],
      },
    ],
    outputs: [
      {
        name: 'jobId',
        type: 'uint256',
        internalType: 'uint256',
      },
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
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pause',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'paused',
    inputs: [],
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
    name: 'previewIntent',
    inputs: [
      {
        name: 'r',
        type: 'tuple',
        internalType: 'struct IntentRequest',
        components: [
          {
            name: 'cardId',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'owner',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'index',
            type: 'uint96',
            internalType: 'uint96',
          },
          {
            name: 'job',
            type: 'tuple',
            internalType: 'struct JobInputs',
            components: [
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
                name: 'executeBy',
                type: 'uint48',
                internalType: 'uint48',
              },
              {
                name: 'params',
                type: 'int256[]',
                internalType: 'int256[]',
              },
            ],
          },
          {
            name: 'deadline',
            type: 'uint48',
            internalType: 'uint48',
          },
          {
            name: 'signerChainId',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
      {
        name: 's',
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
    ],
    outputs: [
      {
        name: 'i',
        type: 'tuple',
        internalType: 'struct OwnerIntent',
        components: [
          {
            name: 'owner',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'wallet',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'executor',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'index',
            type: 'uint96',
            internalType: 'uint96',
          },
          {
            name: 'sessionHash',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'mode',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'execCalldataHash',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'nonceKey',
            type: 'uint192',
            internalType: 'uint192',
          },
          {
            name: 'nonceSeq',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'grantNonce',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'deadline',
            type: 'uint48',
            internalType: 'uint48',
          },
          {
            name: 'signerChainId',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'registerAgentCard',
    inputs: [
      {
        name: 'c',
        type: 'tuple',
        internalType: 'struct AgentCard',
        components: [
          {
            name: 'provider',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'jobType',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'metadataURI',
            type: 'string',
            internalType: 'string',
          },
          {
            name: 'metadataHash',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'chainNamespace',
            type: 'string',
            internalType: 'string',
          },
          {
            name: 'providerFee',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'paymentToken',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'principalMin',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'principalMax',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'minDuration',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'maxDuration',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'minExecuteWindow',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'settleWindow',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'active',
            type: 'bool',
            internalType: 'bool',
          },
        ],
      },
      {
        name: 'rules',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: 'jobSpecTemplate',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [
      {
        name: 'cardId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'renounceRole',
    inputs: [
      {
        name: 'role',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'callerConfirmation',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeAgentCardVerification',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeRole',
    inputs: [
      {
        name: 'role',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'account',
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
        name: '',
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
    name: 'setAgentCardActive',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'active',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setAgentRating',
    inputs: [
      {
        name: 'agent',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'rating',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setCEADeployment',
    inputs: [
      {
        name: 'chainHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'ceaFactory',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'ceaProxyImpl',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setEvaluator',
    inputs: [
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
    name: 'setHook',
    inputs: [
      {
        name: 'hook_',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
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
    type: 'function',
    name: 'unpause',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateAgentCard',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'c',
        type: 'tuple',
        internalType: 'struct AgentCard',
        components: [
          {
            name: 'provider',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'jobType',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'metadataURI',
            type: 'string',
            internalType: 'string',
          },
          {
            name: 'metadataHash',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'chainNamespace',
            type: 'string',
            internalType: 'string',
          },
          {
            name: 'providerFee',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'paymentToken',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'principalMin',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'principalMax',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'minDuration',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'maxDuration',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'minExecuteWindow',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'settleWindow',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'active',
            type: 'bool',
            internalType: 'bool',
          },
        ],
      },
      {
        name: 'rules',
        type: 'bytes',
        internalType: 'bytes',
      },
      {
        name: 'jobSpecTemplate',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verifyAgentCard',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'cardVersion',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'version',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'string',
        internalType: 'string',
      },
    ],
    stateMutability: 'pure',
  },
  {
    type: 'event',
    name: 'AgentCardDisabled',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgentCardRegistered',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'provider',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'jobType',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'chainNamespace',
        type: 'string',
        indexed: false,
        internalType: 'string',
      },
      {
        name: 'rulesHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'jobSpecHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'metadataHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'providerFee',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgentCardStatusChanged',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'active',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgentCardUpdated',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'version',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'rulesHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'jobSpecHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'metadataHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'providerFee',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgentCardVerificationRevoked',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgentCardVerified',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'version',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgentRatingSet',
    inputs: [
      {
        name: 'agent',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'rating',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CEADeploymentSet',
    inputs: [
      {
        name: 'chainHash',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'ceaFactory',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'ceaProxyImpl',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EvaluatorUpdated',
    inputs: [
      {
        name: 'evaluator',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'HookUpdated',
    inputs: [
      {
        name: 'hook',
        type: 'address',
        indexed: false,
        internalType: 'address',
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
    name: 'JobOpened',
    inputs: [
      {
        name: 'cardId',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'owner',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'agw',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'jobId',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'rulesId',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'principal',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'cardVersion',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Paused',
    inputs: [
      {
        name: 'account',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RoleAdminChanged',
    inputs: [
      {
        name: 'role',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'previousAdminRole',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'newAdminRole',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RoleGranted',
    inputs: [
      {
        name: 'role',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'account',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'sender',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RoleRevoked',
    inputs: [
      {
        name: 'role',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'account',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'sender',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Unpaused',
    inputs: [
      {
        name: 'account',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
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
    name: 'AccessControlBadConfirmation',
    inputs: [],
  },
  {
    type: 'error',
    name: 'AccessControlUnauthorizedAccount',
    inputs: [
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'neededRole',
        type: 'bytes32',
        internalType: 'bytes32',
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
    name: 'CallerIsNotProvider',
    inputs: [],
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
    name: 'EnforcedPause',
    inputs: [],
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
    name: 'ExpectedPause',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ExpiryOutOfRange',
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
    name: 'InvalidInitialization',
    inputs: [],
  },
  {
    type: 'error',
    name: 'JobMismatch',
    inputs: [],
  },
  {
    type: 'error',
    name: 'NotInitializing',
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
    name: 'ReentrancyGuardReentrantCall',
    inputs: [],
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
