/**
 * Transaction response/receipt transformation and progress reconstruction,
 * extracted from Orchestrator.
 */

import { TransactionReceipt } from 'viem';
import { UniversalTxStatus } from '../../generated/uexecutor/v1/types';
import type { UniversalTxV2 } from '../../generated/uexecutor/v2/types';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import { PROGRESS_HOOK, ProgressEvent } from '../../progress-hook/progress-hook.types';
import { TransactionRoute } from '../route-detector';
import type { UniversalTxReceipt, UniversalTxResponse } from '../orchestrator.types';

// ============================================================================
// Receipt Transform
// ============================================================================

export function transformToUniversalTxReceipt(
  receipt: TransactionReceipt,
  originalTxResponse: UniversalTxResponse
): UniversalTxReceipt {
  return {
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    transactionIndex: receipt.transactionIndex,
    from: originalTxResponse.from,
    to: originalTxResponse.to,
    contractAddress: receipt.contractAddress || null,
    gasPrice: originalTxResponse.gasPrice || BigInt(0),
    gasUsed: receipt.gasUsed,
    cumulativeGasUsed: receipt.cumulativeGasUsed,
    logs: receipt.logs || [],
    logsBloom: receipt.logsBloom || '0x',
    status: receipt.status === 'success' ? 1 : 0,
    raw: originalTxResponse.raw || {
      from: originalTxResponse.from,
      to: originalTxResponse.to,
    },
  };
}

// ============================================================================
// Progress Event Reconstruction
// ============================================================================

export function reconstructProgressEvents(
  universalTxResponse: UniversalTxResponse,
  universalTxData?: UniversalTxV2
): ProgressEvent[] {
  const events: ProgressEvent[] = [];

  const originParts = universalTxResponse.origin.split(':');
  const chainNamespace =
    originParts.length >= 2 ? `${originParts[0]}:${originParts[1]}` : originParts[0];
  const originAddress =
    originParts.length >= 3 ? originParts[2] : universalTxResponse.from;

  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_01](chainNamespace, originAddress));
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_02_01]());
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_02_02](universalTxResponse.gasLimit));

  const isPushOrigin =
    chainNamespace.includes('eip155:42101') ||
    chainNamespace.includes('eip155:9') ||
    chainNamespace.includes('eip155:9001');

  if (!isPushOrigin) {
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_03_01]());
    events.push(
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_03_02](
        universalTxResponse.from as `0x${string}`,
        true
      )
    );
  }

  const inboundTx = universalTxData?.inboundTx;
  const hasFundsFlow = inboundTx && BigInt(inboundTx.amount || '0') > BigInt(0);

  if (!isPushOrigin) {
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_04_02]());
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_04_03]());
  }

  if (hasFundsFlow && inboundTx) {
    const amount = BigInt(inboundTx.amount);
    const decimals = 18;
    const symbol = 'TOKEN';

    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_01](amount, decimals, symbol));
    events.push(
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_02](inboundTx.txHash, amount, decimals, symbol)
    );

    const confirmations = 1;
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_03](confirmations));
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_03_02](confirmations, confirmations));
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_04]());
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_05]());
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_06_06](amount, decimals, symbol));
  }

  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_07]());

  const pcTx = universalTxData?.pcTx?.[0];
  const isOutboundFailed =
    universalTxData?.universalStatus === UniversalTxStatus.OUTBOUND_FAILED;
  const isPcFailed = pcTx?.status === 'FAILED';
  const isFailed = isPcFailed || isOutboundFailed;

  if (isFailed) {
    const errorMsg = isOutboundFailed
      ? 'Outbound transaction failed (status: OUTBOUND_FAILED)'
      : (pcTx?.errorMsg || 'Unknown error');
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_99_02](errorMsg));
  } else {
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_99_01]([universalTxResponse]));
  }

  return events;
}

// ============================================================================
// Route Detection from V2 Data
// ============================================================================

export function detectRouteFromUniversalTxData(
  universalTxData: UniversalTxV2 | undefined
): TransactionRoute | undefined {
  if (!universalTxData) return undefined;

  const hasOutbound = universalTxData.outboundTx.length > 0;
  const hasInbound = !!universalTxData.inboundTx;
  const statusIndicatesOutbound = [
    UniversalTxStatus.OUTBOUND_PENDING,
    UniversalTxStatus.OUTBOUND_SUCCESS,
    UniversalTxStatus.OUTBOUND_FAILED,
  ].includes(universalTxData.universalStatus);

  if (hasOutbound || statusIndicatesOutbound) {
    return hasInbound
      ? TransactionRoute.CEA_TO_CEA
      : TransactionRoute.UOA_TO_CEA;
  }
  if (hasInbound) return TransactionRoute.CEA_TO_PUSH;
  return TransactionRoute.UOA_TO_PUSH;
}
