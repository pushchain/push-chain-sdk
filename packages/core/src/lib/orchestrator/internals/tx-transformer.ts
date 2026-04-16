/**
 * Transaction response/receipt transformation and progress reconstruction,
 * extracted from Orchestrator.
 */

import { TransactionReceipt } from 'viem';
import { CHAIN_INFO } from '../../constants/chain';
import { CHAIN } from '../../constants/enums';
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
  const route = universalTxResponse.route as TransactionRoute | undefined;
  const pcTx = universalTxData?.pcTx?.[0];
  const isOutboundFailed =
    universalTxData?.universalStatus === UniversalTxStatus.OUTBOUND_FAILED;
  const isPcFailed = pcTx?.status === 'FAILED';
  const isFailed = isPcFailed || isOutboundFailed;
  const errorMsg = isOutboundFailed
    ? 'Outbound transaction failed (status: OUTBOUND_FAILED)'
    : (pcTx?.errorMsg || 'Unknown error');

  // Route 2 / 3 reconstruction — keep parity with live emission from
  // route-handlers.ts (which fires 201/203/207 or 301/303/307 then suppresses
  // R1 IDs via fireProgressHook). Skip the R1 101–107 sequence here; it would
  // only fire for R2/R3 because reconstructProgressEvents bypasses
  // fireProgressHook (writes to events[] directly).
  if (route === TransactionRoute.UOA_TO_CEA) {
    return reconstructR2(universalTxResponse, universalTxData, isFailed, errorMsg);
  }
  if (route === TransactionRoute.CEA_TO_PUSH) {
    return reconstructR3(universalTxResponse, universalTxData, isFailed, errorMsg);
  }

  // Route 1 (and Route 4 fallback while R4 has no spec'd IDs) — emit the
  // full R1 lifecycle.
  const events: ProgressEvent[] = [];

  const originParts = universalTxResponse.origin.split(':');
  const chainNamespace =
    originParts.length >= 2 ? `${originParts[0]}:${originParts[1]}` : originParts[0];
  const originAddress =
    originParts.length >= 3 ? originParts[2] : universalTxResponse.from;

  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_101](chainNamespace, originAddress));
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_102_01]());
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_102_02](universalTxResponse.gasLimit));

  const pushChainIds = [
    CHAIN_INFO[CHAIN.PUSH_MAINNET].chainId,
    CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId,
    CHAIN_INFO[CHAIN.PUSH_LOCALNET].chainId,
  ];
  const isPushOrigin = pushChainIds.some(
    (id) => chainNamespace.includes(`eip155:${id}`)
  );

  if (!isPushOrigin) {
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_103_01]());
    events.push(
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_103_02](
        universalTxResponse.from as `0x${string}`,
        true
      )
    );
  }

  const inboundTx = universalTxData?.inboundTx;
  const hasFundsFlow = inboundTx && BigInt(inboundTx.amount || '0') > BigInt(0);

  if (!isPushOrigin) {
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_02]());
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_03]());
  }

  if (hasFundsFlow && inboundTx) {
    const amount = BigInt(inboundTx.amount);
    const decimals = 18;
    const symbol = 'TOKEN';

    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_01](amount, decimals, symbol));
    events.push(
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_02](inboundTx.txHash, amount, decimals, symbol)
    );

    const confirmations = 1;
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_03](confirmations));
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_03_02](confirmations, confirmations));
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_04]());
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_05]());
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_106_06](amount, decimals, symbol));
  }

  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_107]());

  if (isFailed) {
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_02](errorMsg));
  } else {
    events.push(
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_01]([universalTxResponse])
    );
  }

  return events;
}

function reconstructR2(
  universalTxResponse: UniversalTxResponse,
  universalTxData: UniversalTxV2 | undefined,
  isFailed: boolean,
  errorMsg: string
): ProgressEvent[] {
  const events: ProgressEvent[] = [];
  const targetChain = (universalTxResponse.chain ?? 'external') as string;
  const targetAddress =
    universalTxData?.outboundTx?.[0]?.recipient ?? universalTxResponse.to;

  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_201](targetChain, targetAddress));
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_203_01](targetChain));
  events.push(
    PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_203_02](
      universalTxResponse.from as `0x${string}`,
      targetAddress,
      targetChain,
      true
    )
  );
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_01]());
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_02]());
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_03]());
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_207](targetChain));

  if (isFailed) {
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_02](errorMsg));
  } else {
    // Push Chain success is intermediate for R2 — the wait() outbound poll
    // appends the real terminal (299-01/02/03) once the external leg resolves.
    events.push(
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_99](
        targetChain,
        universalTxResponse.hash
      )
    );
  }

  return events;
}

function reconstructR3(
  universalTxResponse: UniversalTxResponse,
  universalTxData: UniversalTxV2 | undefined,
  isFailed: boolean,
  errorMsg: string
): ProgressEvent[] {
  const events: ProgressEvent[] = [];
  const sourceChain = (universalTxResponse.chain ?? 'source') as string;
  const ceaAddress =
    universalTxData?.outboundTx?.[0]?.recipient ?? universalTxResponse.to;

  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_301](sourceChain, ceaAddress));
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_303_01](sourceChain));
  events.push(
    PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_303_02](
      universalTxResponse.from as `0x${string}`,
      ceaAddress,
      sourceChain
    )
  );
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_01]());
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_02]());
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_03]());
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_307](sourceChain));

  if (isFailed) {
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](errorMsg));
  } else {
    // Push Chain success is intermediate for R3 — wait() drives the source-chain
    // CEA poll (309-xx) and the inbound-to-Push poll (310-xx / 399-xx) on top.
    events.push(
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_99_99](universalTxResponse.hash)
    );
  }

  return events;
}

// ============================================================================
// Route Detection from V2 Data
// ============================================================================

/**
 * Function selector of `sendUniversalTxToUEA(address,uint256,bytes,address)`.
 * R3 (CEA → Push round-trip) outbound payloads always contain a CEA
 * self-call to this method — its presence in the outbound payload bytes
 * disambiguates a fresh R3 outbound (no inbound leg yet) from R2.
 * Verified via `keccak256(toBytes('sendUniversalTxToUEA(address,uint256,bytes,address)')).slice(0,10)`.
 */
const SEND_UNIVERSAL_TX_TO_UEA_SELECTOR = 'e7c1e3fc';

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
    // Disambiguate R3 from R2 when the inbound leg of an R3 round-trip
    // hasn't materialized yet (fresh tx). R3 outbounds always carry a CEA
    // self-call to `sendUniversalTxToUEA(...)` — its selector in the
    // payload bytes is a deterministic signal.
    const r3Signal = universalTxData.outboundTx.some((ob) => {
      const payload = (ob.payload || '').toLowerCase();
      return payload.includes(SEND_UNIVERSAL_TX_TO_UEA_SELECTOR);
    });
    if (r3Signal) return TransactionRoute.CEA_TO_PUSH;

    return hasInbound
      ? TransactionRoute.CEA_TO_CEA
      : TransactionRoute.UOA_TO_CEA;
  }
  if (hasInbound) return TransactionRoute.CEA_TO_PUSH;
  return TransactionRoute.UOA_TO_PUSH;
}
