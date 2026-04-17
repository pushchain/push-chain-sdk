/**
 * Route handler functions extracted from Orchestrator.
 *
 * Each function corresponds to one of the multichain execution routes:
 *   - executeMultiChain  (dispatch)
 *   - executeUoaToCea    (Route 2 EVM)
 *   - executeUoaToCeaSvm (Route 2 SVM)
 *   - executeCeaToPush   (Route 3 EVM)
 *   - executeCeaToPushSvm(Route 3 SVM)
 *   - executeCeaToCea    (Route 4 stub)
 *   - buildPayloadForRoute
 *
 * Every method receives an `OrchestratorContext` as first parameter and an
 * `executeFn` callback that replaces the former `this.execute()` call.
 */

import { PublicKey } from '@solana/web3.js';
import {
  encodeFunctionData,
  hexToBytes,
  zeroAddress,
} from 'viem';

import type { OrchestratorContext } from './context';
import { printLog, fireProgressHook } from './context';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import {
  isPushChain,
  getChainNamespace,
  getNativePRC20ForChain,
  getUniversalGatewayPCAddress,
  toExecuteParams,
} from './helpers';
import {
  buildUniversalTxRequest,
  buildMulticallPayloadData,
} from './payload-builder';
import {
  computeUEAOffchain,
  getUEANonce,
} from './uea-manager';
import {
  queryOutboundGasFee,
  estimateNativeValueForSwap,
  estimateDepositFromLockedNative,
} from './gas-calculator';

import { CHAIN_INFO, VM_NAMESPACE, UNIVERSAL_GATEWAY_ADDRESSES } from '../../constants/chain';
import { CHAIN } from '../../constants/enums';
import { MoveableToken } from '../../constants/tokens';
import { Utils } from '../../utils';
import { PriceFetch } from '../../price-fetch/price-fetch';
import { TransactionRoute, detectRoute, validateRouteParams, GasExceedsCategoryCWithErc20FundsError } from '../route-detector';
import { buildBridgeSwapEntries } from './bridge-swap-builder';
import { getCEAAddress, chainSupportsOutbound } from '../cea-utils';
import { buildSvmPayloadFromParams } from '../svm-idl/build-payload';
import {
  buildExecuteMulticall,
  buildCeaMulticallPayload,
  buildInboundUniversalPayload,
  buildOutboundRequest,
  buildSendUniversalTxToUEA,
  buildOutboundApprovalAndCall,
  buildMigrationPayload,
  isSvmChain,
  isValidSolanaHexAddress,
  encodeSvmExecutePayload,
  encodeSvmCeaToUeaPayload,
} from '../payload-builders';
import { ZERO_ADDRESS } from '../../constants/selectors';
import { ERC20_EVM } from '../../constants/abi/erc20.evm';
import { PushChain } from '../../push-chain/push-chain';
import type {
  ChainTarget,
  ExecuteParams,
  MultiCall,
  UniversalExecuteParams,
  UniversalOutboundTxRequest,
  UniversalTxRequest,
  UniversalTxResponse,
} from '../orchestrator.types';

// ---------------------------------------------------------------------------
// Callback type for this.execute() replacement
// ---------------------------------------------------------------------------

type ExecuteFn = (
  params: ExecuteParams | UniversalExecuteParams
) => Promise<UniversalTxResponse>;

// ---------------------------------------------------------------------------
// Sizing progress hook fan-out
// ---------------------------------------------------------------------------

import type { GasSizingDecision } from './gas-usd-sizer';

const SIZER_HOOK_BY_ROUTE = {
  R2: {
    A: PROGRESS_HOOK.SEND_TX_202_03_A,
    B: PROGRESS_HOOK.SEND_TX_202_03_B,
    C: PROGRESS_HOOK.SEND_TX_202_03_C,
  },
  R3: {
    A: PROGRESS_HOOK.SEND_TX_302_03_A,
    B: PROGRESS_HOOK.SEND_TX_302_03_B,
    C: PROGRESS_HOOK.SEND_TX_302_03_C,
  },
} as const;

/**
 * Fire the route-scoped sizing progress hook based on the sizer's decision.
 * Case C carries the overflow amount as an extra arg so UIs can render the
 * bridge leg separately.
 */
function fireSizingHook(
  ctx: OrchestratorContext,
  route: 'R2' | 'R3',
  chain: CHAIN,
  sizing: GasSizingDecision
): void {
  const hook = SIZER_HOOK_BY_ROUTE[route][sizing.category];
  if (sizing.category === 'C') {
    fireProgressHook(
      ctx,
      hook,
      chain,
      sizing.gasUsd,
      sizing.gasLegNativePc,
      sizing.overflowNativePc
    );
  } else {
    fireProgressHook(ctx, hook, chain, sizing.gasUsd, sizing.gasLegNativePc);
  }
}

// ---------------------------------------------------------------------------
// executeMultiChain
// ---------------------------------------------------------------------------

/**
 * Dispatch a universal execution to the correct route handler.
 */
