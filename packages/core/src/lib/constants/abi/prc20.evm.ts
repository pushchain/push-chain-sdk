/**
 * PRC20 ABI
 * Push Chain's PRC-20 token interface
 */
export const PRC20_EVM = [
  // Gas fee estimation (single param - uses default gas limit)
  {
    type: 'function',
    name: 'withdrawGasFeeWithGasLimit',
    inputs: [{ name: 'gasLimit', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      { name: 'gasToken', type: 'address', internalType: 'address' },
      { name: 'gasFee', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'view',
  },
  // Default gas limit
  {
    type: 'function',
    name: 'GAS_LIMIT',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  // Protocol fee
  {
    type: 'function',
    name: 'PC_PROTOCOL_FEE',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  // Source chain namespace
  {
    type: 'function',
    name: 'SOURCE_CHAIN_NAMESPACE',
    inputs: [],
    outputs: [{ name: '', type: 'string', internalType: 'string' }],
    stateMutability: 'view',
  },
] as const;

/**
 * UniversalCore ABI
 * Push Chain's UniversalCore precompile interface for gas fee estimation
 */
export const UNIVERSAL_CORE_EVM = [
  // Get gas fee for a PRC20 token with custom gas limit
  {
    type: 'function',
    name: 'withdrawGasFeeWithGasLimit',
    inputs: [
      { name: '_prc20', type: 'address', internalType: 'address' },
      { name: 'gasLimit', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [
      { name: 'gasToken', type: 'address', internalType: 'address' },
      { name: 'gasFee', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'view',
  },
  // Get gas fee for a PRC20 token (uses BASE_GAS_LIMIT)
  {
    type: 'function',
    name: 'withdrawGasFee',
    inputs: [{ name: '_prc20', type: 'address', internalType: 'address' }],
    outputs: [
      { name: 'gasToken', type: 'address', internalType: 'address' },
      { name: 'gasFee', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'view',
  },
  // Base gas limit
  {
    type: 'function',
    name: 'BASE_GAS_LIMIT',
    inputs: [],
    outputs: [{ name: 'baseGasLimit', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
] as const;
