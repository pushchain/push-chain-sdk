export const FEE_LOCKER_EVM = [
  {
    type: 'function',
    name: 'getEthUsdPrice',
    inputs: [],
    outputs: [
      { name: '', type: 'uint256', internalType: 'uint256' },
      { name: '', type: 'uint8', internalType: 'uint8' },
    ],
    stateMutability: 'view',
  },
] as const;