export async function executeMultiChain(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {
  // Validate route parameters
  validateRouteParams(params, {
    clientChain: ctx.universalSigner.account.chain,
  });

  // Detect the transaction route
  const route = detectRoute(params);

  printLog(
    ctx,
    `executeMultiChain — detected route: ${route}, params: ${JSON.stringify(
      {
        to:
          typeof params.to === 'string'
            ? params.to
            : { address: params.to.address, chain: params.to.chain },
        from: params.from,
        hasValue: params.value !== undefined,
        hasData: params.data !== undefined,
        hasFunds: params.funds !== undefined,
      },
      null,
      2
    )}`
  );

  let response: UniversalTxResponse;

  switch (route) {
    case TransactionRoute.UOA_TO_PUSH:

      response = await executeFn(toExecuteParams(params));
      break;

    case TransactionRoute.UOA_TO_CEA:

      response = await executeUoaToCea(ctx, params, executeFn);
      break;

    case TransactionRoute.CEA_TO_PUSH:

      response = await executeCeaToPush(ctx, params, executeFn);
      break;

    case TransactionRoute.CEA_TO_CEA:

      response = await executeCeaToCea(ctx, params, executeFn);
      break;

    default:
      throw new Error(`Unknown transaction route: ${route}`);
  }

  // Set the route on the response for .wait() to use
  response.route = route;

  return response;
}

// ---------------------------------------------------------------------------
// executeUoaToCea  (Route 2 — EVM)
// ---------------------------------------------------------------------------

/**
 * Route 2: Execute outbound transaction from Push Chain to external CEA.
 *
 * Builds a multicall that executes on Push Chain (from UEA context):
 * 1. Approves the gateway to spend PRC-20 tokens (if needed)
 * 2. Calls sendUniversalTxOutbound on UniversalGatewayPC precompile
 *
 * The multicall is executed through the normal execute() flow which handles
 * fee-locking on the origin chain and signature verification.
 */
export async function executeUoaToCea(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {

  const target = params.to as ChainTarget;
  const targetChain = target.chain;
  const targetAddress = target.address;
  const isSvm = isSvmChain(targetChain);

  // Validate target address based on VM type
  if (isSvm) {
    // SVM: 32-byte hex address
    if (!isValidSolanaHexAddress(targetAddress)) {
      throw new Error(
        `Invalid Solana address: ${targetAddress}. ` +
          `Expected 0x + 64 hex chars (32 bytes).`
      );
    }
    const ZERO_32 = ('0x' + '0'.repeat(64)) as `0x${string}`;
    if (targetAddress.toLowerCase() === ZERO_32.toLowerCase()) {
      throw new Error(
        `Cannot send to zero address on Solana. ` +
          `This would result in permanent loss of funds.`
      );
    }
  } else {
    // EVM: 20-byte hex address
    // Zero address is allowed for multicall (data is array) — the actual targets are in the data entries.
    const isMulticall = Array.isArray(params.data);
    if (targetAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase() && !isMulticall) {
      throw new Error(
        `Cannot send to zero address (0x0000...0000). ` +
          `This would result in permanent loss of funds.`
      );
    }
  }

  // Validate chain supports outbound operations
  if (!chainSupportsOutbound(targetChain)) {
    throw new Error(
      `Chain ${targetChain} does not support outbound operations. ` +
        `Supported chains: BNB_TESTNET, ETHEREUM_SEPOLIA, SOLANA_DEVNET, etc.`
    );
  }

  // Branch based on VM type
  if (isSvm) {
    return executeUoaToCeaSvm(ctx, params, target, executeFn);
  }

  // ===== EVM path (existing logic) =====

  // R2 pre-broadcast progress: external chain detected
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_201, targetChain, targetAddress);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_203_01, targetChain);

  // Get UEA address
  const ueaAddress = computeUEAOffchain(ctx);

  printLog(
    ctx,
    `executeUoaToCea — target chain: ${targetChain}, target address: ${targetAddress}, UEA: ${ueaAddress}`
  );

  // Get CEA address for this UEA on target chain
  const { cea: ceaAddress, isDeployed: ceaDeployed } = await getCEAAddress(
    ueaAddress,
    targetChain,
    ctx.rpcUrls[targetChain]?.[0]
  );

  fireProgressHook(
    ctx,
    PROGRESS_HOOK.SEND_TX_203_02,
    ueaAddress,
    ceaAddress,
    targetChain,
    ceaDeployed
  );

  printLog(
    ctx,
    `executeUoaToCea — CEA address: ${ceaAddress}, deployed: ${ceaDeployed}`
  );

  // Migration path: raw MIGRATION_SELECTOR payload, no multicall wrapping
  let ceaPayload: `0x${string}`;
  let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let burnAmount = BigInt(0);

  if (params.migration) {
    ceaPayload = buildMigrationPayload();
    prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
    burnAmount = BigInt(0); // Migration is logic-only — no funds. CEA rejects msg.value != 0.
    printLog(
      ctx,
      `executeUoaToCea — MIGRATION: using raw MIGRATION_SELECTOR payload (${ceaPayload}), native PRC-20 ${prc20Token}`
    );
  } else {
    // Build multicall for CEA execution on target chain
    const ceaMulticalls: MultiCall[] = [];

    // If there's data to execute on target
    if (params.data) {
      if (Array.isArray(params.data)) {
        // User provided explicit multicall array
        ceaMulticalls.push(...(params.data as MultiCall[]));
      } else {
        // When ERC-20 funds are provided with a single payload, auto-prepend a
        // transfer() call so the tokens minted to the CEA are forwarded to the
        // target address. This mirrors the Route 1 behavior in buildExecuteMulticall.
        if (params.funds?.amount) {
          const token = (params.funds as { token: MoveableToken }).token;
          if (token && token.mechanism !== 'native') {
            const erc20Transfer = encodeFunctionData({
              abi: ERC20_EVM,
              functionName: 'transfer',
              args: [targetAddress, params.funds.amount],
            });
            ceaMulticalls.push({
              to: token.address as `0x${string}`,
              value: BigInt(0),
              data: erc20Transfer,
            });
          }
        }
        // Single call with data. Forward native value (if any) so the target
        // contract receives it alongside the payload call. The vault deposits
        // native value to the CEA, and the multicall forwards it to the target.
        ceaMulticalls.push({
          to: targetAddress as `0x${string}`,
          value: params.value ?? BigInt(0),
          data: params.data as `0x${string}`,
        });
      }
    } else if (params.value) {
      // Native value transfer only.
      // If sending to the CEA itself, skip the multicall — the gateway deposits native
      // value directly to CEA. A self-call with value would revert (CEA._handleMulticall
      // rejects value-bearing self-calls).
      if (targetAddress.toLowerCase() !== ceaAddress.toLowerCase()) {
        ceaMulticalls.push({
          to: targetAddress as `0x${string}`,
          value: params.value,
          data: '0x',
        });
      }
    }

    // Build CEA multicall payload (this is what gets executed on the external chain)
    ceaPayload = buildCeaMulticallPayload(ceaMulticalls);

    // Determine token to burn on Push Chain
    // NOTE: Even for PAYLOAD-only (no value), we need a valid PRC-20 token to:
    // 1. Look up the target chain namespace in the gateway
    // 2. Query and pay gas fees for the relay
    if (params.funds?.amount) {
      // User explicitly specified funds with token
      const token = (params.funds as { token: MoveableToken }).token;
      if (token) {
        prc20Token = PushChain.utils.tokens.getPRC20Address(token);
        burnAmount = params.funds.amount;
      }
    } else if (params.value && params.value > BigInt(0)) {
      // Native value transfer: auto-select the PRC-20 token for target chain
      prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
      burnAmount = params.value;
      printLog(
        ctx,
        `executeUoaToCea — auto-selected native PRC-20 ${prc20Token} for chain ${targetChain}, amount: ${burnAmount.toString()}`
      );
    } else if (params.data) {
      // PAYLOAD-only (no value transfer): still need native token for chain namespace + gas fees
      prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
      burnAmount = BigInt(0);
      printLog(
        ctx,
        `executeUoaToCea — PAYLOAD-only: using native PRC-20 ${prc20Token} for chain ${targetChain} with zero burn amount`
      );
    }
  }

  // Build outbound request struct for the gateway
  // NOTE: `target` is a LEGACY/DUMMY parameter for contract compatibility.
  // The deployed UniversalGatewayPC still expects this field, but the relay does NOT use it
  // to determine the actual destination. The relay determines destination from the PRC-20 token's
  // SOURCE_CHAIN_NAMESPACE. We pass the CEA address as a non-zero placeholder.
  // This field will be removed in future contract upgrades.
  const targetBytes = ceaAddress; // Dummy value - any non-zero address works

  const outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
    targetBytes,
    prc20Token,
    burnAmount,
    params.gasLimit ?? BigInt(0),
    ceaPayload,
    ueaAddress // revert recipient is the UEA
  );

  printLog(
    ctx,
    `executeUoaToCea — outbound request: ${JSON.stringify(
      {
        target: outboundReq.target,
        token: outboundReq.token,
        amount: outboundReq.amount.toString(),
        gasLimit: outboundReq.gasLimit.toString(),
        payloadLength: outboundReq.payload.length,
        revertRecipient: outboundReq.revertRecipient,
      },
      null,
      2
    )}`
  );

  // Get UniversalGatewayPC address
  const gatewayPcAddress = getUniversalGatewayPCAddress();

  // Pre-fetch UEA status early — balance is needed for gas value calculation
  const signerChain = ctx.universalSigner.account.chain;
  const isNativePushEOA = isPushChain(signerChain);
  const [ueaCode, ueaBalance] = await Promise.all([
    ctx.pushClient.publicClient.getCode({ address: ueaAddress }),
    ctx.pushClient.getBalance(ueaAddress),
  ]);
  const isUEADeployed = isNativePushEOA || ueaCode !== undefined;
  const ueaNonce = (!isUEADeployed || isNativePushEOA) ? BigInt(0) : await getUEANonce(ctx, ueaAddress);

  // Build the multicall that will execute ON Push Chain from UEA context
  // This includes: 1) approve PRC-20 (if needed), 2) call sendUniversalTxOutbound
  const pushChainMulticalls: MultiCall[] = [];

  // Query gas fee from UniversalCore contract (needed for approval amount)
  let gasFee = BigInt(0);
  let protocolFee = BigInt(0);
  let nativeValueForGas = BigInt(0);
  let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let universalCoreAddress: `0x${string}` | undefined;
  let sizingDecision: GasSizingDecision | undefined;
  if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_202_01, targetChain);
    try {
      const result = await queryOutboundGasFee(ctx, prc20Token, outboundReq.gasLimit, targetChain);
      gasFee = result.gasFee;
      protocolFee = result.protocolFee;
      gasToken = result.gasToken;
      nativeValueForGas = result.nativeValueForGas;
      universalCoreAddress = result.universalCoreAddress;
      sizingDecision = result.sizing;
      printLog(
        ctx,
        `executeUoaToCea — queried gas fee: ${gasFee.toString()}, gasToken: ${gasToken}, nativeValueForGas: ${nativeValueForGas.toString()}, sizing=${result.sizing?.category ?? 'legacy'}`
      );
      fireProgressHook(
        ctx,
        PROGRESS_HOOK.SEND_TX_202_02,
        targetChain,
        protocolFee,
        gasFee
      );
      if (result.sizing) {
        fireSizingHook(ctx, 'R2', targetChain, result.sizing);
      }
    } catch (err) {
      throw new Error(`Failed to query outbound gas fee: ${err}`);
    }
  }

  // ---------------------------------------------------------------------
  // Native-value selection (SDK 5.2 gas abstraction)
  //
  // queryOutboundGasFee returns a sizer-calibrated `nativeValueForGas`
  // for Case A/B (USD-anchored). Case C falls back to the legacy 1M
  // buffer pending contract-team work.
  //
  // We cross-check against the actual WPC/gasToken Uniswap V3 pool price
  // (estimateNativeValueForSwap) and take the MAX — if the pool demands
  // more PC to produce `gasFee` of the destination gas token than the
  // USD-oracle sizer predicts, trust the pool. Over-send is safe;
  // under-send reverts on the swap.
  //
  // If the UEA can't afford the target, fall back to the legacy
  // balance-starved behavior so the SDK stays compatible with drained
  // and fresh-wallet scenarios.
  // ---------------------------------------------------------------------
  const EVM_GAS_RESERVE = BigInt(3e18); // 3 UPC for outer-tx gas
  const EVM_NATIVE_VALUE_SAFETY_CAP = BigInt(200e18); // 200 UPC absolute ceiling
  const ROUTE2_MINIMUM_DEPOSIT_USD = Utils.helpers.parseUnits('10', 8); // $10

  // Effective balance: real for deployed UEAs; predicted post-fee-lock for fresh.
  let effectiveBalance = ueaBalance;
  if (!isUEADeployed && effectiveBalance <= EVM_GAS_RESERVE) {
    const ethPrice = await new PriceFetch(ctx.rpcUrls).getPrice(signerChain);
    const nativeAmountETH = ethPrice > BigInt(0)
      ? (ROUTE2_MINIMUM_DEPOSIT_USD * BigInt(1e18) + (ethPrice - BigInt(1))) / ethPrice + BigInt(1)
      : BigInt(0);
    if (nativeAmountETH > BigInt(0)) {
      const originPrc20 = getNativePRC20ForChain(signerChain, ctx.pushNetwork);
      const predictedUPC = await estimateDepositFromLockedNative(ctx, nativeAmountETH, originPrc20);
      if (predictedUPC > BigInt(0)) {
        // 10% safety margin for slippage between quote and actual execution
        effectiveBalance = (predictedUPC * BigInt(90)) / BigInt(100);
        printLog(ctx,
          `executeUoaToCea — fresh wallet: Uniswap quote predicts ${predictedUPC.toString()} UPC ` +
          `from ${nativeAmountETH.toString()} wei pETH, using ${effectiveBalance.toString()} (90%)`
        );
      }
    }
  }

  // Pool-price floor — what the WPC/pETH pool actually needs.
  // Passes ueaBalance as the fallback cap; excess is refunded post-swap.
  if (universalCoreAddress && gasFee > BigInt(0)) {
    const swapFloor = await estimateNativeValueForSwap(
      ctx, universalCoreAddress, gasToken, gasFee, effectiveBalance
    );
    if (swapFloor > nativeValueForGas) {
      printLog(ctx,
        `executeUoaToCea — pool-price floor (${swapFloor.toString()}) exceeds sizer ` +
        `(${nativeValueForGas.toString()}); using pool floor`
      );
      nativeValueForGas = swapFloor;
    }
  }

  // Hard safety cap so a broken pool price can't drain the UEA.
  if (nativeValueForGas > EVM_NATIVE_VALUE_SAFETY_CAP) {
    printLog(ctx,
      `executeUoaToCea — capping nativeValueForGas at 200 UPC ceiling (was ${nativeValueForGas.toString()})`
    );
    nativeValueForGas = EVM_NATIVE_VALUE_SAFETY_CAP;
  }

  let adjustedValue: bigint;
  if (effectiveBalance >= nativeValueForGas + EVM_GAS_RESERVE) {
    // Happy path: balance covers the calibrated value + outer-tx reserve.
    adjustedValue = nativeValueForGas;
  } else if (effectiveBalance > EVM_GAS_RESERVE) {
    // Balance-starved: send everything we can afford. swapAndBurnGas
    // refunds unused; undershoot will revert with a concrete error.
    adjustedValue = effectiveBalance - EVM_GAS_RESERVE;
  } else if (effectiveBalance > BigInt(0)) {
    // Drained UEA: overshoot would return (false, "") and surface as an
    // opaque ExecutionFailed() — clamp to what we have.
    adjustedValue = effectiveBalance < nativeValueForGas ? effectiveBalance : nativeValueForGas;
  } else {
    throw new Error(
      `UEA ${ueaAddress} has zero UPC balance; cannot fund outbound gas swap. ` +
      `Bridge UPC to the UEA before retrying.`
    );
  }

  if (adjustedValue !== nativeValueForGas) {
    printLog(ctx,
      `executeUoaToCea — adjusting nativeValueForGas from ${nativeValueForGas.toString()} ` +
      `to ${adjustedValue.toString()} (effective balance: ${effectiveBalance.toString()})`
    );
    nativeValueForGas = adjustedValue;
  }

  // Case C overflow bridging: if gasUsd > $10, split into $10 gas leg +
  // overflow bridged via WPC→pETH swap on the SwapRouter. Composed as
  // three prepended multicall entries; the swap-derived pETH is folded
  // into the outbound burnAmount so the destination CEA mints it as
  // native to the recipient.
  let bridgeSwapEntries: MultiCall[] | undefined;
  let extraBurnAmount: bigint | undefined;
  if (
    sizingDecision?.category === 'C' &&
    sizingDecision.overflowNativePc > BigInt(0) &&
    prc20Token !== (ZERO_ADDRESS as `0x${string}`)
  ) {
    const fundsToken = params.funds?.token;
    if (fundsToken && fundsToken.mechanism !== 'native') {
      throw new GasExceedsCategoryCWithErc20FundsError(fundsToken.symbol);
    }
    const swap = await buildBridgeSwapEntries(ctx, {
      overflowNativePc: sizingDecision.overflowNativePc,
      destinationPrc20: prc20Token,
      ueaAddress,
    });
    bridgeSwapEntries = swap.entries;
    extraBurnAmount = swap.expectedPrc20Out;
    printLog(
      ctx,
      `executeUoaToCea — Case C bridge-swap composed: overflow=${sizingDecision.overflowNativePc}, ` +
        `expectedPrc20Out=${swap.expectedPrc20Out}, feeTier=${swap.feeTier}`
    );
  }

  // Build outbound multicalls (approve burn + sendUniversalTxOutbound with native value)
  const outboundMulticalls = buildOutboundApprovalAndCall({
    prc20Token,
    gasToken,
    burnAmount,
    gasFee,
    nativeValueForGas,
    gatewayPcAddress,
    outboundRequest: outboundReq,
    bridgeSwapEntries,
    extraBurnAmount,
  });
  pushChainMulticalls.push(...outboundMulticalls);

  printLog(
    ctx,
    `executeUoaToCea — Push Chain multicall has ${pushChainMulticalls.length} operations`
  );

  // TODO: Enable pre-flight balance checks once outbound flow is stable
  // if (burnAmount > BigInt(0)) {
  //   const prc20Balance = await ctx.pushClient.publicClient.readContract({
  //     address: prc20Token,
  //     abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
  //     functionName: 'balanceOf',
  //     args: [ueaAddress],
  //   }) as bigint;
  //   if (prc20Balance < burnAmount) {
  //     throw new Error(
  //       `Insufficient PRC-20 token balance on UEA. ` +
  //       `Required: ${burnAmount.toString()}, Available: ${prc20Balance.toString()}, ` +
  //       `Token: ${prc20Token}, UEA: ${ueaAddress}. ` +
  //       `Please bridge tokens to Push Chain first.`
  //     );
  //   }
  // }
  // const currentUeaBalance = await ctx.pushClient.getBalance(ueaAddress);
  // if (currentUeaBalance < nativeValueForGas) {
  //   throw new Error(
  //     `Insufficient native balance on UEA for outbound gas. ` +
  //     `Required: ${nativeValueForGas.toString()} wei, Available: ${currentUeaBalance.toString()} wei, ` +
  //     `UEA: ${ueaAddress}. Please send UPC to your UEA first.`
  //   );
  // }

  // Execute through the normal execute() flow
  // This handles fee-locking on origin chain and executes the multicall from UEA context
  // Sum native values from multicall entries for proper fee calculation
  const multicallNativeValue = pushChainMulticalls.reduce(
    (sum, mc) => sum + (mc.value ?? BigInt(0)),
    BigInt(0)
  );

  const executeParams: ExecuteParams = {
    to: ueaAddress, // multicall executes from UEA
    value: multicallNativeValue, // ensures correct requiredFunds calculation
    data: pushChainMulticalls, // array triggers multicall mode
    _ueaStatus: {
      isDeployed: isUEADeployed,
      nonce: ueaNonce,
      balance: ueaBalance,
    },
    _skipFeeLocking: isUEADeployed, // skip fee-locking only if UEA is already deployed
    // For undeployed UEAs, ensure fee-locking deposits enough for the outbound swap
    ...(!isUEADeployed ? { _minimumDepositUsd: ROUTE2_MINIMUM_DEPOSIT_USD } : {}),
  };

  // R2 broadcast marker — emitted just before the inner executeFn dispatches
  // to Push Chain. Replaces the suppressed 107 emission for this route.
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_207, targetChain);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_01);
  let response: UniversalTxResponse;
  try {
    response = await executeFn(executeParams);
  } catch (err) {
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_204_04,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_02);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_03);

  // Add chain info to response
  response.chain = targetChain;
  response.chainNamespace = getChainNamespace(targetChain);

  return response;
}

