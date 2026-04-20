/**
 * Transaction response/receipt transformation and progress reconstruction,
 * extracted from Orchestrator.
 */

import { TransactionReceipt, decodeAbiParameters } from 'viem';
import { CHAIN_INFO } from '../../constants/chain';
import { CHAIN } from '../../constants/enums';
import { UEA_MULTICALL_SELECTOR } from '../../constants/selectors';
import { UniversalTxStatus } from '../../generated/uexecutor/v1/types';
import type { UniversalTxV2 } from '../../generated/uexecutor/v2/types';
import { OutboundStatus } from '../../generated/uexecutor/v2/types';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import { PROGRESS_HOOK, ProgressEvent } from '../../progress-hook/progress-hook.types';
import { MULTICALL_TUPLE_TYPE } from '../payload-builders';
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
  // R1 fallback keeps the inclusive view (any terminal failure → 199-02).
  // R2 and R3 reconstructors narrow to Push-chain-only failures (see call
  // sites below) — an outbound-leg revert is re-detected during wait() by
  // `waitForOutboundTx` and emitted as 299-02 / 399-02 with the correctly
  // scoped phase ('outbound' + source-chain). Emitting in both places
  // would double-fire the terminal with a misleading 'push' title on top.
  const isFailed = isPcFailed || isOutboundFailed;
  const errorMsg = isOutboundFailed
    ? 'Outbound transaction failed (status: OUTBOUND_FAILED)'
    : (pcTx?.errorMsg || 'Unknown error');

  // Route 2 / 3 reconstruction — keep parity with live emission from
  // route-handlers.ts (which fires 201/203/207 or 301/303/307 then suppresses
  // R1 IDs via fireProgressHook). Skip the R1 101–107 sequence here; it would
  // only fire for R2/R3 because reconstructProgressEvents bypasses
  // fireProgressHook (writes to events[] directly).
  // For R2/R3 we only emit the reconstructed terminal when the Push-chain
  // leg itself failed — so prefer pcTx.errorMsg over the outbound-failed
  // sentinel. The outer `errorMsg` above carries the outbound text when
  // `isOutboundFailed` is set; that path is handled by wait() instead.
  const pcErrorMsg = pcTx?.errorMsg || 'Unknown error';

  // Multichain cascade: a single Push-chain tx that fanned out into >1
  // outbound legs (executeTransactions([tx1, tx2, …])). The cosmos record
  // carries one UniversalTx with multiple outboundTx entries; wrap the
  // per-leg R2/R3 backbones with the SEND-TX-001 / 002-xx / 999-xx markers
  // so replay parity matches live cascade emission.
  if ((universalTxData?.outboundTx?.length ?? 0) > 1) {
    return reconstructMultichain(
      universalTxResponse,
      universalTxData!,
      isFailed,
      errorMsg
    );
  }

  if (route === TransactionRoute.UOA_TO_CEA) {
    // R2: only Push-chain revert triggers the 299-02 terminal here; a
    // cosmos OUTBOUND_FAILED without pcTx.FAILED is handled by wait().
    return reconstructR2(universalTxResponse, universalTxData, isPcFailed, pcErrorMsg);
  }
  if (route === TransactionRoute.CEA_TO_PUSH) {
    // R3: same narrowing — only pcTx.FAILED triggers reconstructed 399-02.
    return reconstructR3(universalTxResponse, universalTxData, isPcFailed, pcErrorMsg);
  }

  // Route 1 (and Route 4 fallback while R4 has no spec'd IDs) — emit the
  // safe R1 backbone that applies to every sub-path: origin → gas → UEA
  // (non-Push only) → broadcast → terminal. The sub-path-specific hooks
  // (104-xx signature, 105-xx fee-lock, 106-xx funds-bridge) are intentionally
  // omitted from reconstruction because R1 doesn't register a UniversalTx
  // on Push Chain, so `universalTxData` is usually undefined here and we
  // have no reliable signal to tell the three paths apart. Callers who want
  // the full live sequence should either register `progressHook` at
  // `initialize()` time (client-level) or call `tx.progressHook(cb)` after
  // sendTransaction — both deliver the full stream from the execute-phase
  // event buffer.
  const events: ProgressEvent[] = [];

  const originParts = universalTxResponse.origin.split(':');
  const chainNamespace =
    originParts.length >= 2 ? `${originParts[0]}:${originParts[1]}` : originParts[0];
  const originAddress =
    originParts.length >= 3 ? originParts[2] : universalTxResponse.from;

  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_101](chainNamespace, originAddress));
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_102_01]());

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

  events.push(
    PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_103_03_04](
      universalTxResponse.gasLimit,
      BigInt(0)
    )
  );


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
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_202_01](targetChain));
  // Reconstruction: gas split unavailable from historical data — pass zeroes
  // so the shape matches live emission. totalCost derives to 0 in the message,
  // which is acceptable for a tracked (past) transaction.
  events.push(
    PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_202_02](targetChain, BigInt(0), BigInt(0))
  );
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
  events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_302_01](sourceChain));
  events.push(
    PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_302_02](sourceChain, BigInt(0), BigInt(0))
  );
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
    // Reconstructed Push-chain-tx failure — phase='push' so the title reads
    // "Push Chain Tx Failed" rather than the inbound copy.
    events.push(
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](errorMsg, 'push')
    );
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
// Multichain cascade reconstruction
// ============================================================================

