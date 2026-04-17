/**
 * Gas fee queries, native amount calculations, ERC-20 allowance,
 * and Uniswap V3 quoting — extracted from Orchestrator.
 */

import { PublicKey } from '@solana/web3.js';
import { Abi, encodeFunctionData, stringToBytes } from 'viem';
import {
  ERC20_EVM,
  SVM_GATEWAY_IDL,
  UNIVERSAL_GATEWAY_PC,
  UNIVERSAL_CORE_EVM,
} from '../../constants/abi';
import { CHAIN_INFO } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import {
  ConversionQuote,
  MOVEABLE_TOKENS,
  MoveableToken,
  PAYABLE_TOKENS,
  PayableToken,
} from '../../constants/tokens';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { PriceFetch } from '../../price-fetch/price-fetch';
import { Utils } from '../../utils';
import { EvmClient } from '../../vm-client/evm-client';
import { SvmClient } from '../../vm-client/svm-client';
import type { OrchestratorContext } from './context';
import { printLog, fireProgressHook } from './context';
import { getUniversalGatewayPCAddress, getPushChainForNetwork } from './helpers';
import {
  sizeOutboundGas,
  type GasSizingDecision,
} from './gas-usd-sizer';

/**
 * Legacy fallback buffer used ONLY when the caller does not supply a
 * `destinationChain` and the USD sizer cannot be invoked. New code paths
 * should always pass `destinationChain` so gas is sized against the real
 * dollar cost (SDK 5.2). Excess is refunded by swapAndBurnGas to the UEA.
 */
const GAS_FEE_BUFFER_MULTIPLIER = BigInt(1000000);

// Minimal ABIs for Uniswap V3 pool price estimation
const UNISWAP_V3_POOL_SLOT0_ABI = [
  {
    type: 'function' as const,
    name: 'slot0',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160', internalType: 'uint160' },
      { name: 'tick', type: 'int24', internalType: 'int24' },
      { name: 'observationIndex', type: 'uint16', internalType: 'uint16' },
      { name: 'observationCardinality', type: 'uint16', internalType: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16', internalType: 'uint16' },
      { name: 'feeProtocol', type: 'uint8', internalType: 'uint8' },
      { name: 'unlocked', type: 'bool', internalType: 'bool' },
    ],
    stateMutability: 'view',
  },
];