// ---------------------------------------------------------------------------
// executeUoaToCeaSvm  (Route 2 — SVM)
// ---------------------------------------------------------------------------

/**
 * Route 2 for SVM targets: Outbound from Push Chain to Solana.
 *
 * Three cases:
 * 1. Withdraw SOL: Burn pSOL on Push Chain, recipient gets native SOL
 * 2. Withdraw SPL: Burn PRC-20 on Push Chain, recipient gets SPL token
 * 3. Execute (CPI): Burn pSOL + execute CPI on target Solana program
 */
export async function executeUoaToCeaSvm(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  target: ChainTarget,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {
  const targetChain = target.chain;
  const targetAddress = target.address; // 0x-prefixed, 32 bytes
  const ueaAddress = computeUEAOffchain(ctx);

  // R2 pre-broadcast progress (SVM)
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_201, targetChain, targetAddress);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_203_01, targetChain);
  fireProgressHook(
    ctx,
    PROGRESS_HOOK.SEND_TX_203_02,
    ueaAddress,
    targetAddress,
    targetChain,
    true
  );

  const {
    svmPayload,
    targetBytes,
    hasExecute: hasSvmExecute,
  } = buildSvmPayloadFromParams({
    data: params.data,
    to: target,
    senderUea: ueaAddress,
  });

  printLog(
    ctx,
    `executeUoaToCeaSvm — target: ${targetAddress}, chain: ${targetChain}, ` +
      `hasSvmExecute: ${hasSvmExecute}, value: ${params.value?.toString() ?? '0'}`
  );

  if (hasSvmExecute) {
    printLog(
      ctx,
      `executeUoaToCeaSvm — encoded execute payload: ${
        (svmPayload.length - 2) / 2
      } bytes`
    );
  }

  // --- Determine PRC-20 token and burn amount ---
  let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let burnAmount = BigInt(0);

  if (params.funds?.amount) {
    // User explicitly specified funds with token
    const token = (params.funds as { token: MoveableToken }).token;
    if (token) {
      prc20Token = PushChain.utils.tokens.getPRC20Address(token);
      burnAmount = params.funds.amount;
    }
  } else if (params.value && params.value > BigInt(0)) {
    // Native value transfer: auto-select pSOL for Solana chains
    prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
    burnAmount = params.value;
    printLog(
      ctx,
      `executeUoaToCeaSvm — auto-selected native PRC-20 ${prc20Token} for chain ${targetChain}, amount: ${burnAmount.toString()}`
    );
  } else if (hasSvmExecute) {
    // Execute-only (no value): check if user specified an SPL token context
    const token = params.funds && (params.funds as { token: MoveableToken }).token;
    if (token) {
      prc20Token = PushChain.utils.tokens.getPRC20Address(token);
    } else {
      prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
    }
    burnAmount = BigInt(0);
    printLog(
      ctx,
      `executeUoaToCeaSvm — EXECUTE-only: using PRC-20 ${prc20Token} with zero burn amount`
    );
  }

  // --- Build outbound request ---
  // targetBytes: for execute = program id (resolver output); for withdraw = to.address
  const outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
    targetBytes,
    prc20Token,
    burnAmount,
    params.gasLimit ?? BigInt(0),
    svmPayload,
    ueaAddress // revert recipient is the UEA
  );

  printLog(
    ctx,
    `executeUoaToCeaSvm — outbound request: ${JSON.stringify(
      {
        target: outboundReq.target,
        token: outboundReq.token,
        amount: outboundReq.amount.toString(),
        gasLimit: outboundReq.gasLimit.toString(),
        payloadLength: (outboundReq.payload.length - 2) / 2,
        revertRecipient: outboundReq.revertRecipient,
      },
      null,
      2
    )}`
  );

  // --- Pre-fetch UEA status early — balance is needed for gas value calculation ---
  const gatewayPcAddress = getUniversalGatewayPCAddress();
  const signerChainSvm = ctx.universalSigner.account.chain;
  const isNativePushEOASvm = isPushChain(signerChainSvm);
  // Skip getCode if accountStatusCache already confirmed deployment
  const deployedHintSvm = ctx.accountStatusCache?.uea?.deployed;
  let ueaBalance: bigint;
  let isUEADeployed: boolean;
  if (deployedHintSvm || isNativePushEOASvm) {
    isUEADeployed = true;
    ueaBalance = await ctx.pushClient.getBalance(ueaAddress);
  } else {
    const [ueaCode, balance] = await Promise.all([
      ctx.pushClient.publicClient.getCode({ address: ueaAddress }),
      ctx.pushClient.getBalance(ueaAddress),
    ]);
    isUEADeployed = ueaCode !== undefined;
    ueaBalance = balance;
  }
  const ueaNonce = (!isUEADeployed || isNativePushEOASvm) ? BigInt(0) : await getUEANonce(ctx, ueaAddress);

  // --- Query gas fee (identical to EVM path) ---
  let gasFee = BigInt(0);
  let protocolFeeSvm = BigInt(0);
  let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let universalCoreAddress: `0x${string}` | undefined;
  let sizingDecision: GasSizingDecision | undefined;

  let nativeValueForGas = BigInt(0);
  if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
    const gasLimit = outboundReq.gasLimit;
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_202_01, targetChain);
    try {
      const result = await queryOutboundGasFee(ctx, prc20Token, gasLimit, targetChain);
      gasFee = result.gasFee;
      protocolFeeSvm = result.protocolFee;
      gasToken = result.gasToken;
      nativeValueForGas = result.nativeValueForGas;
      universalCoreAddress = result.universalCoreAddress;
      sizingDecision = result.sizing;
      // When user omits gasLimit (sent as 0), the contract computes fees using its internal
      // baseGasLimitByChainNamespace. But the relay reads the stored gasLimit=0 from the
      // on-chain outbound record and uses it as the Solana compute budget — 0 CU means the
      // relay cannot execute the tx. Derive the effective limit from gasFee/gasPrice so
      // the stored record has a non-zero compute budget the relay can use.
      if (!params.gasLimit && result.gasPrice > BigInt(0)) {
        outboundReq.gasLimit = result.gasFee / result.gasPrice;
        printLog(
          ctx,
          `executeUoaToCeaSvm — derived effectiveGasLimit: ${outboundReq.gasLimit} (gasFee=${result.gasFee} / gasPrice=${result.gasPrice})`
        );
      }
      printLog(
        ctx,
        `executeUoaToCeaSvm — queried gas fee: ${gasFee.toString()}, gasToken: ${gasToken}, nativeValueForGas: ${nativeValueForGas.toString()}`
      );
      fireProgressHook(
        ctx,
        PROGRESS_HOOK.SEND_TX_202_02,
        targetChain,
        protocolFeeSvm,
        gasFee
      );
      if (result.sizing) {
        fireSizingHook(ctx, 'R2', targetChain, result.sizing);
      }
    } catch (err) {
      throw new Error(`Failed to query outbound gas fee: ${err}`);
    }
  }

  // Estimate the actual WPC needed for the swap using on-chain pool price.
  // The static 1Mx multiplier from queryOutboundGasFee doesn't reflect the real
  // WPC/gasToken exchange rate. estimateNativeValueForSwap reads the Uniswap V3
  // pool's slot0, computes the true cost, and adds a 2x buffer.
  // Excess msg.value is refunded by the contract's swapAndBurnGas.
  if (universalCoreAddress && gasFee > BigInt(0)) {
    const estimated = await estimateNativeValueForSwap(
      ctx, universalCoreAddress, gasToken, gasFee, ueaBalance
    );
    if (estimated > nativeValueForGas) {
      printLog(
        ctx,
        `executeUoaToCeaSvm — adjusting nativeValueForGas from ${nativeValueForGas.toString()} to ${estimated.toString()} (pool-price estimate, UEA balance: ${ueaBalance.toString()})`
      );
      nativeValueForGas = estimated;
    }
  }

  // Case C overflow bridging (SDK 5.2). SVM destinations still use the
  // SwapRouter + WPC wrap on Push Chain — same builder as EVM.
  let bridgeSwapEntriesSvm: MultiCall[] | undefined;
  let extraBurnAmountSvm: bigint | undefined;
  if (
    sizingDecision?.category === 'C' &&
    sizingDecision.overflowNativePc > BigInt(0) &&
    prc20Token !== (ZERO_ADDRESS as `0x${string}`)
  ) {
    const fundsToken = params.funds?.token;
    if (fundsToken && fundsToken.mechanism !== 'native') {
      throw new GasExceedsCategoryCWithErc20FundsError(fundsToken.symbol);
    }
    const swap = await buildBridgeSwapEntries(ctx, {
      overflowNativePc: sizingDecision.overflowNativePc,
      destinationPrc20: prc20Token,
      ueaAddress,
    });
    bridgeSwapEntriesSvm = swap.entries;
    extraBurnAmountSvm = swap.expectedPrc20Out;
    printLog(
      ctx,
      `executeUoaToCeaSvm — Case C bridge-swap composed: overflow=${sizingDecision.overflowNativePc}, ` +
        `expectedPrc20Out=${swap.expectedPrc20Out}, feeTier=${swap.feeTier}`
    );
  }

  // --- Build Push Chain multicalls (approve + sendUniversalTxOutbound) ---
  // Reuse the same builder as EVM — this part is identical
  const pushChainMulticalls: MultiCall[] = buildOutboundApprovalAndCall({
    prc20Token,
    gasToken,
    burnAmount,
    gasFee,
    bridgeSwapEntries: bridgeSwapEntriesSvm,
    extraBurnAmount: extraBurnAmountSvm,
    nativeValueForGas,
    gatewayPcAddress,
    outboundRequest: outboundReq,
  });

  printLog(
    ctx,
    `executeUoaToCeaSvm — Push Chain multicall has ${pushChainMulticalls.length} operations`
  );

  // Sum native values from multicall entries for proper fee calculation
  const multicallNativeValue = pushChainMulticalls.reduce(
    (sum, mc) => sum + (mc.value ?? BigInt(0)),
    BigInt(0)
  );

  const executeParams: ExecuteParams = {
    to: ueaAddress,
    value: multicallNativeValue, // ensures correct requiredFunds calculation
    data: pushChainMulticalls,
    _ueaStatus: {
      isDeployed: isUEADeployed,
      nonce: ueaNonce,
      balance: ueaBalance,
    },
    _skipFeeLocking: isUEADeployed, // skip fee-locking only if UEA is already deployed
  };

  // R2 broadcast marker (SVM)
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_207, targetChain);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_01);
  let response: UniversalTxResponse;
  try {
    response = await executeFn(executeParams);
  } catch (err) {
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_204_04,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_02);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_03);

  // Add chain info to response
  response.chain = targetChain;
  response.chainNamespace = getChainNamespace(targetChain);

  return response;
}

