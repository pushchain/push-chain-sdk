/**
 * V1 Gateway ABI — uses `revertRecipient` (address) instead of `revertInstruction` (struct).
 * Deployed on BSC Testnet.
 *
 * Only includes the sendUniversalTx overloads; inherits all other entries from V0.
 */
export const UNIVERSAL_GATEWAY_V1_SEND = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'address', name: 'token', type: 'address' },
          { internalType: 'uint256', name: 'amount', type: 'uint256' },
          { internalType: 'bytes', name: 'payload', type: 'bytes' },
          {
            internalType: 'address',
            name: 'revertRecipient',
            type: 'address',
          },
          { internalType: 'bytes', name: 'signatureData', type: 'bytes' },
        ],
        internalType: 'struct UniversalTxRequest',
        name: 'req',
        type: 'tuple',
      },
    ],
    name: 'sendUniversalTx',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'recipient', type: 'address' },
          { internalType: 'address', name: 'token', type: 'address' },
          { internalType: 'uint256', name: 'amount', type: 'uint256' },
          { internalType: 'address', name: 'gasToken', type: 'address' },
          { internalType: 'uint256', name: 'gasAmount', type: 'uint256' },
          { internalType: 'bytes', name: 'payload', type: 'bytes' },
          {
            internalType: 'address',
            name: 'revertRecipient',
            type: 'address',
          },
          { internalType: 'bytes', name: 'signatureData', type: 'bytes' },
          {
            internalType: 'uint256',
            name: 'amountOutMinETH',
            type: 'uint256',
          },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
        ],
        internalType: 'struct UniversalTokenTxRequest',
        name: 'reqToken',
        type: 'tuple',
      },
    ],
    name: 'sendUniversalTx',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

