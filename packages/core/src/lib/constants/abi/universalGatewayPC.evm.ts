/**
 * UniversalGatewayPC ABI
 * Push Chain Gateway for outbound transactions
 */
export const UNIVERSAL_GATEWAY_PC = [
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'subTxId', type: 'bytes32' },
      { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
      { indexed: false, internalType: 'string', name: 'chainNamespace', type: 'string' },
      { indexed: true, internalType: 'address', name: 'token', type: 'address' },
      { indexed: false, internalType: 'bytes', name: 'recipient', type: 'bytes' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
      { indexed: false, internalType: 'address', name: 'gasToken', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'gasFee', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'gasLimit', type: 'uint256' },
      { indexed: false, internalType: 'bytes', name: 'payload', type: 'bytes' },
      { indexed: false, internalType: 'uint256', name: 'protocolFee', type: 'uint256' },
      { indexed: false, internalType: 'address', name: 'revertRecipient', type: 'address' },
      { indexed: false, internalType: 'uint8', name: 'txType', type: 'uint8' },
      { indexed: false, internalType: 'uint256', name: 'gasPrice', type: 'uint256' },
    ],
    name: 'UniversalTxOutbound',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'oldVaultPC', type: 'address' },
      { indexed: true, internalType: 'address', name: 'newVaultPC', type: 'address' },
    ],
    name: 'VaultPCUpdated',
    type: 'event',
  },
  // Functions
  {
    inputs: [
      {
        components: [
          { internalType: 'bytes', name: 'target', type: 'bytes' },
          { internalType: 'address', name: 'token', type: 'address' },
          { internalType: 'uint256', name: 'amount', type: 'uint256' },
          { internalType: 'uint256', name: 'gasLimit', type: 'uint256' },
          { internalType: 'bytes', name: 'payload', type: 'bytes' },
          { internalType: 'address', name: 'revertRecipient', type: 'address' },
        ],
        internalType: 'struct UniversalOutboundTxRequest',
        name: 'req',
        type: 'tuple',
      },
    ],
    name: 'sendUniversalTxOutbound',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'UNIVERSAL_CORE',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