function decodeUeaMulticall(
  data: string | undefined
): readonly { to: string; value: bigint; data: string }[] | null {
  if (!data) return null;
  const normalized = data.startsWith('0x') ? data : `0x${data}`;
  if (!normalized.toLowerCase().startsWith(UEA_MULTICALL_SELECTOR)) return null;
  try {
    const body = `0x${normalized.slice(10)}` as `0x${string}`;
    const [tuples] = decodeAbiParameters(
      [MULTICALL_TUPLE_TYPE],
      body
    ) as unknown as [readonly { to: string; value: bigint; data: string }[]];
    return tuples;
  } catch {
    return null;
  }
}

/**
 * Count the merged R1 calls embedded inside an R3 outbound's payload.
 *
 * The outbound payload on-chain is UEA_MULTICALL_SELECTOR + abi-encoded
 * MultiCall[] targeting the CEA. One of those inner calls is
 * `sendUniversalTxToUEA(token, amount, payload, revertRecipient)` whose
 * `payload` argument is itself a UEA_MULTICALL_SELECTOR + MultiCall[] blob
 * — that blob is what will execute on Push Chain after the round-trip. Its
 * tuple count equals the number of user R1 hops merged into this R3 leg.
 */
function decodeR3MergedInnerCount(outboundPayload: string): number {
  const outerCalls = decodeUeaMulticall(outboundPayload);
  if (!outerCalls) return 0;
  for (const call of outerCalls) {
    const d = (call.data || '').toLowerCase();
    if (!d.startsWith(`0x${SEND_UNIVERSAL_TX_TO_UEA_SELECTOR}`)) continue;
    try {
      const innerBody = `0x${d.slice(10)}` as `0x${string}`;
      // sendUniversalTxToUEA(token, amount, payload, revertRecipient).
      // The `payload` arg is an ABI-encoded UniversalPayload struct
      // produced by buildInboundUniversalPayload() — its `.data` field is
      // the UEA_MULTICALL bytes that will execute on Push after the
      // round-trip.
      const [, , upStructBytes] = decodeAbiParameters(
        [
          { type: 'address' },
          { type: 'uint256' },
          { type: 'bytes' },
          { type: 'address' },
        ],
        innerBody
      ) as unknown as [string, bigint, string, string];
      const [universalPayload] = decodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
              { name: 'gasLimit', type: 'uint256' },
              { name: 'maxFeePerGas', type: 'uint256' },
              { name: 'maxPriorityFeePerGas', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
              { name: 'vType', type: 'uint8' },
            ],
          },
        ],
        upStructBytes as `0x${string}`
      ) as unknown as [{ data: string }];
      const pushCalls = decodeUeaMulticall(universalPayload.data);
      if (pushCalls) return pushCalls.length;
    } catch {
      // fall through to next outer call
    }
  }
  return 0;
}

