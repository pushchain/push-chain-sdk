export const FACTORY_V1 = [
  {
    type: 'function',
    name: 'computeUEA',
    inputs: [
      {
        name: '_id',
        type: 'tuple',
        internalType: 'struct UniversalAccountId',
        components: [
          {
            name: 'chainNamespace',
            type: 'string',
            internalType: 'string',
          },
          {
            name: 'chainId',
            type: 'string',
            internalType: 'string',
          },
          {
            name: 'owner',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
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
    name: 'getOriginForUEA',
    inputs: [
      {
        name: 'addr',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: 'account',
        type: 'tuple',
        internalType: 'struct UniversalAccountId',
        components: [
          {
            name: 'chainNamespace',
            type: 'string',
            internalType: 'string',
          },
          {
            name: 'chainId',
            type: 'string',
            internalType: 'string',
          },
          {
            name: 'owner',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
      {
        name: 'isUEA',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
] as const;
