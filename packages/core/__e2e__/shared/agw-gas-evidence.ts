/** Record quotes and measured gas separately from permission ceilings. */
import type { PushChain } from '../../src';
import type { AgenticRuntime } from '../../src/lib/agentic/runtime';
import type { AgwFixture } from '../agw/_fixture';
import type { Hex } from 'viem';
export function observeAgwGas(client: PushChain, f: AgwFixture, stage: string) {
  const rt = (client as unknown as { agenticRuntime: AgenticRuntime })
    .agenticRuntime;
  const previous = rt.quoteOutbound;
  rt.quoteOutbound = async (...args) => {
    const quote = await previous(...args);
    f.evidence('agw-gas-quote', {
      stage,
      token: args[0],
      requestedGasLimit: args[1],
      chain: args[2],
      protocolFeePCWei: quote.protocolFee,
      quotedGasBudgetPCWei: quote.nativeValueForGas,
      gasLimitUsed: quote.gasLimitUsed,
      attachedPCWei: quote.protocolFee + quote.nativeValueForGas,
      gasTokenFee: quote.gasFee,
      poolPcInRequired: quote.poolPcIn,
    });
    return quote;
  };
  return () => {
    rt.quoteOutbound = previous;
  };
}
export async function recordAgwPushGas(
  f: AgwFixture,
  hash: string,
  stage: string
) {
  const receipt = await f.push.getTransactionReceipt({ hash: hash as Hex });
  f.evidence('agw-push-gas', {
    stage,
    hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
    transactionGasPaidPCWei: receipt.gasUsed * receipt.effectiveGasPrice,
  });
}