// ---------------------------------------------------------------------------
// executeCeaToPush  (Route 3 — EVM)
// ---------------------------------------------------------------------------

/**
 * Route 3: Execute inbound transaction from CEA to Push Chain.
 *
 * This route instructs CEA on an external chain to call sendUniversalTxFromCEA,
 * bridging funds/payloads back to Push Chain.
 *
 * Flow:
 * 1. Build multicall for CEA: [approve Gateway (if ERC20), sendUniversalTxFromCEA]
 * 2. Execute via Route 2 (UOA -> CEA) with PAYLOAD-only (CEA uses its own funds)
 * 3. CEA executes multicall, Gateway locks funds, relayer mints PRC-20 on Push Chain
 */
export async function executeCeaToPush(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {

  // 1. Validate and extract source chain
  if (!params.from?.chain) {
    throw new Error('Route 3 (CEA -> Push) requires from.chain to specify the source CEA chain');
  }
  const sourceChain = params.from.chain;

  // SVM chains use a fundamentally different flow (gateway self-call, not CEA multicall)
  if (isSvmChain(sourceChain)) {
    return executeCeaToPushSvm(ctx, params, sourceChain, executeFn);
  }

  // 2. Extract destination on Push Chain
  // For Route 3, 'to' is a Push Chain address (string), not a ChainTarget
  const pushDestination = params.to as `0x${string}`;
  if (typeof params.to !== 'string') {
    throw new Error('Route 3 (CEA -> Push): to must be a Push Chain address (string), not a ChainTarget');
  }

  // 3. Get UEA address (will be recipient on Push Chain from CEA's perspective)
  const ueaAddress = computeUEAOffchain(ctx);

  // 4. Get CEA address on source chain
  const { cea: ceaAddress, isDeployed: ceaDeployed } = await getCEAAddress(
    ueaAddress,
    sourceChain,
    ctx.rpcUrls[sourceChain]?.[0]
  );

  // R3 pre-broadcast progress
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_301, sourceChain, ceaAddress);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_303_01, sourceChain);
  fireProgressHook(
    ctx,
    PROGRESS_HOOK.SEND_TX_303_02,
    ueaAddress,
    ceaAddress,
    sourceChain
  );

  printLog(ctx, `executeCeaToPush — sourceChain: ${sourceChain}, CEA: ${ceaAddress}, deployed: ${ceaDeployed}`);

  // CEA auto-deploys on-chain: Vault.finalizeUniversalTx calls CEAFactory.deployCEA()
  // if CEA doesn't exist yet. No SDK-side blocking needed.

  // 5. Get UniversalGateway address on source chain
  const gatewayAddress = UNIVERSAL_GATEWAY_ADDRESSES[sourceChain];
  if (!gatewayAddress) {
    throw new Error(`No UniversalGateway address configured for chain ${sourceChain}`);
  }

  // 6. Build multicall for CEA to execute on source chain (self-calls via sendUniversalTxToUEA)
  const ceaMulticalls: MultiCall[] = [];

  // Determine token and amount for sendUniversalTxToUEA
  let tokenAddress: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let amount = BigInt(0);

  if (params.funds?.amount) {
    // ERC20 token transfer from CEA
    const token = (params.funds as { token: MoveableToken }).token;
    if (token) {
      if (token.mechanism === 'native') {
        // Native token (e.g., BNB on BSC)
        tokenAddress = ZERO_ADDRESS as `0x${string}`;
        amount = params.funds.amount;
      } else {
        // ERC20 token - need approval for gateway before sendUniversalTxToUEA
        tokenAddress = token.address as `0x${string}`;
        amount = params.funds.amount;
      }
    }
  } else if (params.value && params.value > BigInt(0)) {
    // Native value transfer (e.g., BNB, ETH)
    tokenAddress = ZERO_ADDRESS as `0x${string}`;
    amount = params.value;
  }

  // bridgeAmount = only the burn amount (what the Vault will actually deposit to CEA).
  // Previously this included ceaExistingBalance (CEA's pre-existing balance on the
  // external chain), but that approach is racy: the balance can change between the SDK
  // query and relay execution, causing sendUniversalTxToUEA to revert with
  // InsufficientBalance. Pre-existing CEA funds remain parked and can be swept separately.
  const bridgeAmount = amount;
  // Note: CEA contract may reject amount=0 in sendUniversalTxToUEA.
  // Keeping bridgeAmount as-is (0) for payload-only to test precompile behavior.

  // For ERC20 tokens, add approve call for the bridge amount
  // (CEA approves gateway to spend the Vault-deposited amount)
  // Reset to 0 first for USDT-style tokens that revert on non-zero to non-zero approve.
  if (tokenAddress !== (ZERO_ADDRESS as `0x${string}`) && bridgeAmount > BigInt(0)) {
    const approveZeroData = encodeFunctionData({
      abi: ERC20_EVM,
      functionName: 'approve',
      args: [gatewayAddress, BigInt(0)],
    });
    ceaMulticalls.push({
      to: tokenAddress,
      value: BigInt(0),
      data: approveZeroData,
    });
    const approveData = encodeFunctionData({
      abi: ERC20_EVM,
      functionName: 'approve',
      args: [gatewayAddress, bridgeAmount],
    });
    ceaMulticalls.push({
      to: tokenAddress,
      value: BigInt(0),
      data: approveData,
    });
  }

  // Pre-fetch UEA nonce — needed for the inbound UniversalPayload struct
  // Skip getCode if accountStatusCache already confirmed deployment
  let isUEADeployed: boolean;
  let ueaNonce: bigint;
  const deployedHintR3 = ctx.accountStatusCache?.uea?.deployed;
  if (deployedHintR3) {
    isUEADeployed = true;
    ueaNonce = await getUEANonce(ctx, ueaAddress);
  } else {
    const ueaCode = await ctx.pushClient.publicClient.getCode({ address: ueaAddress });
    isUEADeployed = ueaCode !== undefined;
    ueaNonce = isUEADeployed ? await getUEANonce(ctx, ueaAddress) : BigInt(0);
  }

  // Build payload for Push Chain execution (if any)
  // This is what happens AFTER funds arrive on Push Chain.
  // The relay expects a full UniversalPayload struct (to, value, data, gasLimit, ...),
  // where `data` contains the multicall payload (with UEA_MULTICALL_SELECTOR prefix).
  let pushPayload: `0x${string}` = '0x';
  if (params.data) {
    const multicallData = buildExecuteMulticall({
      execute: {
        to: pushDestination,
        value: params.value,
        data: params.data,
      },
      ueaAddress,
    });
    const multicallPayload = buildMulticallPayloadData(ctx, pushDestination, multicallData);
    // Use ueaNonce + 1: the outbound tx itself consumes one nonce via execute(),
    // so the inbound will arrive when the UEA nonce is already incremented.
    pushPayload = buildInboundUniversalPayload(multicallPayload, { nonce: ueaNonce + BigInt(1) });
  }

  // Build sendUniversalTxToUEA self-call on CEA
  // CEA multicall: to=CEA (self-call), value=0
  // CEA internally calls gateway.sendUniversalTxFromCEA(...)
  // Uses bridgeAmount (= burn amount deposited by Vault)
  const sendUniversalTxCall = buildSendUniversalTxToUEA(
    ceaAddress,     // to: CEA address (self-call)
    tokenAddress,   // token: address(0) for native, ERC20 address otherwise
    bridgeAmount,   // amount: burn amount only (Vault-deposited)
    pushPayload,    // payload: Push Chain execution payload
    ueaAddress      // revertRecipient: UEA on Push Chain (receives refund if inbound fails)
  );
  ceaMulticalls.push(sendUniversalTxCall);

  // 7. Encode CEA multicalls into outbound payload
  // CEA will self-execute this multicall (to=CEA, value=0)
  const ceaPayload = buildCeaMulticallPayload(ceaMulticalls);

  printLog(
    ctx,
    `executeCeaToPush — CEA payload (first 100 chars): ${ceaPayload.slice(0, 100)}...`
  );

  // 8. Determine PRC-20 token for the outbound relay.
  // Route 3: ALWAYS use native PRC-20 for chain namespace lookup + gas fees.
  // The CEA uses its OWN pre-existing balance on the external chain to bridge
  // tokens back — no PRC-20 burn is needed on Push Chain.
  // burnAmount = 0 makes this a payload-only outbound relay.
  //
  // Previously this burned pUSDT/pToken equal to the bridge amount, which failed
  // because the UEA never holds pUSDT — the whole point of Route 3 is to get
  // tokens FROM the CEA back to Push Chain, not to round-trip them.
  const prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
  const burnAmount = BigInt(0);

  printLog(
    ctx,
    `executeCeaToPush — prc20Token: ${prc20Token}, burnAmount: ${burnAmount.toString()}`
  );

  // 9. Build outbound request (same structure as Route 2)
  // target = CEA address (for self-execution), value = 0 in payload
  const outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
    ceaAddress,              // target: CEA address (to=CEA for self-execution)
    prc20Token,              // token: native PRC-20 for source chain (for namespace lookup)
    burnAmount,              // amount: 0 (payload-only, CEA uses its own balance)
    params.gasLimit ?? BigInt(0),
    ceaPayload,              // payload: ABI-encoded CEA multicall
    ueaAddress               // revertRecipient: UEA
  );

  printLog(
    ctx,
    `executeCeaToPush — outbound request: ${JSON.stringify(
      {
        target: outboundReq.target,
        token: outboundReq.token,
        amount: outboundReq.amount.toString(),
        gasLimit: outboundReq.gasLimit.toString(),
        payloadLength: outboundReq.payload.length,
        revertRecipient: outboundReq.revertRecipient,
      },
      null,
      2
    )}`
  );

  // 10. Fetch UEA balance — needed for gas value calculation
  // (UEA code + nonce already fetched above for the inbound UniversalPayload)
  const gatewayPcAddress = getUniversalGatewayPCAddress();
  const ueaBalance = await ctx.pushClient.getBalance(ueaAddress);

  // 11. Query gas fees from UniversalCore
  let gasFee = BigInt(0);
  let protocolFeeR3 = BigInt(0);
  let nativeValueForGas = BigInt(0);
  let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let sizingDecisionR3: GasSizingDecision | undefined;
  if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
    const gasLimit = outboundReq.gasLimit;
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_302_01, sourceChain);
    try {
      const result = await queryOutboundGasFee(ctx, prc20Token, gasLimit, sourceChain);
      gasToken = result.gasToken;
      gasFee = result.gasFee;
      protocolFeeR3 = result.protocolFee;
      nativeValueForGas = result.nativeValueForGas;
      sizingDecisionR3 = result.sizing;
      printLog(
        ctx,
        `executeCeaToPush — queried gas fee: ${gasFee.toString()}, gasToken: ${gasToken}, nativeValueForGas: ${nativeValueForGas.toString()}, sizing=${result.sizing?.category ?? 'legacy'}`
      );
      fireProgressHook(
        ctx,
        PROGRESS_HOOK.SEND_TX_302_02,
        sourceChain,
        protocolFeeR3,
        gasFee
      );
      if (result.sizing) {
        fireSizingHook(ctx, 'R3', sourceChain, result.sizing);
      }
    } catch (err) {
      throw new Error(`Failed to query outbound gas fee for Route 3: ${err}`);
    }
  }

  // R3 Case C: unlike R2, R3 has no destination funds-delivery semantic
  // (CEA self-executes and bridges funds BACK to Push Chain). When the
  // sizer returns Case C, we simply top up msg.value with the overflow so
  // `swapAndBurnGas` can afford the full gas cost on destination. No
  // bridge-swap entries, no fold-in — contract refunds any excess.
  if (
    sizingDecisionR3?.category === 'C' &&
    sizingDecisionR3.overflowNativePc > BigInt(0)
  ) {
    const bumped = nativeValueForGas + sizingDecisionR3.overflowNativePc;
    printLog(
      ctx,
      `executeCeaToPush — Case C: bumping nativeValueForGas from ${nativeValueForGas} to ${bumped} (overflow=${sizingDecisionR3.overflowNativePc})`
    );
    nativeValueForGas = bumped;
  }

  // Adjust nativeValueForGas using UEA balance (contract refunds excess)
  // Reuse ueaBalance from line 978 — no tx sent between, balance is stable
  const currentBalance = ueaBalance;
  // Cosmos-EVM tx overhead costs ~1 PC per operation; 3 PC covers approve(s) + buffer.
  const OUTBOUND_GAS_RESERVE_R3 = BigInt(3e18);
  const ROUTE3_MINIMUM_DEPOSIT_USD = Utils.helpers.parseUnits('10', 8); // $10

  // For fresh wallets: predict post-fee-locking UPC balance using the same
  // Uniswap V3 quoter the chain uses (pETH → WPC swap), matching Route 2 logic.
  let effectiveBalance = currentBalance;
  if (!isUEADeployed && effectiveBalance <= OUTBOUND_GAS_RESERVE_R3) {
    const signerChain = ctx.universalSigner.account.chain;
    const ethPrice = await new PriceFetch(ctx.rpcUrls).getPrice(signerChain);
    const nativeAmountETH = ethPrice > BigInt(0)
      ? (ROUTE3_MINIMUM_DEPOSIT_USD * BigInt(1e18) + (ethPrice - BigInt(1))) / ethPrice + BigInt(1)
      : BigInt(0);

    if (nativeAmountETH > BigInt(0)) {
      const originPrc20 = getNativePRC20ForChain(signerChain, ctx.pushNetwork);
      const predictedUPC = await estimateDepositFromLockedNative(ctx, nativeAmountETH, originPrc20);
      if (predictedUPC > BigInt(0)) {
        effectiveBalance = (predictedUPC * BigInt(90)) / BigInt(100);
        printLog(ctx,
          `executeCeaToPush — fresh wallet: Uniswap quote predicts ${predictedUPC.toString()} UPC ` +
          `from ${nativeAmountETH.toString()} wei pETH, using ${effectiveBalance.toString()} (90%)`
        );
      }
    }
  }

  // Balance-aware adjustment matching Route 2 logic:
  // - If balance exceeds target + reserve: use target (200 UPC)
  // - If balance exceeds reserve: use balance - reserve (maximize within budget)
  // - Otherwise: keep original nativeValueForGas (fallback)
  const EVM_NATIVE_VALUE_TARGET_R3 = BigInt(200e18); // 200 UPC
  let adjustedValue: bigint;
  if (effectiveBalance > EVM_NATIVE_VALUE_TARGET_R3 + OUTBOUND_GAS_RESERVE_R3) {
    adjustedValue = EVM_NATIVE_VALUE_TARGET_R3;
  } else if (effectiveBalance > OUTBOUND_GAS_RESERVE_R3) {
    adjustedValue = effectiveBalance - OUTBOUND_GAS_RESERVE_R3;
  } else if (effectiveBalance > BigInt(0)) {
    // Drained UEA: overshoot would make the inner .call{value:...} return (false, "")
    // and the UEA reverts with opaque ExecutionFailed(). Clamp to whatever we have so
    // the gateway swap either succeeds or surfaces a concrete revert reason.
    adjustedValue = effectiveBalance < nativeValueForGas ? effectiveBalance : nativeValueForGas;
  } else {
    throw new Error(
      `UEA ${ueaAddress} has zero UPC balance; cannot fund outbound gas swap. ` +
      `Bridge UPC to the UEA before retrying.`
    );
  }

  if (adjustedValue !== nativeValueForGas) {
    printLog(
      ctx,
      `executeCeaToPush — adjusting nativeValueForGas from ${nativeValueForGas.toString()} to ${adjustedValue.toString()} (effective balance: ${effectiveBalance.toString()})`
    );
    nativeValueForGas = adjustedValue;
  }

  // 12. Build Push Chain multicalls (approvals + sendUniversalTxOutbound)
  const pushChainMulticalls: MultiCall[] = buildOutboundApprovalAndCall({
    prc20Token,
    gasToken,
    burnAmount,
    gasFee,
    nativeValueForGas,
    gatewayPcAddress,
    outboundRequest: outboundReq,
  });

  printLog(
    ctx,
    `executeCeaToPush — Push Chain multicall has ${pushChainMulticalls.length} operations`
  );

  // Sum native values from multicall entries for proper fee calculation
  const multicallNativeValue = pushChainMulticalls.reduce(
    (sum, mc) => sum + (mc.value ?? BigInt(0)),
    BigInt(0)
  );

  // 13. Execute through the normal execute() flow
  const executeParams: ExecuteParams = {
    to: ueaAddress,
    value: multicallNativeValue, // ensures correct requiredFunds calculation
    data: pushChainMulticalls,
    _ueaStatus: {
      isDeployed: isUEADeployed,
      nonce: ueaNonce,
      balance: ueaBalance,
    },
    _skipFeeLocking: isUEADeployed, // skip fee-locking only if UEA is already deployed
    // For undeployed UEAs, ensure fee-locking deposits enough for the outbound swap
    ...(!isUEADeployed ? { _minimumDepositUsd: ROUTE3_MINIMUM_DEPOSIT_USD } : {}),
  };

  // R3 broadcast marker
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_307, sourceChain);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_01);
  let response: UniversalTxResponse;
  try {
    response = await executeFn(executeParams);
  } catch (err) {
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_304_04,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_02);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_03);

  // Add Route 3 context to response
  response.chain = sourceChain;
  const chainInfo = CHAIN_INFO[sourceChain];
  response.chainNamespace = `${VM_NAMESPACE[chainInfo.vm]}:${chainInfo.chainId}`;

  return response;
}