function reconstructMultichain(
  universalTxResponse: UniversalTxResponse,
  universalTxData: UniversalTxV2,
  isFailed: boolean,
  errorMsg: string
): ProgressEvent[] {
  const events: ProgressEvent[] = [];
  const outbounds = universalTxData.outboundTx;
  // Merged-R1 recovery: each R3 outbound's payload embeds the
  // sendUniversalTxToUEA call whose `payload` arg is the UEA multicall that
  // will execute on Push after the round-trip. Its tuple count equals the
  // number of user R1 hops the orchestrator folded into that R3 leg.
  // Total user-level hopCount =
  //   (outbounds that are NOT R3) + Σ (merged inner-call count per R3 leg).
  // Falls back to `outbounds.length` when no R3 legs or decode fails
  // (pure R2 cascade).
  let r3LegCount = 0;
  let totalMergedInner = 0;
  for (const ob of outbounds) {
    const isR3 = (ob.payload || '')
      .toLowerCase()
      .includes(SEND_UNIVERSAL_TX_TO_UEA_SELECTOR);
    if (!isR3) continue;
    r3LegCount += 1;
    const inner = decodeR3MergedInnerCount(ob.payload || '');
    // When decode fails, assume the R3 leg represents 1 user hop so the
    // fallback converges on outbounds.length.
    totalMergedInner += inner > 0 ? inner : 1;
  }
  const recovered =
    r3LegCount > 0
      ? outbounds.length - r3LegCount + totalMergedInner
      : outbounds.length;
  // Defensive clamp: never under-count what's already visible on-chain.
  const hopCount = Math.max(recovered, outbounds.length);

  // Source chain for SEND-TX-001: the Push Chain (initiator of a cascade
  // always executes a multicall on Push first). Fall back to the response's
  // chain if origin parsing fails.
  const pushChainId = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId;
  const sourceChain = `eip155:${pushChainId}`;
  const destChains = outbounds.map((ob) => ob.destinationChain);

  events.push(
    PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_001](hopCount, [
      sourceChain,
      ...destChains,
    ])
  );

  let failedAt: number | null = null;
  let failureMsg = errorMsg;

  outbounds.forEach((ob, i) => {
    const hopNum = i + 1;
    const fromChain = i === 0 ? sourceChain : outbounds[i - 1].destinationChain;
    const toChain = ob.destinationChain;

    events.push(
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_002_01](
        hopNum,
        hopCount,
        fromChain,
        toChain
      )
    );

    // Build a single-leg view so the per-leg reconstructors (R2/R3) emit
    // their usual backbone. We narrow `outboundTx` to this leg so any field
    // reads (e.g. `outboundTx[0].recipient`) resolve to this leg's data.
    const legResponse: UniversalTxResponse = {
      ...universalTxResponse,
      chain: toChain as CHAIN,
      chainNamespace: toChain,
    };
    const legData: UniversalTxV2 = {
      ...universalTxData,
      outboundTx: [ob],
    };

    const payload = (ob.payload || '').toLowerCase();
    const isR3Leg = payload.includes(SEND_UNIVERSAL_TX_TO_UEA_SELECTOR);

    const legFailed = ob.outboundStatus === OutboundStatus.REVERTED;
    const legError =
      ob.abortReason || ob.observedTx?.errorMsg || 'leg execution failed';

    if (isR3Leg) {
      events.push(...reconstructR3(legResponse, legData, legFailed, legError));
    } else {
      events.push(...reconstructR2(legResponse, legData, legFailed, legError));
    }

    if (!legFailed) {
      events.push(
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_002_99_99](hopNum, hopCount)
      );
    } else if (failedAt === null) {
      failedAt = hopNum;
      failureMsg = legError;
    }
  });

  if (failedAt !== null) {
    events.push(
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_02](
        failedAt,
        hopCount,
        failureMsg
      )
    );
  } else if (isFailed) {
    events.push(
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_02](hopCount, hopCount, errorMsg)
    );
  } else {
    events.push(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_01](hopCount));
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
