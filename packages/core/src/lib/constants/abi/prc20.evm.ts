/**
 * UniversalCore ABI
 * Push Chain's UniversalCore precompile interface for gas fee estimation
 */
export const UNIVERSAL_CORE_EVM = [
  // Get outbound tx gas and fees for a PRC20 token with gas limit
  {
    type: 'function',
    name: 'getOutboundTxGasAndFees',
    inputs: [
      { name: '_prc20', type: 'address', internalType: 'address' },
      { name: 'gasLimitWithBaseLimit', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [
      { name: 'gasToken', type: 'address', internalType: 'address' },
      { name: 'gasFee', type: 'uint256', internalType: 'uint256' },
      { name: 'protocolFee', type: 'uint256', internalType: 'uint256' },
      { name: 'gasPrice', type: 'uint256', internalType: 'uint256' },
      { name: 'chainNamespace', type: 'string', internalType: 'string' },
    ],
    stateMutability: 'view',
  },
  // Base gas limit (legacy global — use baseGasLimitByChainNamespace for per-chain)
  {
    type: 'function',
    name: 'BASE_GAS_LIMIT',
    inputs: [],
    outputs: [{ name: 'baseGasLimit', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  // Per-chain base gas limit
  {
    type: 'function',
    name: 'baseGasLimitByChainNamespace',
    inputs: [{ name: 'chainNamespace', type: 'string', internalType: 'string' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  // Gas price by chain namespace
  {
    type: 'function',
    name: 'gasPriceByChainNamespace',
    inputs: [{ name: 'chainNamespace', type: 'string', internalType: 'string' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  // Gas token PRC20 by chain namespace
  {
    type: 'function',
    name: 'gasTokenPRC20ByChainNamespace',
    inputs: [{ name: 'chainNamespace', type: 'string', internalType: 'string' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  // Rescue funds gas limit (returns gas details for a given PRC-20 token)
  {
    type: 'function',
    name: 'getRescueFundsGasLimit',
    inputs: [
      { name: '_prc20', type: 'address', internalType: 'address' },
    ],
    outputs: [
      { name: 'gasToken', type: 'address', internalType: 'address' },
      { name: 'gasFee', type: 'uint256', internalType: 'uint256' },
      { name: 'rescueGasLimit', type: 'uint256', internalType: 'uint256' },
      { name: 'gasPrice', type: 'uint256', internalType: 'uint256' },
      { name: 'chainNamespace', type: 'string', internalType: 'string' },
    ],
    stateMutability: 'view',
  },
  // Swap and burn gas (gateway-only)
  {
    type: 'function',
    name: 'swapAndBurnGas',
    inputs: [
      { name: 'gasToken', type: 'address', internalType: 'address' },
      { name: 'gasFee', type: 'uint256', internalType: 'uint256' },
      { name: 'protocolFee', type: 'uint256', internalType: 'uint256' },
      { name: 'vaultPC', type: 'address', internalType: 'address' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  // Errors
  {
    type: 'error',
    name: 'GasLimitBelowBase',
    inputs: [
      { name: 'provided', type: 'uint256', internalType: 'uint256' },
      { name: 'minimum', type: 'uint256', internalType: 'uint256' },
    ],
  },
] as const;
