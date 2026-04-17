/**
 * Per-route $PC/USD oracle.
 *
 * There is no on-chain $PC/USD price feed today. Per Harsh (2026-04-17),
 * derive $PC/USD from the WPC/stable Uniswap V3 pool on Push Chain, with
 * the stable leg chosen by the origin route:
 *   - Ethereum / Arbitrum / Base / BNB → WPC/USDT.<route>
 *   - Solana → WPC/USDT.sol
 *
 * Pool pair (USDT vs USDC) is pending Zaryab/Zartaj confirmation — flip the
 * ORIGIN_TO_STABLE map below if they pick USDC.
 *
 * Returns price in **8 decimals** (USD per 1 WPC) to match the convention
 * used by PriceFetch.getPrice.
 */
import { parseUnits } from 'viem';
import { UNIVERSAL_GATEWAY_PC } from '../../constants/abi';
import { CHAIN_INFO, SYNTHETIC_PUSH_ERC20 } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { getUniversalGatewayPCAddress, getPushChainForNetwork } from './helpers';

// ============================================================================
// Route → stable PRC-20 selector
// ============================================================================

type StableKey =
  | 'USDT_ETH'
  | 'USDT_ARB'
  | 'USDT_BASE'
  | 'USDT_BNB'
  | 'USDT_SOL';

/**
 * Chosen stable token per origin chain. Change these values to switch to USDC.
 * Decimals: assume 6 (standard USDT/USDC). If a PRC-20 deviates, add an entry
 * to STABLE_DECIMALS override below.
 */
const ORIGIN_TO_STABLE: Partial<Record<CHAIN, StableKey>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: 'USDT_ETH',
  [CHAIN.ARBITRUM_SEPOLIA]: 'USDT_ARB',
  [CHAIN.BASE_SEPOLIA]: 'USDT_BASE',
  [CHAIN.BNB_TESTNET]: 'USDT_BNB',
  [CHAIN.SOLANA_DEVNET]: 'USDT_SOL',
};

/** Default decimals for stable PRC-20s on Push Chain. */
const DEFAULT_STABLE_DECIMALS = 6;

// ============================================================================
// QuoterV2 ABI (same subset used elsewhere in gas-calculator.ts)
// ============================================================================

