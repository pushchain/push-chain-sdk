/**
 * Minimal ABI for the Wrapped Push Chain token (WPC) on Push Chain.
 *
 * WPC follows the canonical WETH9 interface — only `deposit()` and
 * `withdraw()` are needed on top of ERC-20 for the gas-abstraction
 * Case C overflow-bridging flow.
 */
export const WPC_EVM = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [{ name: 'wad', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;