const UNISWAP_V3_FACTORY_ABI = [
  {
    type: 'function' as const,
    name: 'getPool',
    inputs: [
      { name: 'tokenA', type: 'address', internalType: 'address' },
      { name: 'tokenB', type: 'address', internalType: 'address' },
      { name: 'fee', type: 'uint24', internalType: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
];

const UNIVERSAL_CORE_SWAP_HELPERS_ABI = [
  { type: 'function' as const, name: 'WPC', inputs: [], outputs: [{ name: '', type: 'address', internalType: 'address' }], stateMutability: 'view' },
  { type: 'function' as const, name: 'uniswapV3Factory', inputs: [], outputs: [{ name: '', type: 'address', internalType: 'address' }], stateMutability: 'view' },
  { type: 'function' as const, name: 'defaultFeeTier', inputs: [{ name: '', type: 'address', internalType: 'address' }], outputs: [{ name: '', type: 'uint24', internalType: 'uint24' }], stateMutability: 'view' },
];

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// ============================================================================
// ERC-20 Allowance
// ============================================================================

export async function ensureErc20Allowance(
  ctx: OrchestratorContext,
  evmClient: EvmClient,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
  requiredAmount: bigint
): Promise<void> {
  const chain = ctx.universalSigner.account.chain;
  const owner = ctx.universalSigner.account.address as `0x${string}`;

  const currentAllowance = await evmClient.readContract<bigint>({
    abi: ERC20_EVM as Abi,
    address: tokenAddress,
    functionName: 'allowance',
    args: [owner, spender],
  });

  if (currentAllowance >= requiredAmount) return;

  if (currentAllowance > BigInt(0)) {
    printLog(ctx, `Resetting existing allowance from ${currentAllowance.toString()} to 0 for spender ${spender}`);
    const resetTxHash = await evmClient.writeContract({
      abi: ERC20_EVM as Abi,
      address: tokenAddress,
      functionName: 'approve',
      args: [spender, BigInt(0)],
      signer: ctx.universalSigner,
    });
    await evmClient.waitForConfirmations({
      txHash: resetTxHash,
      confirmations: 1,
      timeoutMs: CHAIN_INFO[chain].timeout,
    });
  }

  const setTxHash = await evmClient.writeContract({
    abi: ERC20_EVM as Abi,
    address: tokenAddress,
    functionName: 'approve',
    args: [spender, requiredAmount],
    signer: ctx.universalSigner,
  });

  await evmClient.waitForConfirmations({
    txHash: setTxHash,
    confirmations: 1,
    timeoutMs: CHAIN_INFO[chain].timeout,
  });

  try {
    const updated = await evmClient.readContract<bigint>({
      abi: ERC20_EVM as Abi,
      address: tokenAddress,
      functionName: 'allowance',
      args: [owner, spender],
    });
    if (updated < requiredAmount) {
      printLog(ctx, 'Warning: allowance not updated yet; proceeding');
    }
  } catch {
    // ignore
  }
}

// ============================================================================
// Outbound Gas Fee Query
// ============================================================================

export async function queryOutboundGasFee(
  ctx: OrchestratorContext,
  prc20Token: `0x${string}`,
  gasLimit: bigint,
  destinationChain?: CHAIN
): Promise<{ gasToken: `0x${string}`; gasFee: bigint; protocolFee: bigint; nativeValueForGas: bigint; gasPrice: bigint; universalCoreAddress: `0x${string}`; sizing?: GasSizingDecision }> {
  const gatewayPcAddress = getUniversalGatewayPCAddress();
  const pushChain = getPushChainForNetwork(ctx.pushNetwork);
  const rpcUrl = CHAIN_INFO[pushChain]?.defaultRPC?.[0] || 'unknown';

  printLog(ctx, `queryOutboundGasFee — [step 1] inputs: gateway=${gatewayPcAddress}, prc20Token=${prc20Token}, gasLimit=${gasLimit}, rpcUrl=${rpcUrl}`);

  let universalCoreAddress: `0x${string}`;
  try {
    universalCoreAddress = await ctx.pushClient.readContract<`0x${string}`>({
      address: gatewayPcAddress,
      abi: UNIVERSAL_GATEWAY_PC,
      functionName: 'UNIVERSAL_CORE',
      args: [],
    });
    printLog(ctx, `queryOutboundGasFee — [step 2] UNIVERSAL_CORE resolved to: ${universalCoreAddress}`);
  } catch (err) {
    printLog(ctx, `queryOutboundGasFee — [step 2] FAILED to read UNIVERSAL_CORE: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  const callData = encodeFunctionData({
    abi: UNIVERSAL_CORE_EVM,
    functionName: 'getOutboundTxGasAndFees',
    args: [prc20Token, gasLimit],
  });
  printLog(ctx, `queryOutboundGasFee — [step 3] calling getOutboundTxGasAndFees on ${universalCoreAddress}`);
  printLog(ctx, `queryOutboundGasFee — [step 3] eth_call: {"method":"eth_call","params":[{"to":"${universalCoreAddress}","data":"${callData}"},"latest"]}`);

  let gasToken: `0x${string}`;
  let gasFee: bigint;
  let protocolFee: bigint;
  let gasPrice = BigInt(0);
  try {
    const result = await ctx.pushClient.readContract<[`0x${string}`, bigint, bigint, bigint, string]>({
      address: universalCoreAddress,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'getOutboundTxGasAndFees',
      args: [prc20Token, gasLimit],
    });
    gasToken = result[0];
    gasFee = result[1];
    protocolFee = result[2];
    gasPrice = result[3];
    printLog(ctx, `queryOutboundGasFee — [step 4] success: gasToken=${gasToken}, gasFee=${gasFee}, protocolFee=${protocolFee}, gasPrice=${gasPrice}`);
  } catch (err) {
    printLog(ctx, `queryOutboundGasFee — [step 3] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  let nativeValueForGas: bigint;
  let sizing: GasSizingDecision | undefined;

  if (destinationChain !== undefined) {
    try {
      sizing = await sizeOutboundGas(ctx, {
        gasFee,
        originChain: ctx.universalSigner.account.chain,
        destinationChain,
      });
      // All categories — A, B, and C — return the sizer's calibrated gas leg.
      // For Case C, the overflow is handled separately by route-handlers.ts,
      // which composes `bridgeSwapEntries` on the UEA multicall before the
      // outbound call (see bridge-swap-builder.ts).
      nativeValueForGas = sizing.gasLegNativePc + protocolFee;
      printLog(
        ctx,
        `queryOutboundGasFee — [step 5] sizer: category=${sizing.category}, gasUsd=${sizing.gasUsd}, ` +
          `gasLegNativePc=${sizing.gasLegNativePc}, overflowNativePc=${sizing.overflowNativePc}, nativeValueForGas=${nativeValueForGas}`
      );
    } catch (err) {
      printLog(
        ctx,
        `queryOutboundGasFee — [step 5] sizer failed (${err instanceof Error ? err.message : String(err)}); falling back to 1M buffer`
      );
      nativeValueForGas = protocolFee + gasFee * GAS_FEE_BUFFER_MULTIPLIER;
    }
  } else {
    nativeValueForGas = protocolFee + gasFee * GAS_FEE_BUFFER_MULTIPLIER;
    printLog(
      ctx,
      `queryOutboundGasFee — [step 5] no destinationChain provided; legacy 1M buffer: nativeValueForGas=${nativeValueForGas}`
    );
  }

  return { gasToken, gasFee, protocolFee, nativeValueForGas, gasPrice, universalCoreAddress, sizing };
}

// ============================================================================
// Uniswap V3 Pool Price Estimation
// ============================================================================

/**
 * Estimate the native WPC amount needed to swap for `gasFee` of `gasToken`
 * by reading the Uniswap V3 pool price on Push Chain.
 * Returns the estimated amount with a 2x safety buffer (excess is refunded by the contract).
 * Falls back to a percentage of accountBalance if any on-chain query fails.
 */
export async function estimateNativeValueForSwap(
  ctx: OrchestratorContext,
  universalCoreAddress: `0x${string}`,
  gasToken: `0x${string}`,
  gasFee: bigint,
  accountBalance: bigint
): Promise<bigint> {
  const SWAP_BUFFER = BigInt(2); // 2x safety buffer; excess is refunded by swapAndBurnGas
  const BALANCE_FALLBACK_DIVISOR = BigInt(10); // 10% of balance as fallback
  const GAS_RESERVE = BigInt(3e18); // 3 UPC reserve for tx overhead

  try {
    // Read WPC, factory, and defaultFeeTier in parallel
    const [wpcAddress, factoryAddress, feeTier] = await Promise.all([
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
        args: [gasToken],
      }),
    ]);

    if (!feeTier) {
      printLog(ctx, `estimateNativeValueForSwap — no fee tier for gasToken, using balance fallback`);
      return balanceFallback(accountBalance, BALANCE_FALLBACK_DIVISOR, GAS_RESERVE);
    }

    // Get pool address from factory
    const poolAddress = await ctx.pushClient.readContract<`0x${string}`>({
      address: factoryAddress,
      abi: UNISWAP_V3_FACTORY_ABI,
      functionName: 'getPool',
      args: [wpcAddress, gasToken, feeTier],
    });

    if (poolAddress === ZERO_ADDR) {
      printLog(ctx, `estimateNativeValueForSwap — pool not found, using balance fallback`);
      return balanceFallback(accountBalance, BALANCE_FALLBACK_DIVISOR, GAS_RESERVE);
    }

    // Read slot0 for current price
    const slot0 = await ctx.pushClient.readContract<
      [bigint, number, number, number, number, number, boolean]
    >({
      address: poolAddress,
      abi: UNISWAP_V3_POOL_SLOT0_ABI,
      functionName: 'slot0',
      args: [],
    });
    const sqrtPriceX96 = slot0[0];
    if (!sqrtPriceX96 || sqrtPriceX96 === BigInt(0)) {
      printLog(ctx, `estimateNativeValueForSwap — pool not initialized, using balance fallback`);
      return balanceFallback(accountBalance, BALANCE_FALLBACK_DIVISOR, GAS_RESERVE);
    }

    // price (token1/token0 in raw units) = (sqrtPriceX96)² / 2¹⁹²
    const Q192 = BigInt(1) << BigInt(192);
    const priceNum = sqrtPriceX96 * sqrtPriceX96; // sqrtPrice² in Q192

    // Uniswap V3 sorts tokens: token0 < token1 by address
    const isGasTokenToken0 = gasToken.toLowerCase() < wpcAddress.toLowerCase();

    let wpcNeeded: bigint;
    if (isGasTokenToken0) {
      // price = WPC_per_gasToken → wpcNeeded = gasFee * price
      wpcNeeded = (gasFee * priceNum) / Q192;
    } else {
      // price = gasToken_per_WPC → wpcNeeded = gasFee / price
      wpcNeeded = (gasFee * Q192) / priceNum;
    }

    const result = wpcNeeded * SWAP_BUFFER;
    printLog(
      ctx,
      `estimateNativeValueForSwap — pool=${poolAddress}, sqrtPriceX96=${sqrtPriceX96}, ` +
        `wpcNeeded=${wpcNeeded}, withBuffer(2x)=${result}`
    );

    // Cap at (balance - reserve)
    if (accountBalance > result + GAS_RESERVE) {
      return result;
    } else if (accountBalance > GAS_RESERVE) {
      return accountBalance - GAS_RESERVE;
    }
    return result; // let caller decide if balance is too low
  } catch (err) {
    printLog(
      ctx,
      `estimateNativeValueForSwap — failed: ${err instanceof Error ? err.message : String(err)}, using balance fallback`
    );
    return balanceFallback(accountBalance, BALANCE_FALLBACK_DIVISOR, GAS_RESERVE);
  }
}

function balanceFallback(balance: bigint, divisor: bigint, reserve: bigint): bigint {
  const fraction = balance / divisor;
  if (balance > fraction + reserve) return fraction;
  if (balance > reserve) return balance - reserve;
  return fraction;
}

// ============================================================================
// Rescue Gas Fee Query
// ============================================================================

export async function queryRescueGasFee(
  ctx: OrchestratorContext,
  prc20Token: `0x${string}`,
  destinationChain?: CHAIN
): Promise<{ gasToken: `0x${string}`; gasFee: bigint; rescueGasLimit: bigint; gasPrice: bigint; nativeValueForGas: bigint; sizing?: GasSizingDecision }> {
  const gatewayPcAddress = getUniversalGatewayPCAddress();

  printLog(ctx, `queryRescueGasFee — inputs: gateway=${gatewayPcAddress}, prc20Token=${prc20Token}`);

  let universalCoreAddress: `0x${string}`;
  try {
    universalCoreAddress = await ctx.pushClient.readContract<`0x${string}`>({
      address: gatewayPcAddress,
      abi: UNIVERSAL_GATEWAY_PC,
      functionName: 'UNIVERSAL_CORE',
      args: [],
    });
    printLog(ctx, `queryRescueGasFee — UNIVERSAL_CORE resolved to: ${universalCoreAddress}`);
  } catch (err) {
    printLog(ctx, `queryRescueGasFee — FAILED to read UNIVERSAL_CORE: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  let gasToken: `0x${string}`;
  let gasFee: bigint;
  let rescueGasLimit: bigint;
  let gasPrice: bigint;
  try {
    const result = await ctx.pushClient.readContract<[`0x${string}`, bigint, bigint, bigint, string]>({
      address: universalCoreAddress,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'getRescueFundsGasLimit',
      args: [prc20Token],
    });
    gasToken = result[0];
    gasFee = result[1];
    rescueGasLimit = result[2];
    gasPrice = result[3];
    printLog(ctx, `queryRescueGasFee — success: gasToken=${gasToken}, gasFee=${gasFee}, rescueGasLimit=${rescueGasLimit}, gasPrice=${gasPrice}`);
  } catch (err) {
    printLog(ctx, `queryRescueGasFee — FAILED: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  let nativeValueForGas: bigint;
  let sizing: GasSizingDecision | undefined;

  if (destinationChain !== undefined) {
    try {
      sizing = await sizeOutboundGas(ctx, {
        gasFee,
        originChain: ctx.universalSigner.account.chain,
        destinationChain,
      });
      nativeValueForGas = sizing.gasLegNativePc;
      printLog(
        ctx,
        `queryRescueGasFee — sizer: category=${sizing.category}, gasUsd=${sizing.gasUsd}, nativeValueForGas=${nativeValueForGas}`
      );
    } catch (err) {
      printLog(
        ctx,
        `queryRescueGasFee — sizer failed (${err instanceof Error ? err.message : String(err)}); falling back to 1M buffer`
      );
      nativeValueForGas = gasFee * GAS_FEE_BUFFER_MULTIPLIER;
    }
  } else {
    nativeValueForGas = gasFee * GAS_FEE_BUFFER_MULTIPLIER;
    printLog(
      ctx,
      `queryRescueGasFee — no destinationChain provided; legacy 1M buffer: nativeValueForGas=${nativeValueForGas}`
    );
  }

  return { gasToken, gasFee, rescueGasLimit, gasPrice, nativeValueForGas, sizing };
}

// ============================================================================
// Native Amount Calculation for Deposit
// ============================================================================

export async function calculateNativeAmountForDeposit(
  ctx: OrchestratorContext,
  chain: CHAIN,
  requiredFunds: bigint,
  ueaBalance: bigint
): Promise<bigint> {
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_102_01);

  const oneUsd = Utils.helpers.parseUnits('1', 8);
  const maxUsd = Utils.helpers.parseUnits('1000', 8);
  const deficit =
    requiredFunds > ueaBalance ? requiredFunds - ueaBalance : BigInt(0);
  let depositUsd =
    deficit > BigInt(0) ? ctx.pushClient.pushToUSDC(deficit) : oneUsd;

  if (depositUsd < oneUsd) depositUsd = oneUsd;
  if (depositUsd > maxUsd)
    throw new Error('Deposit value exceeds max $1000 worth of native token');

  if (CHAIN_INFO[chain].vm === VM.SVM) {
    const svmClient = new SvmClient({
      rpcUrls:
        ctx.rpcUrls[CHAIN.SOLANA_DEVNET] ||
        CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
    });
    const programId = new PublicKey(SVM_GATEWAY_IDL.address);
    const [configPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('config')],
      programId
    );
    try {
      const cfg: any = await svmClient.readContract({
        abi: SVM_GATEWAY_IDL,
        address: SVM_GATEWAY_IDL.address,
        functionName: 'config',
        args: [configPda.toBase58()],
      });
      const minField = cfg.minCapUniversalTxUsd ?? cfg.min_cap_universal_tx_usd;
      const maxField = cfg.maxCapUniversalTxUsd ?? cfg.max_cap_universal_tx_usd;
      const minCapUsd = BigInt(minField.toString());
      const maxCapUsd = BigInt(maxField.toString());
      if (depositUsd < minCapUsd) depositUsd = minCapUsd;
      const withMargin = (minCapUsd * BigInt(12)) / BigInt(10);
      if (depositUsd < withMargin) depositUsd = withMargin;
      if (depositUsd > maxCapUsd) depositUsd = maxCapUsd;
    } catch {
      // best-effort
    }
  }

  const nativeTokenUsdPrice = await new PriceFetch(ctx.rpcUrls).getPrice(chain);
  const nativeDecimals = CHAIN_INFO[chain].vm === VM.SVM ? 9 : 18;
  const oneNativeUnit = Utils.helpers.parseUnits('1', nativeDecimals);
  let nativeAmount =
    (depositUsd * oneNativeUnit + (nativeTokenUsdPrice - BigInt(1))) /
    nativeTokenUsdPrice;
  nativeAmount = nativeAmount + BigInt(1);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_102_02, nativeAmount);

  return nativeAmount;
}

// ============================================================================
// ERC-20 Gas Amount from Exact Output Quote
// ============================================================================

export async function calculateGasAmountFromAmountOutMinETH(
  ctx: OrchestratorContext,
  gasTokenAddress: `0x${string}`,
  amountOutMinETH: bigint | string,
  quoteExactOutputFn: (amountOut: bigint, opts: { from: PayableToken | undefined; to: MoveableToken | undefined }) => Promise<ConversionQuote>
): Promise<{ gasAmount: bigint }> {
  const originChain = ctx.universalSigner.account.chain;
  if (
    originChain !== CHAIN.ETHEREUM_SEPOLIA &&
    originChain !== CHAIN.ARBITRUM_SEPOLIA &&
    originChain !== CHAIN.BASE_SEPOLIA
  ) {
    throw new Error(
      'Gas payment in ERC-20 is supported only on Ethereum Sepolia, Arbitrum Sepolia, and Base Sepolia for now'
    );
  }

  const WETH = CHAIN_INFO[originChain].dex?.weth;
  if (!WETH) throw new Error('WETH address not configured for this chain');

  let gasAmount: bigint;
  if (gasTokenAddress.toLowerCase() === WETH.toLowerCase()) {
    gasAmount = BigInt(amountOutMinETH);
  } else {
    const fromList = PAYABLE_TOKENS[originChain] ?? [];
    const fromToken: PayableToken | undefined = fromList.find(
      (t) => (t.address || '').toLowerCase() === gasTokenAddress.toLowerCase()
    );
    const toList = (MOVEABLE_TOKENS[originChain] ?? []) as MoveableToken[];
    const toToken: MoveableToken | undefined = toList.find(
      (t) =>
        t.symbol === 'WETH' ||
        (t.address || '').toLowerCase() === (WETH || '').toLowerCase()
    );

    if (!fromToken || !toToken) {
      throw new Error('Token not supported for quoting');
    }

    const targetOut = BigInt(amountOutMinETH);
    const exactOutQuote = await quoteExactOutputFn(targetOut, {
      from: fromToken,
      to: toToken,
    });
    const requiredIn = BigInt(exactOutQuote.amountIn);
    gasAmount = (requiredIn * BigInt(101)) / BigInt(100);
  }

  return { gasAmount };
}

// ============================================================================
// Estimate UPC deposit from locked ETH via Uniswap V3 quote
// ============================================================================

/**
 * Predicts how much UPC (WPC) the chain will deposit to the UEA from a given
 * amount of locked native token (e.g., ETH on Sepolia). The chain converts
 * locked ETH → pETH (PRC-20) → WPC via Uniswap V3 swap on Push Chain.
 *
 * Queries the same Uniswap V3 QuoterV2 the chain uses in execute_inbound_gas.go.
 * Returns 0 on any failure (caller should fall back to other logic).
 */
export async function estimateDepositFromLockedNative(
  ctx: OrchestratorContext,
  nativeAmountForLocker: bigint,
  prc20Token: `0x${string}`
): Promise<bigint> {
  try {
    const pushChain = getPushChainForNetwork(ctx.pushNetwork);
    const quoterAddress = CHAIN_INFO[pushChain]?.dex?.uniV3QuoterV2;
    if (!quoterAddress || quoterAddress.startsWith('0xTBD')) return BigInt(0);

    // Get UniversalCore → WPC address + fee tier (reuses existing ABI)
    const gatewayPcAddress = getUniversalGatewayPCAddress();
    const universalCoreAddress = await ctx.pushClient.readContract<`0x${string}`>({
      address: gatewayPcAddress,
      abi: UNIVERSAL_GATEWAY_PC,
      functionName: 'UNIVERSAL_CORE',
      args: [],
    });

    const [wpcAddress, feeTier] = await Promise.all([
      ctx.pushClient.readContract<`0x${string}`>({
        address: universalCoreAddress,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'WPC',
        args: [],
      }),
      ctx.pushClient.readContract<number>({
        address: universalCoreAddress,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'defaultFeeTier',
        args: [prc20Token],
      }),
    ]);

    if (!feeTier || !wpcAddress) return BigInt(0);

    // QuoterV2.quoteExactInputSingle — same call the chain relay makes
    const QUOTER_ABI = [
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

    const result = await ctx.pushClient.readContract<[bigint, bigint, number, bigint]>({
      address: quoterAddress as `0x${string}`,
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn: prc20Token,
          tokenOut: wpcAddress,
          amountIn: nativeAmountForLocker,
          fee: feeTier,
          sqrtPriceLimitX96: BigInt(0),
        },
      ],
    });

    const amountOut = result[0];
    printLog(ctx,
      `estimateDepositFromLockedNative — quote: ${nativeAmountForLocker.toString()} pETH → ${amountOut.toString()} WPC (fee tier: ${feeTier})`
    );
    return amountOut;
  } catch (err) {
    printLog(ctx,
      `estimateDepositFromLockedNative — failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return BigInt(0);
  }
}

/**
 * Inverse of estimateDepositFromLockedNative: given a desired WPC output,
 * asks the Push Chain Uniswap V3 pool how much native PRC-20 (pETH) input is
 * required to produce exactly that output via QuoterV2.quoteExactOutputSingle.
 *
 * Used to size fee-lock deposits against the real on-chain pool rate instead
 * of the fixed $0.10/PC SDK rate. Returns 0 on any failure (caller should
 * fall back to the fixed-rate sizing).
 */
export async function estimateNativeForDesiredDeposit(
  ctx: OrchestratorContext,
  desiredWpc: bigint,
  prc20Token: `0x${string}`
): Promise<bigint> {
  try {
    if (desiredWpc <= BigInt(0)) return BigInt(0);

    const pushChain = getPushChainForNetwork(ctx.pushNetwork);
    const quoterAddress = CHAIN_INFO[pushChain]?.dex?.uniV3QuoterV2;
    if (!quoterAddress || quoterAddress.startsWith('0xTBD')) return BigInt(0);

    const gatewayPcAddress = getUniversalGatewayPCAddress();
    const universalCoreAddress = await ctx.pushClient.readContract<`0x${string}`>({
      address: gatewayPcAddress,
      abi: UNIVERSAL_GATEWAY_PC,
      functionName: 'UNIVERSAL_CORE',
      args: [],
    });

    const [wpcAddress, feeTier] = await Promise.all([
      ctx.pushClient.readContract<`0x${string}`>({
        address: universalCoreAddress,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'WPC',
        args: [],
      }),
      ctx.pushClient.readContract<number>({
        address: universalCoreAddress,
        abi: UNIVERSAL_CORE_SWAP_HELPERS_ABI,
        functionName: 'defaultFeeTier',
        args: [prc20Token],
      }),
    ]);

    if (!feeTier || !wpcAddress) return BigInt(0);

    const QUOTER_ABI = [
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
        stateMutability: 'view' as const,
      },
    ];

    const result = await ctx.pushClient.readContract<[bigint, bigint, number, bigint]>({
      address: quoterAddress as `0x${string}`,
      abi: QUOTER_ABI,
      functionName: 'quoteExactOutputSingle',
      args: [
        {
          tokenIn: prc20Token,
          tokenOut: wpcAddress,
          amount: desiredWpc,
          fee: feeTier,
          sqrtPriceLimitX96: BigInt(0),
        },
      ],
    });

    const amountIn = result[0];
    printLog(ctx,
      `estimateNativeForDesiredDeposit — quote: ${desiredWpc.toString()} WPC ← ${amountIn.toString()} pETH (fee tier: ${feeTier})`
    );
    return amountIn;
  } catch (err) {
    printLog(ctx,
      `estimateNativeForDesiredDeposit — failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return BigInt(0);
  }
}
