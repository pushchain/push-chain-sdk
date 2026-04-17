/**
 * SDK 5.2 gas abstraction — Case C overflow-bridge multicall composer.
 *
 * When the sizer returns `category === 'C'` (destination gas cost > $10),
 * the SDK splits: gas-leg capped at $10, the rest bridged to the
 * destination as native value. This module encodes the three extra
 * multicall entries the UEA executes before the outbound call:
 *
 *   1. WPC.deposit{value: overflow}()              — wrap PC → WPC
 *   2. WPC.approve(SwapRouter, overflow)           — allow router to pull
 *   3. SwapRouter.exactInputSingle(WPC → destPrc20) — swap, recipient=UEA
 *
 * The swap's `amountOutMinimum` (= conservative pre-quote minus slippage)
 * is returned as `expectedPrc20Out` — callers fold this into the outbound
 * `burnAmount` so the destination CEA mints it as native to the recipient.
 *
 * Any pool slippage that lands above the floor stays in the UEA as
 * recoverable balance (not lost).
 */
import { encodeFunctionData } from 'viem';
import {
  ERC20_EVM,
  UNIVERSAL_GATEWAY_PC,
  UNIV3_SWAP_ROUTER_EVM,
  WPC_EVM,
} from '../../constants/abi';
import { CHAIN_INFO } from '../../constants/chain';
import type { MultiCall } from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { getPushChainForNetwork, getUniversalGatewayPCAddress } from './helpers';

// ============================================================================
// ABI fragments (minimal — just what bridge-swap-builder needs)
// ============================================================================

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

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SLIPPAGE_BPS = 100; // 1%
const FEE_TIER_FALLBACKS = [500, 3000, 100, 10000] as const;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// Uniswap V3 SwapRouter's checkDeadline modifier requires
// `block.timestamp <= deadline` or reverts with "Transaction too old".
// Use type(uint256).max so the swap never expires — the SDK bundles the
// swap with the outbound call in a single multicall, so deadline-based
// MEV protection isn't useful here anyway.
const SWAP_DEADLINE: bigint =
  BigInt(
    '115792089237316195423570985008687907853269984665640564039457584007913129639935'
  );

// ============================================================================
// Types
// ============================================================================

export interface BuildBridgeSwapInput {
  /** Overflow portion of native PC (== sizing.overflowNativePc). */
  overflowNativePc: bigint;
  /** Destination gas token (pETH, pBNB, pSOL, …) — recipient of the swap. */
  destinationPrc20: `0x${string}`;
  /** The UEA address on Push Chain (recipient of the swap output). */
  ueaAddress: `0x${string}`;
  /** Optional override; defaults to 100 bps (1%). */
  slippageBps?: number;
}

