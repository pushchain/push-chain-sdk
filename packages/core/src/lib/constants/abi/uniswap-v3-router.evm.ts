/**
 * Minimal ABI fragment for the Uniswap V3 SwapRouter deployed on Push Chain.
 *
 * Only `exactInputSingle` is used by the SDK — the gas-abstraction Case C
 * overflow-bridging flow swaps WPC → destination PRC-20 with a known WPC
 * input and a minimum acceptable PRC-20 output.
 *
 * Router address on PUSH_TESTNET_DONUT: 0x5D548bB9E305AAe0d6dc6e6fdc3ab419f6aC0037
 * (from https://push.org/agents/contract-addresses.json)
 */
export const UNIV3_SWAP_ROUTER_EVM = [
  {
    type: 'function',
    name: 'exactInputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        internalType: 'struct ISwapRouter.ExactInputSingleParams',
        components: [
          { name: 'tokenIn', type: 'address', internalType: 'address' },
          { name: 'tokenOut', type: 'address', internalType: 'address' },
          { name: 'fee', type: 'uint24', internalType: 'uint24' },
          { name: 'recipient', type: 'address', internalType: 'address' },
          { name: 'deadline', type: 'uint256', internalType: 'uint256' },
          { name: 'amountIn', type: 'uint256', internalType: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256', internalType: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160', internalType: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'payable',
  },
] as const;
