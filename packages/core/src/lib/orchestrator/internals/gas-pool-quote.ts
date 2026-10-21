/**
 * Live Push-pool cost of an outbound gas fee. The gateway's swapAndBurnGas
 * buys exactly `gasFee` of the gas token from the WPC pool (exact output), so
 * this quote is what the swap will actually need at the current pool state.
 */
import { CHAIN_INFO } from '../../constants/chain';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { getPushChainForNetwork } from './helpers';

export const UNISWAP_V3_QUOTER_EXACT_OUTPUT_ABI = [
  {
    type: 'function' as const,
    name: 'quoteExactOutputSingle',
    inputs: [
      {
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
];

export const UNIVERSAL_CORE_SWAP_HELPERS_ABI = [
  {
    type: 'function' as const,
    name: 'WPC',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function' as const,
    name: 'uniswapV3Factory',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function' as const,
    name: 'defaultFeeTier',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint24', internalType: 'uint24' }],
    stateMutability: 'view',
  },
];

/** Exact PC (WPC wei) the gas swap needs now; undefined when it cannot be quoted. */
export async function quoteGasPoolCost(
  ctx: OrchestratorContext,
  universalCore: `0x${string}`,
  gasToken: `0x${string}`,
  gasFee: bigint
): Promise<bigint | undefined> {
  if (gasFee <= BigInt(0)) return undefined;
  const quoter =
    CHAIN_INFO[getPushChainForNetwork(ctx.pushNetwork)]?.dex?.uniV3QuoterV2;
  if (!quoter || quoter.startsWith('0xTBD')) return undefined;
  try {
    const [wpc, fee] = await Promise.all([
      ctx.pushClient.readContract<`0x${string}`>({
        address: universalCore,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'WPC',
        args: [],
      }),
      ctx.pushClient.readContract<number>({
        address: universalCore,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'defaultFeeTier',
        args: [gasToken],
      }),
    ]);
    if (!fee) return undefined;
    const quote = await ctx.pushClient.readContract<
      [bigint, bigint, number, bigint]
    >({
      address: quoter as `0x${string}`,
      abi: UNISWAP_V3_QUOTER_EXACT_OUTPUT_ABI,
      functionName: 'quoteExactOutputSingle',
      args: [
        {
          tokenIn: wpc,
          tokenOut: gasToken,
          amount: gasFee,
          fee,
          sqrtPriceLimitX96: BigInt(0),
        },
      ],
    });
    return quote[0];
  } catch (err) {
    printLog(
      ctx,
      `quoteGasPoolCost — unavailable (${
        err instanceof Error ? err.message : String(err)
      })`
    );
    return undefined;
  }
}