export interface BuildBridgeSwapOutput {
  /** Ordered multicall entries: [wrap, approve, swap]. */
  entries: MultiCall[];
  /** Conservative pre-quote output — fold this into outbound burnAmount. */
  expectedPrc20Out: bigint;
  /** Diagnostic — raw quote before slippage applied. */
  quotedPrc20Out: bigint;
  /** Diagnostic — which fee tier was used for the swap. */
  feeTier: number;
  /** Diagnostic — which WPC token address was used. */
  wpcAddress: `0x${string}`;
  /** Diagnostic — which SwapRouter was used. */
  swapRouterAddress: `0x${string}`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build the three multicall entries for Case C overflow bridging.
 * Reads chain state: UniversalCore.WPC, UniversalCore.defaultFeeTier,
 * QuoterV2.quoteExactInputSingle. All reads happen here so route handlers
 * don't duplicate fetch logic.
 */
export async function buildBridgeSwapEntries(
  ctx: OrchestratorContext,
  input: BuildBridgeSwapInput
): Promise<BuildBridgeSwapOutput> {
  const { overflowNativePc, destinationPrc20, ueaAddress } = input;
  const slippageBps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

  if (overflowNativePc <= BigInt(0)) {
    throw new Error(
      `buildBridgeSwapEntries: overflowNativePc must be > 0 (got ${overflowNativePc})`
    );
  }

  const pushChain = getPushChainForNetwork(ctx.pushNetwork);
  const dex = CHAIN_INFO[pushChain]?.dex;
  const swapRouterAddress = dex?.uniV3SwapRouter;
  const quoterAddress = dex?.uniV3QuoterV2;

  if (!swapRouterAddress || swapRouterAddress.startsWith('0xTBD')) {
    throw new Error(
      `buildBridgeSwapEntries: uniV3SwapRouter not configured for ${pushChain}`
    );
  }
  if (!quoterAddress || quoterAddress.startsWith('0xTBD')) {
    throw new Error(
      `buildBridgeSwapEntries: uniV3QuoterV2 not configured for ${pushChain}`
    );
  }

  // 1. Resolve WPC + fee tier for the WPC/destinationPrc20 pool.
  const { wpcAddress, feeTier, factoryAddress } = await resolveSwapVenue(
    ctx,
    destinationPrc20
  );

  // 2. Pre-quote the swap (exact input, single hop).
  const quoted = await ctx.pushClient.readContract<
    [bigint, bigint, number, bigint]
  >({
    address: quoterAddress as `0x${string}`,
    abi: QUOTER_V2_ABI,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn: wpcAddress,
        tokenOut: destinationPrc20,
        amountIn: overflowNativePc,
        fee: feeTier,
        sqrtPriceLimitX96: BigInt(0),
      },
    ],
  });
  const quotedPrc20Out = quoted[0];
  if (quotedPrc20Out === BigInt(0)) {
    throw new Error(
      `buildBridgeSwapEntries: QuoterV2 returned 0 for WPC→${destinationPrc20} ` +
        `at fee ${feeTier} — pool may be illiquid`
    );
  }
  // Conservative floor: quotedOut * (10000 - slippageBps) / 10000.
  const expectedPrc20Out =
    (quotedPrc20Out * BigInt(10000 - slippageBps)) / BigInt(10000);

  printLog(
    ctx,
    `buildBridgeSwapEntries — overflow=${overflowNativePc}, ` +
      `feeTier=${feeTier}, quotedOut=${quotedPrc20Out}, ` +
      `expectedOut(after ${slippageBps}bps)=${expectedPrc20Out}`
  );

  // 3. Encode the three multicall entries.
  const wrapData = encodeFunctionData({
    abi: WPC_EVM,
    functionName: 'deposit',
    args: [],
  });
  const approveData = encodeFunctionData({
    abi: ERC20_EVM,
    functionName: 'approve',
    args: [swapRouterAddress, overflowNativePc],
  });
  const swapData = encodeFunctionData({
    abi: UNIV3_SWAP_ROUTER_EVM,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: wpcAddress,
        tokenOut: destinationPrc20,
        fee: feeTier,
        recipient: ueaAddress,
        deadline: SWAP_DEADLINE,
        amountIn: overflowNativePc,
        amountOutMinimum: expectedPrc20Out,
        sqrtPriceLimitX96: BigInt(0),
      },
    ],
  });

  const entries: MultiCall[] = [
    { to: wpcAddress, value: overflowNativePc, data: wrapData },
    { to: wpcAddress, value: BigInt(0), data: approveData },
    {
      to: swapRouterAddress as `0x${string}`,
      value: BigInt(0),
      data: swapData,
    },
  ];
  void factoryAddress; // preserved for debugging logs if ever needed

  return {
    entries,
    expectedPrc20Out,
    quotedPrc20Out,
    feeTier,
    wpcAddress,
    swapRouterAddress: swapRouterAddress as `0x${string}`,
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Resolve `wpcAddress` + `feeTier` for the WPC/token pool on Push Chain.
 * Uses UniversalCore.defaultFeeTier first; if 0, falls back to probing the
 * factory across known fee tiers.
 */
async function resolveSwapVenue(
  ctx: OrchestratorContext,
  token: `0x${string}`
): Promise<{
  wpcAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  feeTier: number;
}> {
  const gatewayPcAddress = getUniversalGatewayPCAddress();
  const universalCoreAddress = await ctx.pushClient.readContract<`0x${string}`>(
    {
      address: gatewayPcAddress,
      abi: UNIVERSAL_GATEWAY_PC,
      functionName: 'UNIVERSAL_CORE',
      args: [],
    }
  );

  const [wpcAddress, factoryAddress, defaultTier] = await Promise.all([
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
      args: [token],
    }),
  ]);

  if (!wpcAddress) {
    throw new Error(`buildBridgeSwapEntries: UniversalCore.WPC returned zero`);
  }

  let feeTier = defaultTier;
  if (!feeTier) {
    for (const candidate of FEE_TIER_FALLBACKS) {
      const pool = await ctx.pushClient.readContract<`0x${string}`>({
        address: factoryAddress,
        abi: UNISWAP_V3_FACTORY_ABI,
        functionName: 'getPool',
        args: [wpcAddress, token, candidate],
      });
      if (pool && pool !== ZERO_ADDR) {
        feeTier = candidate;
        break;
      }
    }
  }
  if (!feeTier) {
    throw new Error(
      `buildBridgeSwapEntries: no WPC/${token} pool found at any known fee tier`
    );
  }

  return { wpcAddress, factoryAddress, feeTier };
}
