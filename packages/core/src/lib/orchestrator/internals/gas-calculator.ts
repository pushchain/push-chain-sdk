/**
 * Gas fee queries, native amount calculations, ERC-20 allowance,
 * and Uniswap V3 quoting — extracted from Orchestrator.
 */

import { PublicKey } from '@solana/web3.js';
import { Abi, encodeFunctionData, stringToBytes } from 'viem';
import { rpcSection } from '../../__debug_rpc_tracker';
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

/** Buffer multiplier for nativeValueForGas. Excess is refunded by swapAndBurnGas to the UEA. */
const GAS_FEE_BUFFER_MULTIPLIER = BigInt(1000000);

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
  rpcSection(`ensureErc20Allowance | token=${tokenAddress.slice(0,10)} spender=${spender.slice(0,10)} required=${requiredAmount}`);
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
  gasLimit: bigint
): Promise<{ gasToken: `0x${string}`; gasFee: bigint; protocolFee: bigint; nativeValueForGas: bigint; gasPrice: bigint }> {
  rpcSection(`queryOutboundGasFee | prc20=${prc20Token.slice(0,10)} gasLimit=${gasLimit} — 2 readContract calls`);
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
  let gasPrice: bigint = BigInt(0);
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

  const nativeValueForGas = protocolFee + gasFee * GAS_FEE_BUFFER_MULTIPLIER;
  printLog(ctx, `queryOutboundGasFee — [step 5] using 1000000x buffer: nativeValueForGas=${nativeValueForGas}`);

  return { gasToken, gasFee, protocolFee, nativeValueForGas, gasPrice };
}

// ============================================================================
// Rescue Gas Fee Query
// ============================================================================

export async function queryRescueGasFee(
  ctx: OrchestratorContext,
  prc20Token: `0x${string}`
): Promise<{ gasToken: `0x${string}`; gasFee: bigint; rescueGasLimit: bigint; gasPrice: bigint; nativeValueForGas: bigint }> {
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

  const nativeValueForGas = gasFee * GAS_FEE_BUFFER_MULTIPLIER;
  printLog(ctx, `queryRescueGasFee — using 1000000x buffer: nativeValueForGas=${nativeValueForGas}`);

  return { gasToken, gasFee, rescueGasLimit, gasPrice, nativeValueForGas };
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
  rpcSection(`calculateNativeAmountForDeposit | chain=${chain} — PriceFetch(new EvmClient)`);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_02_01);

  const oneUsd = Utils.helpers.parseUnits('1', 8);
  const tenUsd = Utils.helpers.parseUnits('10', 8);
  const deficit =
    requiredFunds > ueaBalance ? requiredFunds - ueaBalance : BigInt(0);
  let depositUsd =
    deficit > BigInt(0) ? ctx.pushClient.pushToUSDC(deficit) : oneUsd;

  if (depositUsd < oneUsd) depositUsd = oneUsd;
  if (depositUsd > tenUsd)
    throw new Error('Deposit value exceeds max $10 worth of native token');

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

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_02_02, nativeAmount);

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
