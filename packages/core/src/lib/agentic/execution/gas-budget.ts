import { UNIVERSAL_CORE_EVM } from '../../constants/abi/prc20.evm';
import type { OrchestratorContext } from '../../orchestrator/internals/context';
import { CORE_ADDRESS } from '../contracts/prc20-metadata';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';

/** Headroom over the pool quote; the gateway refunds whatever the swap leaves. */
const POOL_HEADROOM_NUM = BigInt(12);
const POOL_HEADROOM_DEN = BigInt(10);

/**
 * PC gas budget (maxPCForGas) for an AGW outbound, excluding protocolFee.
 * The gateway buys exactly `gasFee` of the gas token from the Donut WPC pool
 * and reverts when the budget cannot. The shared USD sizer can attach less:
 * its over-$10 overflow has no funds leg on this path, and its USD price can
 * differ from the pool. Keep the larger of the sized budget and the pool cost.
 */
export function agwGasBudget(
  quote: {
    protocolFee: bigint;
    nativeValueForGas: bigint;
    sizing?: { category: string; overflowNativePc: bigint };
  },
  poolPcIn?: bigint
): bigint {
  const sized =
    (quote.nativeValueForGas > quote.protocolFee
      ? quote.nativeValueForGas - quote.protocolFee
      : BigInt(0)) +
    (quote.sizing?.category === 'C'
      ? quote.sizing.overflowNativePc
      : BigInt(0));
  const pool =
    poolPcIn === undefined
      ? BigInt(0)
      : (poolPcIn * POOL_HEADROOM_NUM + POOL_HEADROOM_DEN - BigInt(1)) /
        POOL_HEADROOM_DEN;
  return sized > pool ? sized : pool;
}

/** Refuses an explicit gasLimit below the chain base before quoting, where core
 * would otherwise revert. Omitted or zero gas uses the base. */
export async function assertGasLimitAtLeastBase(
  ctx: OrchestratorContext,
  chain: string,
  gasLimit: bigint
): Promise<void> {
  if (gasLimit <= BigInt(0)) return;
  let base: bigint;
  try {
    base = await ctx.pushClient.readContract<bigint>({
      address: CORE_ADDRESS,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'baseGasLimitByChainNamespace',
      args: [chain],
    });
  } catch {
    return; // The quote itself reports any real failure.
  }
  if (gasLimit < base)
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      `gasLimit ${gasLimit} is below the ${chain} minimum of ${base}; omit it or pass 0 to use the network default`,
      {
        userMessage:
          'The gas limit is below this network’s minimum. Leave it empty to use the network default.',
        details: { field: 'gasLimit', minimum: base },
      }
    );
}
