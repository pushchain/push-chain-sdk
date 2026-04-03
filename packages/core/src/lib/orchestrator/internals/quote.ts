/**
 * Uniswap V3 exact-output quoting — extracted from Orchestrator.
 */

import { Abi, parseAbi } from 'viem';
import { CHAIN_INFO } from '../../constants/chain';
import { CHAIN } from '../../constants/enums';
import {
  ConversionQuote,
  MoveableToken,
  PayableToken,
} from '../../constants/tokens';
import { Utils } from '../../utils';
import { EvmClient } from '../../vm-client/evm-client';
import type { OrchestratorContext } from './context';

export async function quoteExactOutput(
  ctx: OrchestratorContext,
  amountOut: bigint,
  {
    from,
    to,
  }: {
    from: PayableToken | undefined;
    to: MoveableToken | undefined;
  }
): Promise<ConversionQuote> {
  const originChain = ctx.universalSigner.account.chain;
  if (
    originChain !== CHAIN.ETHEREUM_MAINNET &&
    originChain !== CHAIN.ETHEREUM_SEPOLIA
  ) {
    throw new Error(
      'Exact-output quoting is only supported on Ethereum Mainnet and Sepolia for now'
    );
  }

  if (!from) throw new Error('from token is required');
  if (!to) throw new Error('to token is required');

  const rpcUrls =
    ctx.rpcUrls[originChain] || CHAIN_INFO[originChain].defaultRPC;
  const evm = new EvmClient({ rpcUrls });

  const factoryFromConfig = CHAIN_INFO[originChain].dex?.uniV3Factory;
  const quoterFromConfig = CHAIN_INFO[originChain].dex?.uniV3QuoterV2;
  if (!factoryFromConfig || !quoterFromConfig) {
    throw new Error('Uniswap V3 addresses not configured for this chain');
  }
  const UNISWAP_V3_FACTORY = factoryFromConfig as `0x${string}`;
  const UNISWAP_V3_QUOTER_V2 = quoterFromConfig as `0x${string}`;

  const factoryAbi: Abi = parseAbi([
    'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)',
  ]);
  const quoterAbi: Abi = parseAbi([
    'function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  ]);
  const poolAbi: Abi = parseAbi([
    'function liquidity() view returns (uint128)',
  ]);

  const feeTiers: number[] = [100, 500, 3000, 10000];

  let bestAmountIn: bigint | null = null;
  let bestFee: number | null = null;

  for (const fee of feeTiers) {
    const poolAddress = await evm.readContract<string>({
      abi: factoryAbi,
      address: UNISWAP_V3_FACTORY,
      functionName: 'getPool',
      args: [from.address as `0x${string}`, to.address as `0x${string}`, fee],
    });

    const isZero =
      !poolAddress ||
      poolAddress.toLowerCase() ===
        '0x0000000000000000000000000000000000000000';
    if (isZero) continue;

    try {
      const liquidity = await evm.readContract<bigint>({
        abi: poolAbi,
        address: poolAddress as `0x${string}`,
        functionName: 'liquidity',
        args: [],
      });
      if (!liquidity || liquidity === BigInt(0)) continue;
    } catch {
      continue;
    }

    try {
      const result = await evm.readContract<[bigint, bigint, number, bigint]>({
        abi: quoterAbi,
        address: UNISWAP_V3_QUOTER_V2,
        functionName: 'quoteExactOutputSingle',
        args: [
          {
            tokenIn: from.address as `0x${string}`,
            tokenOut: to.address as `0x${string}`,
            amount: amountOut,
            fee,
            sqrtPriceLimitX96: BigInt(0),
          },
        ],
      });
      const amountIn = result?.[0] ?? BigInt(0);
      if (amountIn === BigInt(0)) continue;
      if (bestAmountIn === null || amountIn < bestAmountIn) {
        bestAmountIn = amountIn;
        bestFee = fee;
      }
    } catch {
      // try next fee
    }
  }

  if (bestAmountIn === null || bestFee === null) {
    throw new Error(
      'No direct Uniswap V3 pool found for the given token pair on common fee tiers'
    );
  }

  const amountInBig = BigInt(bestAmountIn);
  const amountInHuman = parseFloat(
    Utils.helpers.formatUnits(amountInBig, { decimals: from.decimals })
  );
  const amountOutHuman = parseFloat(
    Utils.helpers.formatUnits(amountOut, { decimals: to.decimals })
  );
  const rate = amountInHuman > 0 ? amountOutHuman / amountInHuman : 0;

  return {
    amountIn: bestAmountIn.toString(),
    amountOut: amountOut.toString(),
    rate,
    route: [from.symbol, to.symbol],
    timestamp: Date.now(),
  };
}