// ---------------------------------------------------------------------------
// executeCeaToPushSvm  (Route 3 — SVM)
// ---------------------------------------------------------------------------

/**
 * Route 3 SVM: Execute CEA-to-Push for Solana chains.
 *
 * Unlike EVM Route 3 which builds CEA multicalls, SVM Route 3 encodes a
 * `send_universal_tx_to_uea` instruction as an execute payload targeting
 * the SVM gateway program (self-call). The drain amount is embedded in
 * the instruction data, not in the outbound request amount.
 */
export async function executeCeaToPushSvm(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  sourceChain: CHAIN,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {
  if (typeof params.to !== 'string') {
    throw new Error('Route 3 SVM (CEA -> Push): to must be a Push Chain address (string), not a ChainTarget');
  }

  const ueaAddress = computeUEAOffchain(ctx);

  // Get gateway program ID from chain config and convert to 0x-hex 32 bytes
  const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
  if (!lockerContract) {
    throw new Error(`No SVM gateway program configured for chain ${sourceChain}`);
  }
  const programPk = new PublicKey(lockerContract);
  const gatewayProgramHex = ('0x' + Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

  // R3 pre-broadcast progress (SVM)
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_301, sourceChain, lockerContract);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_303_01, sourceChain);
  fireProgressHook(
    ctx,
    PROGRESS_HOOK.SEND_TX_303_02,
    ueaAddress,
    lockerContract,
    sourceChain
  );

  printLog(ctx, `executeCeaToPushSvm — sourceChain: ${sourceChain}, gateway: ${lockerContract}`);

  // Determine drain amount and token
  let drainAmount = BigInt(0);
  let tokenMintHex: `0x${string}` | undefined;

  if (params.funds?.amount && params.funds.amount > BigInt(0)) {
    // SPL token drain
    drainAmount = params.funds.amount;
    const token = (params.funds as { token: MoveableToken }).token;
    if (token && token.address) {
      // Convert SPL mint address to 32-byte hex
      const mintPk = new PublicKey(token.address);
      tokenMintHex = ('0x' + Buffer.from(mintPk.toBytes()).toString('hex')) as `0x${string}`;
    }
  } else if (params.value && params.value > BigInt(0)) {
    // Native SOL drain
    drainAmount = params.value;
  }

  // Route 3 SVM: ALWAYS use native PRC-20 for chain namespace lookup + gas fees.
  // CEA uses its own pre-existing balance — no PRC-20 burn needed on Push Chain.
  const prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);

  // Build the SVM CPI payload (send_universal_tx_to_uea wrapped in execute)
  // If params.data is provided, pass it as extraPayload for Push Chain execution
  let extraPayload: Uint8Array | undefined;
  if (params.data && typeof params.data === 'string') {
    extraPayload = hexToBytes(params.data as `0x${string}`);
  }

  // Derive CEA PDA as revert recipient: ["push_identity", ueaAddress_20_bytes]
  const ueaBytes = Buffer.from(ueaAddress.slice(2), 'hex'); // 20 bytes
  const [ceaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('push_identity'), ueaBytes],
    programPk
  );
  const ceaPdaHex = ('0x' + Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;

  const svmPayload = encodeSvmCeaToUeaPayload({
    gatewayProgramHex,
    drainAmount,
    tokenMintHex,
    extraPayload,
    revertRecipientHex: ceaPdaHex,
  });

  printLog(
    ctx,
    `executeCeaToPushSvm — drainAmount: ${drainAmount.toString()}, payload length: ${(svmPayload.length - 2) / 2} bytes`
  );

  // burnAmount = 1 (minimum for precompile; drain amount lives inside the ixData)
  // The precompile rejects amount=0, so we use BigInt(1) as a workaround.
  const burnAmount = BigInt(1);

  // Build outbound request: target = gateway program (self-call)
  const outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
    gatewayProgramHex,
    prc20Token,
    burnAmount,
    params.gasLimit ?? BigInt(0),
    svmPayload,
    ueaAddress
  );

  printLog(
    ctx,
    `executeCeaToPushSvm — outbound request: target=${outboundReq.target.slice(0, 20)}..., token=${outboundReq.token}`
  );

  // Pre-fetch UEA status early — balance is needed for gas value calculation
  const gatewayPcAddress = getUniversalGatewayPCAddress();
  const [ueaCode, ueaBalance] = await Promise.all([
    ctx.pushClient.publicClient.getCode({ address: ueaAddress }),
    ctx.pushClient.getBalance(ueaAddress),
  ]);
  const isUEADeployed = ueaCode !== undefined;
  const ueaNonce = isUEADeployed ? await getUEANonce(ctx, ueaAddress) : BigInt(0);

  // Query gas fees
  let gasFee = BigInt(0);
  let protocolFeeR3Svm = BigInt(0);
  let nativeValueForGas = BigInt(0);
  let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let sizingDecisionR3Svm: GasSizingDecision | undefined;
  if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_302_01, sourceChain);
    try {
      const result = await queryOutboundGasFee(ctx, prc20Token, outboundReq.gasLimit, sourceChain);
      gasToken = result.gasToken;
      gasFee = result.gasFee;
      protocolFeeR3Svm = result.protocolFee;
      nativeValueForGas = result.nativeValueForGas;
      sizingDecisionR3Svm = result.sizing;
      printLog(ctx, `executeCeaToPushSvm — gasFee: ${gasFee.toString()}, gasToken: ${gasToken}, nativeValueForGas: ${nativeValueForGas.toString()}, sizing=${result.sizing?.category ?? 'legacy'}`);
      fireProgressHook(
        ctx,
        PROGRESS_HOOK.SEND_TX_302_02,
        sourceChain,
        protocolFeeR3Svm,
        gasFee
      );
      if (result.sizing) {
        fireSizingHook(ctx, 'R3', sourceChain, result.sizing);
      }
    } catch (err) {
      throw new Error(`Failed to query outbound gas fee for SVM Route 3: ${err}`);
    }
  }

  // R3 SVM Case C: same minimal interpretation as R3 EVM — bump msg.value
  // by the overflow so swapAndBurnGas can afford the full gas cost. No
  // bridge-swap entries (R3 has no destination funds-delivery semantic).
  if (
    sizingDecisionR3Svm?.category === 'C' &&
    sizingDecisionR3Svm.overflowNativePc > BigInt(0)
  ) {
    const bumped = nativeValueForGas + sizingDecisionR3Svm.overflowNativePc;
    printLog(
      ctx,
      `executeCeaToPushSvm — Case C: bumping nativeValueForGas from ${nativeValueForGas} to ${bumped} (overflow=${sizingDecisionR3Svm.overflowNativePc})`
    );
    nativeValueForGas = bumped;
  }

  // Adjust nativeValueForGas using UEA balance (contract refunds excess)
  // Re-fetch balance to minimize staleness from gas fee query RPC roundtrips
  const currentBalance = await ctx.pushClient.getBalance(ueaAddress);
  // Cosmos-EVM tx overhead costs ~1 PC per operation; 3 PC covers approve(s) + buffer.
  const OUTBOUND_GAS_RESERVE_R3_SVM = BigInt(3e18);
  if (currentBalance > OUTBOUND_GAS_RESERVE_R3_SVM && currentBalance - OUTBOUND_GAS_RESERVE_R3_SVM > nativeValueForGas) {
    const adjustedValue = currentBalance - OUTBOUND_GAS_RESERVE_R3_SVM;
    printLog(
      ctx,
      `executeCeaToPushSvm — adjusting nativeValueForGas from ${nativeValueForGas.toString()} to ${adjustedValue.toString()} (UEA balance: ${currentBalance.toString()})`
    );
    nativeValueForGas = adjustedValue;
  }

  // Build Push Chain multicalls (approvals + sendUniversalTxOutbound)
  const pushChainMulticalls: MultiCall[] = buildOutboundApprovalAndCall({
    prc20Token,
    gasToken,
    burnAmount,
    gasFee,
    nativeValueForGas,
    gatewayPcAddress,
    outboundRequest: outboundReq,
  });

  // Sum native values from multicall entries for proper fee calculation
  const multicallNativeValue = pushChainMulticalls.reduce(
    (sum, mc) => sum + (mc.value ?? BigInt(0)),
    BigInt(0)
  );

  // Execute through the normal execute() flow
  const executeParams: ExecuteParams = {
    to: ueaAddress,
    value: multicallNativeValue, // ensures correct requiredFunds calculation
    data: pushChainMulticalls,
    _ueaStatus: {
      isDeployed: isUEADeployed,
      nonce: ueaNonce,
      balance: ueaBalance,
    },
    _skipFeeLocking: isUEADeployed, // skip fee-locking only if UEA is already deployed
    // For undeployed UEAs, ensure fee-locking deposits enough for the outbound swap
    ...(!isUEADeployed ? { _minimumDepositUsd: Utils.helpers.parseUnits('10', 8) } : {}),
  };

  // R3 broadcast marker (SVM)
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_307, sourceChain);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_01);
  let response: UniversalTxResponse;
  try {
    response = await executeFn(executeParams);
  } catch (err) {
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_304_04,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_02);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_03);

  // Add Route 3 SVM context to response
  response.chain = sourceChain;
  const chainInfo = CHAIN_INFO[sourceChain];
  response.chainNamespace = `${VM_NAMESPACE[chainInfo.vm]}:${chainInfo.chainId}`;

  return response;
}

