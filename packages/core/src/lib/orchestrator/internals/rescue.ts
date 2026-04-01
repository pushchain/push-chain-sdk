/**
 * Rescue funds flow — extracted from Orchestrator.rescueFunds.
 *
 * Recovers stuck tokens from failed inbound transactions by building
 * a rescue multicall and executing it through the standard execute() flow.
 */

import { encodeFunctionData } from 'viem';
import { UNIVERSAL_GATEWAY_PC } from '../../constants/abi';
import { ZERO_ADDRESS } from '../../constants/selectors';
import type {
  ExecuteParams,
  MultiCall,
  RescueFundsParams,
  UniversalTxResponse,
} from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { getUniversalGatewayPCAddress } from './helpers';
import { computeUEAOffchain, getUEANonce } from './uea-manager';
import { queryRescueGasFee } from './gas-calculator';

// ============================================================================
// rescueFunds
// ============================================================================

/**
 * Rescue stuck funds on a source chain.
 * When a CEA-to-Push inbound transaction fails, tokens get locked in the
 * Vault on the source chain. This triggers a manual revert via TSS to
 * release those funds back to the user.
 *
 * @param ctx - Orchestrator context
 * @param params - RescueFundsParams with universalTxId and prc20 token
 * @param executeFn - The Orchestrator.execute() method (avoids circular dep)
 * @returns Transaction response
 */
export async function rescueFunds(
  ctx: OrchestratorContext,
  params: RescueFundsParams,
  executeFn: (params: ExecuteParams) => Promise<UniversalTxResponse>
): Promise<UniversalTxResponse> {
  // Validate universalTxId format (bytes32: 0x + 64 hex chars)
  if (
    !params.universalTxId ||
    params.universalTxId.length !== 66 ||
    !/^0x[0-9a-fA-F]{64}$/.test(params.universalTxId)
  ) {
    throw new Error(
      `Invalid universalTxId: expected 0x-prefixed bytes32 (66 chars), got "${params.universalTxId}"`
    );
  }

  // Validate prc20 is not zero address
  if (
    !params.prc20 ||
    params.prc20 === (ZERO_ADDRESS as `0x${string}`)
  ) {
    throw new Error('prc20 token address cannot be zero address');
  }

  const ueaAddress = computeUEAOffchain(ctx);
  const gatewayPcAddress = getUniversalGatewayPCAddress();

  printLog(
    ctx,
    `rescueFunds — universalTxId=${params.universalTxId}, prc20=${params.prc20}, gateway=${gatewayPcAddress}`
  );

  // Pre-fetch UEA status
  const [ueaCode, ueaBalance] = await Promise.all([
    ctx.pushClient.publicClient.getCode({ address: ueaAddress }),
    ctx.pushClient.getBalance(ueaAddress),
  ]);
  const isUEADeployed = ueaCode !== undefined;
  const ueaNonce = isUEADeployed ? await getUEANonce(ctx, ueaAddress) : BigInt(0);

  // Query rescue gas fee
  let nativeValueForGas = BigInt(0);
  try {
    const result = await queryRescueGasFee(ctx, params.prc20);
    nativeValueForGas = result.nativeValueForGas;
    printLog(
      ctx,
      `rescueFunds — queried gas fee: gasFee=${result.gasFee.toString()}, gasToken=${result.gasToken}, nativeValueForGas=${nativeValueForGas.toString()}`
    );
  } catch (err) {
    throw new Error(`Failed to query rescue gas fee: ${err}`);
  }

  // Adjust nativeValueForGas using the same balance-capping pattern as outbound
  const EVM_NATIVE_VALUE_TARGET = BigInt(200e18); // 200 UPC
  const EVM_GAS_RESERVE = BigInt(3e18); // 3 UPC for tx overhead
  const currentBalance = ueaBalance;

  let adjustedValue: bigint;
  if (currentBalance > EVM_NATIVE_VALUE_TARGET + EVM_GAS_RESERVE) {
    adjustedValue = EVM_NATIVE_VALUE_TARGET;
  } else if (currentBalance > EVM_GAS_RESERVE) {
    adjustedValue = currentBalance - EVM_GAS_RESERVE;
  } else {
    adjustedValue = nativeValueForGas;
  }

  if (adjustedValue !== nativeValueForGas) {
    printLog(
      ctx,
      `rescueFunds — adjusting nativeValueForGas from ${nativeValueForGas.toString()} to ${adjustedValue.toString()} (UEA balance: ${currentBalance.toString()})`
    );
    nativeValueForGas = adjustedValue;
  }

  // Build single rescue multicall (no PRC-20 approval needed — no burn)
  const rescueCallData = encodeFunctionData({
    abi: UNIVERSAL_GATEWAY_PC,
    functionName: 'rescueFundsOnSourceChain',
    args: [params.universalTxId, params.prc20],
  });

  const pushChainMulticalls: MultiCall[] = [
    {
      to: gatewayPcAddress,
      value: nativeValueForGas,
      data: rescueCallData,
    },
  ];

  printLog(
    ctx,
    `rescueFunds — built rescue multicall, nativeValueForGas=${nativeValueForGas.toString()}`
  );

  const multicallNativeValue = pushChainMulticalls.reduce(
    (sum, mc) => sum + (mc.value ?? BigInt(0)),
    BigInt(0)
  );

  const executeParams: ExecuteParams = {
    to: ueaAddress,
    value: multicallNativeValue,
    data: pushChainMulticalls,
    _ueaStatus: {
      isDeployed: isUEADeployed,
      nonce: ueaNonce,
      balance: ueaBalance,
    },
    _skipFeeLocking: true,
  };

  return executeFn(executeParams);
}