const QUOTER_V2_ABI = [
  {
    type: 'function' as const,
    name: 'quoteExactInputSingle',
    inputs: [
      {
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'view' as const,
  },
];

const UNIVERSAL_CORE_SWAP_HELPERS_ABI = [
  {
    type: 'function' as const,
    name: 'WPC',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function' as const,
    name: 'uniswapV3Factory',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function' as const,
    name: 'defaultFeeTier',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint24' }],
    stateMutability: 'view',
  },
];

const UNISWAP_V3_FACTORY_ABI = [
  {
    type: 'function' as const,
    name: 'getPool',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
    stateMutability: 'view' as const,
  },
];

/**
 * Fee tiers to probe when `defaultFeeTier(stable)` returns 0 on UniversalCore.
 * Per the 2026-04-17 testnet probe, all WPC/USDT.* stable pools live at 500.
 * Fall back through the standard Uniswap V3 tier set if 500 misses.
 */
const STABLE_FEE_TIER_FALLBACKS = [500, 3000, 100, 10000] as const;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// ============================================================================
// Cache (module-level, 30s TTL — mirrors price-fetch.ts)
// ============================================================================

const PRICE_CACHE_TTL_MS = 30_000;
type CacheEntry = { price: bigint; expiry: number };
const pcUsdPriceCache = new Map<CHAIN, CacheEntry>();

// ============================================================================
// Public API
// ============================================================================

/**
 * Get $PC/USD price (8 decimals) for the given origin chain's route.
 * Returns 0 on any failure — caller is expected to fall back to
 * pushClient.pushToUSDC (the hardcoded $0.10 rate).
 */
export async function getPcUsdPrice(
  ctx: OrchestratorContext,
  originChain: CHAIN
): Promise<bigint> {
  const cached = pcUsdPriceCache.get(originChain);
  if (cached && Date.now() < cached.expiry) {
    return cached.price;
  }

  const stableKey = ORIGIN_TO_STABLE[originChain];
  if (!stableKey) {
    printLog(
      ctx,
      `getPcUsdPrice — no stable token mapped for origin ${originChain}; returning 0`
    );
    return BigInt(0);
  }

  const pushChain = getPushChainForNetwork(ctx.pushNetwork);
  const quoterAddress = CHAIN_INFO[pushChain]?.dex?.uniV3QuoterV2;
  if (!quoterAddress || quoterAddress.startsWith('0xTBD')) {
    printLog(
      ctx,
      `getPcUsdPrice — no QuoterV2 configured for ${pushChain}; returning 0`
    );
    return BigInt(0);
  }

  const stableAddress = SYNTHETIC_PUSH_ERC20[ctx.pushNetwork]?.[stableKey];
  if (!stableAddress || stableAddress.startsWith('0xTBD')) {
    printLog(
      ctx,
      `getPcUsdPrice — no ${stableKey} mapped on ${ctx.pushNetwork}; returning 0`
    );
    return BigInt(0);
  }

  try {
    const gatewayPcAddress = getUniversalGatewayPCAddress();
    const universalCoreAddress =
      await ctx.pushClient.readContract<`0x${string}`>({
        address: gatewayPcAddress,
        abi: UNIVERSAL_GATEWAY_PC,
        functionName: 'UNIVERSAL_CORE',
        args: [],
      });

    const [wpcAddress, factoryAddress, defaultFeeTier] = await Promise.all([
      ctx.pushClient.readContract<`0x${string}`>({
        address: universalCoreAddress,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'WPC',
        args: [],
      }),
      ctx.pushClient.readContract<`0x${string}`>({
        address: universalCoreAddress,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'uniswapV3Factory',
        args: [],
      }),
      ctx.pushClient.readContract<number>({
        address: universalCoreAddress,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'defaultFeeTier',
        args: [stableAddress],
      }),
    ]);

    if (!wpcAddress) {
      printLog(ctx, `getPcUsdPrice — missing WPC; returning 0`);
      return BigInt(0);
    }

    // UniversalCore's defaultFeeTier is set only for gas tokens (pETH*, pSOL).
    // For stables, probe the factory for the first tier with a live pool.
    let feeTier = defaultFeeTier;
    if (!feeTier) {
      for (const candidate of STABLE_FEE_TIER_FALLBACKS) {
        const pool = await ctx.pushClient.readContract<`0x${string}`>({
          address: factoryAddress,
          abi: UNISWAP_V3_FACTORY_ABI,
          functionName: 'getPool',
          args: [wpcAddress, stableAddress, candidate],
        });
        if (pool && pool !== ZERO_ADDR) {
          feeTier = candidate;
          printLog(
            ctx,
            `getPcUsdPrice — resolved fee tier ${candidate} via factory probe for WPC/${stableKey}`
          );
          break;
        }
      }
    }

    if (!feeTier) {
      printLog(
        ctx,
        `getPcUsdPrice — no WPC/${stableKey} pool found at any fee tier; returning 0`
      );
      return BigInt(0);
    }

    // Quote: 1 WPC (1e18) → X stable (DEFAULT_STABLE_DECIMALS)
    const oneWpc = parseUnits('1', 18);
    const result = await ctx.pushClient.readContract<
      [bigint, bigint, number, bigint]
    >({
      address: quoterAddress as `0x${string}`,
      abi: QUOTER_V2_ABI,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn: wpcAddress,
          tokenOut: stableAddress,
          amountIn: oneWpc,
          fee: feeTier,
          sqrtPriceLimitX96: BigInt(0),
        },
      ],
    });

    const stableOut = result[0];
    if (stableOut === BigInt(0)) {
      printLog(ctx, `getPcUsdPrice — quoter returned 0 for WPC→${stableKey}`);
      return BigInt(0);
    }

    // Normalize stableOut (DEFAULT_STABLE_DECIMALS) to 8-decimal USD.
    // If stable decimals > 8, divide; otherwise multiply.
    const decDelta = 8 - DEFAULT_STABLE_DECIMALS;
    const price =
      decDelta >= 0
        ? stableOut * BigInt(10 ** decDelta)
        : stableOut / BigInt(10 ** -decDelta);

    printLog(
      ctx,
      `getPcUsdPrice — origin=${originChain} stable=${stableKey} quote: 1 WPC = ${stableOut.toString()} (${DEFAULT_STABLE_DECIMALS}d) = ${price.toString()} (1e8 USD)`
    );

    pcUsdPriceCache.set(originChain, {
      price,
      expiry: Date.now() + PRICE_CACHE_TTL_MS,
    });
    return price;
  } catch (err) {
    printLog(
      ctx,
      `getPcUsdPrice — failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return BigInt(0);
  }
}

/**
 * Convert a nPUSH (18-dec) amount to USD (8-dec) using the per-route oracle.
 * Falls back to the fixed pushToUSDC rate if the oracle returns 0.
 */
export async function pcToUsd(
  ctx: OrchestratorContext,
  pcAmount: bigint,
  originChain: CHAIN
): Promise<bigint> {
  const price = await getPcUsdPrice(ctx, originChain);
  if (price === BigInt(0)) {
    return ctx.pushClient.pushToUSDC(pcAmount);
  }
  const oneWpc = parseUnits('1', 18);
  return (pcAmount * price) / oneWpc;
}

/**
 * Convert a USD (8-dec) amount to nPUSH (18-dec) using the per-route oracle.
 * Falls back to the fixed usdcToPush rate if the oracle returns 0.
 */
export async function usdToPc(
  ctx: OrchestratorContext,
  usdAmount: bigint,
  originChain: CHAIN
): Promise<bigint> {
  const price = await getPcUsdPrice(ctx, originChain);
  if (price === BigInt(0)) {
    return ctx.pushClient.usdcToPush(usdAmount);
  }
  const oneWpc = parseUnits('1', 18);
  return (usdAmount * oneWpc + (price - BigInt(1))) / price;
}

/**
 * Test-only: clear the module-level cache. Unit tests mock `readContract`
 * and need a fresh slate between runs.
 * @internal
 */
export function __resetPcUsdCache(): void {
  pcUsdPriceCache.clear();
}

/** Re-exported for tests that need to assert chain coverage. */
export const __ORIGIN_TO_STABLE = ORIGIN_TO_STABLE;

// Reference to keep VM import used (stable decimals may differ by VM later).
void VM;
