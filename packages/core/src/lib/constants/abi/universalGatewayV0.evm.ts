export const UNIVERSAL_GATEWAY_V0 = [
  {
    type: 'function',
    name: 'addFunds',
    inputs: [
      {
        name: '_transactionHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'sendFunds',
    inputs: [
      { name: 'recipient', type: 'address', internalType: 'address' },
      { name: 'bridgeToken', type: 'address', internalType: 'address' },
      { name: 'bridgeAmount', type: 'uint256', internalType: 'uint256' },
      {
        name: 'revertCFG',
        type: 'tuple',
        internalType: 'struct RevertSettings',
        components: [
          { name: 'fundRecipient', type: 'address', internalType: 'address' },
          { name: 'revertMsg', type: 'bytes', internalType: 'bytes' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
];
