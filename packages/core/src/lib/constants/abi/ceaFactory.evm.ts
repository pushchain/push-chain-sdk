/**
 * CEAFactory ABI
 * Used for deploying and looking up CEA addresses
 */
export const CEA_FACTORY_EVM = [
  {
    inputs: [{ internalType: 'address', name: '_uea', type: 'address' }],
    name: 'deployCEA',
    outputs: [{ internalType: 'address', name: 'cea', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '_pushAccount', type: 'address' }],
    name: 'getCEAForPushAccount',
    outputs: [
      { internalType: 'address', name: 'cea', type: 'address' },
      { internalType: 'bool', name: 'isDeployed', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '_cea', type: 'address' }],
    name: 'isCEA',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '_cea', type: 'address' }],
    name: 'getPushAccountForCEA',
    outputs: [{ internalType: 'address', name: 'pushAccount', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