// ---------------------------------------------------------------------------
// executeCeaToCea  (Route 4 — stub)
// ---------------------------------------------------------------------------

/**
 * Route 4: Execute CEA to CEA transaction via Push Chain.
 */
export async function executeCeaToCea(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {

  // CEA -> CEA requires chaining Route 3 (CEA -> Push) and Route 2 (Push -> CEA)
  // This is a complex flow that requires coordination
  throw new Error(
    'CEA -> CEA transactions are not yet fully implemented. ' +
      'Use prepareTransaction() and executeTransactions() to chain Route 3 -> Route 2 manually.'
  );
}

// ---------------------------------------------------------------------------
// buildPayloadForRoute
// ---------------------------------------------------------------------------

/**
 * Build payload for a specific route.
 */
export async function buildPayloadForRoute(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  route: TransactionRoute,
  nonce: bigint
): Promise<{
  payload: `0x${string}`;
  gatewayRequest: UniversalTxRequest | UniversalOutboundTxRequest;
}> {
  const ueaAddress = computeUEAOffchain(ctx);

  switch (route) {
    case TransactionRoute.UOA_TO_PUSH: {
      // Build standard Push Chain payload
      const executeParams = toExecuteParams(params);
      const multicallData = buildExecuteMulticall({
        execute: executeParams,
        ueaAddress,
      });
      const payload = buildMulticallPayloadData(
        ctx,
        executeParams.to,
        multicallData
      );
      const req = buildUniversalTxRequest(
        ctx.universalSigner.account.address as `0x${string}`,
        {
          recipient: zeroAddress,
          token: zeroAddress,
          amount: BigInt(0),
          payload,
        }
      );
      return { payload, gatewayRequest: req };
    }

    case TransactionRoute.UOA_TO_CEA: {
      const target = params.to as ChainTarget;

      // Branch: SVM vs EVM
      if (isSvmChain(target.chain)) {
        // SVM: build SVM payload (binary or empty for withdraw) via IDL resolver
        const {
          svmPayload: payload,
          targetBytes,
          hasExecute,
        } = buildSvmPayloadFromParams({
          data: params.data,
          to: target,
          senderUea: ueaAddress,
        });

        let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let burnAmount = BigInt(0);
        if (params.funds?.amount) {
          const token = (params.funds as { token: MoveableToken }).token;
          if (token) {
            prc20Token = PushChain.utils.tokens.getPRC20Address(token);
            burnAmount = params.funds.amount;
          }
        } else if (params.value && params.value > BigInt(0)) {
          prc20Token = getNativePRC20ForChain(target.chain, ctx.pushNetwork);
          burnAmount = params.value;
        } else if (hasExecute) {
          prc20Token = getNativePRC20ForChain(target.chain, ctx.pushNetwork);
          burnAmount = BigInt(1);
        }

        const outboundReq = buildOutboundRequest(
          targetBytes,
          prc20Token,
          burnAmount,
          params.gasLimit ?? BigInt(0),
          payload,
          ueaAddress
        );

        return { payload, gatewayRequest: outboundReq };
      }

      // EVM path: Resolve CEA address first (needed for self-transfer check)
      const { cea: ceaAddress } = await getCEAAddress(
        ueaAddress,
        target.chain,
        ctx.rpcUrls[target.chain]?.[0]
      );

      // Build CEA outbound payload
      const multicalls: MultiCall[] = [];

      if (params.data) {
        if (Array.isArray(params.data)) {
          multicalls.push(...(params.data as MultiCall[]));
        } else {
          // Single call with data. Native value (if any) is already delivered to
          // CEA by the Vault via executeUniversalTx{value: amount}(). Attaching
          // value to the call would revert if the target function is not payable.
          // To call a payable function with value, use explicit multicalls.
          multicalls.push({
            to: target.address as `0x${string}`,
            value: BigInt(0),
            data: params.data as `0x${string}`,
          });
        }
      } else if (params.value) {
        // Skip multicall when sending native value to own CEA — gateway deposits directly.
        // Self-call with value would revert (CEA._handleMulticall rejects it).
        if (target.address.toLowerCase() !== ceaAddress.toLowerCase()) {
          multicalls.push({
            to: target.address as `0x${string}`,
            value: params.value,
            data: '0x',
          });
        }
      }

      const payload = buildCeaMulticallPayload(multicalls);

      let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let burnAmount = BigInt(0);
      if (params.funds?.amount) {
        const token = (params.funds as { token: MoveableToken }).token;
        if (token) {
          prc20Token = PushChain.utils.tokens.getPRC20Address(token);
          burnAmount = params.funds.amount;
        }
      }

      const targetBytes = ceaAddress;

      const outboundReq = buildOutboundRequest(
        targetBytes,
        prc20Token,
        burnAmount,
        params.gasLimit ?? BigInt(0),
        payload,
        ueaAddress
      );

      return { payload, gatewayRequest: outboundReq };
    }

    case TransactionRoute.CEA_TO_PUSH: {
      // Route 3: CEA -> Push Chain
      // Build CEA multicall (approve + sendUniversalTxFromCEA) and wrap in outbound
      if (!params.from?.chain) {
        throw new Error('Route 3 (CEA -> Push) requires from.chain');
      }
      const sourceChain = params.from.chain;
      const pushDestination = params.to as `0x${string}`;

      // SVM chains use gateway self-call, not CEA multicall
      if (isSvmChain(sourceChain)) {
        const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
        if (!lockerContract) {
          throw new Error(`No SVM gateway program configured for chain ${sourceChain}`);
        }
        const programPk = new PublicKey(lockerContract);
        const gatewayProgramHex = ('0x' + Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

        let drainAmount = BigInt(0);
        let tokenMintHex: `0x${string}` | undefined;
        if (params.funds?.amount && params.funds.amount > BigInt(0)) {
          drainAmount = params.funds.amount;
          const token = (params.funds as { token: MoveableToken }).token;
          if (token && token.address) {
            const mintPk = new PublicKey(token.address);
            tokenMintHex = ('0x' + Buffer.from(mintPk.toBytes()).toString('hex')) as `0x${string}`;
          }
        } else if (params.value && params.value > BigInt(0)) {
          drainAmount = params.value;
        }

        // Route 3 SVM: ALWAYS use native PRC-20, CEA uses its own balance.
        const prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);

        // Derive CEA PDA as revert recipient
        const ueaBytes2 = Buffer.from(ueaAddress.slice(2), 'hex');
        const [ceaPda2] = PublicKey.findProgramAddressSync(
          [Buffer.from('push_identity'), ueaBytes2],
          programPk
        );
        const ceaPdaHex2 = ('0x' + Buffer.from(ceaPda2.toBytes()).toString('hex')) as `0x${string}`;

        const svmPayload = encodeSvmCeaToUeaPayload({
          gatewayProgramHex,
          drainAmount,
          tokenMintHex,
          revertRecipientHex: ceaPdaHex2,
        });

        // burnAmount = 1 (minimum for precompile; drain amount lives inside the ixData)
        const burnAmount = BigInt(1);
        const outboundReq = buildOutboundRequest(
          gatewayProgramHex,
          prc20Token,
          burnAmount,
          params.gasLimit ?? BigInt(0),
          svmPayload,
          ueaAddress
        );

        return { payload: svmPayload, gatewayRequest: outboundReq };
      }

      const { cea: ceaAddress } = await getCEAAddress(
        ueaAddress,
        sourceChain,
        ctx.rpcUrls[sourceChain]?.[0]
      );

      // CEA auto-deploys on-chain: Vault.finalizeUniversalTx calls CEAFactory.deployCEA()
      // if CEA doesn't exist yet. No SDK-side blocking needed.

      const gatewayAddr = UNIVERSAL_GATEWAY_ADDRESSES[sourceChain];
      if (!gatewayAddr) {
        throw new Error(`No UniversalGateway address configured for chain ${sourceChain}`);
      }

      // Build CEA multicalls (self-calls via sendUniversalTxToUEA)
      const ceaMulticalls: MultiCall[] = [];
      let tokenAddress: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let amount = BigInt(0);

      if (params.funds?.amount) {
        const token = (params.funds as { token: MoveableToken }).token;
        if (token) {
          if (token.mechanism === 'native') {
            tokenAddress = ZERO_ADDRESS as `0x${string}`;
            amount = params.funds.amount;
          } else {
            tokenAddress = token.address as `0x${string}`;
            amount = params.funds.amount;
            // Reset allowance to 0 first for USDT-style tokens, then approve
            const approveZeroData = encodeFunctionData({
              abi: ERC20_EVM,
              functionName: 'approve',
              args: [gatewayAddr, BigInt(0)],
            });
            ceaMulticalls.push({
              to: tokenAddress,
              value: BigInt(0),
              data: approveZeroData,
            });
            const approveData = encodeFunctionData({
              abi: ERC20_EVM,
              functionName: 'approve',
              args: [gatewayAddr, amount],
            });
            ceaMulticalls.push({
              to: tokenAddress,
              value: BigInt(0),
              data: approveData,
            });
          }
        }
      } else if (params.value && params.value > BigInt(0)) {
        tokenAddress = ZERO_ADDRESS as `0x${string}`;
        amount = params.value;
      }

      // Fetch UEA nonce for inbound UniversalPayload
      const ueaCodeHop = await ctx.pushClient.publicClient.getCode({ address: ueaAddress });
      const ueaNonceHop = ueaCodeHop !== undefined ? await getUEANonce(ctx, ueaAddress) : BigInt(0);

      // Build Push Chain payload (what executes after inbound arrives)
      // Wrap in UniversalPayload struct for the relay.
      let pushPayload: `0x${string}` = '0x';
      if (params.data) {
        const multicallData = buildExecuteMulticall({
          execute: {
            to: pushDestination,
            value: params.value,
            data: params.data,
          },
          ueaAddress,
        });
        const multicallPayload = buildMulticallPayloadData(ctx, pushDestination, multicallData);
        pushPayload = buildInboundUniversalPayload(multicallPayload, { nonce: ueaNonceHop + BigInt(1) });
      }

      // Build sendUniversalTxToUEA self-call on CEA (to=CEA, value=0)
      const sendCall = buildSendUniversalTxToUEA(
        ceaAddress,
        tokenAddress,
        amount,
        pushPayload,
        ceaAddress
      );
      ceaMulticalls.push(sendCall);

      const ceaPayload = buildCeaMulticallPayload(ceaMulticalls);
      const prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
      // Route 3: CEA uses its own pre-existing balance — no PRC-20 burn needed.
      // burnAmount = 0 makes this a payload-only outbound relay.
      const burnAmount = BigInt(0);

      const outboundReq = buildOutboundRequest(
        ceaAddress,
        prc20Token,
        burnAmount,
        params.gasLimit ?? BigInt(0),
        ceaPayload,
        ueaAddress
      );

      return { payload: ceaPayload, gatewayRequest: outboundReq };
    }

    default:
      throw new Error(`Cannot build payload for route: ${route}`);
  }
}
