export const UNIVERSAL_GATEWAY_V0 = [
  {
    type: 'function',
    name: 'getMinMaxValueForNative',
    inputs: [],
    outputs: [
      { name: 'minValue', type: 'uint256', internalType: 'uint256' },
      { name: 'maxValue', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'view',
  },
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
  {
    type: 'function',
    name: 'sendTxWithFunds',
    inputs: [
      { name: 'bridgeToken', type: 'address', internalType: 'address' },
      { name: 'bridgeAmount', type: 'uint256', internalType: 'uint256' },
      {
        name: 'payload',
        type: 'tuple',
        internalType: 'struct UniversalPayload',
        components: [
          { name: 'to', type: 'address', internalType: 'address' },
          { name: 'value', type: 'uint256', internalType: 'uint256' },
          { name: 'data', type: 'bytes', internalType: 'bytes' },
          { name: 'gasLimit', type: 'uint256', internalType: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256', internalType: 'uint256' },
          {
            name: 'maxPriorityFeePerGas',
            type: 'uint256',
            internalType: 'uint256',
          },
          { name: 'nonce', type: 'uint256', internalType: 'uint256' },
          { name: 'deadline', type: 'uint256', internalType: 'uint256' },
          {
            name: 'vType',
            type: 'uint8',
            internalType: 'enum VerificationType',
          },
        ],
      },
      {
        name: 'revertCFG',
        type: 'tuple',
        internalType: 'struct RevertSettings',
        components: [
          { name: 'fundRecipient', type: 'address', internalType: 'address' },
          { name: 'revertMsg', type: 'bytes', internalType: 'bytes' },
        ],
      },
      { name: 'signatureData', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'sendTxWithFunds',
    inputs: [
      { name: 'bridgeToken', type: 'address', internalType: 'address' },
      { name: 'bridgeAmount', type: 'uint256', internalType: 'uint256' },
      { name: 'gasToken', type: 'address', internalType: 'address' },
      { name: 'gasAmount', type: 'uint256', internalType: 'uint256' },
      { name: 'amountOutMinETH', type: 'uint256', internalType: 'uint256' },
      { name: 'deadline', type: 'uint256', internalType: 'uint256' },
      {
        name: 'payload',
        type: 'tuple',
        internalType: 'struct UniversalPayload',
        components: [
          { name: 'to', type: 'address', internalType: 'address' },
          { name: 'value', type: 'uint256', internalType: 'uint256' },
          { name: 'data', type: 'bytes', internalType: 'bytes' },
          { name: 'gasLimit', type: 'uint256', internalType: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256', internalType: 'uint256' },
          {
            name: 'maxPriorityFeePerGas',
            type: 'uint256',
            internalType: 'uint256',
          },
          { name: 'nonce', type: 'uint256', internalType: 'uint256' },
          { name: 'deadline', type: 'uint256', internalType: 'uint256' },
          {
            name: 'vType',
            type: 'uint8',
            internalType: 'enum VerificationType',
          },
        ],
      },
      {
        name: 'revertCFG',
        type: 'tuple',
        internalType: 'struct RevertSettings',
        components: [
          { name: 'fundRecipient', type: 'address', internalType: 'address' },
          { name: 'revertMsg', type: 'bytes', internalType: 'bytes' },
        ],
      },
      { name: 'signatureData', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
];
