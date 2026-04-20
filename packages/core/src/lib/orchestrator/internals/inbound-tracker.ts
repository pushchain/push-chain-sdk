/**
 * R3 inbound-to-Push tracking. After CEA executes on the source chain
 * (R3 outbound poll completes with 309-03), the source-chain CEA fires
 * `sendUniversalTxToUEA` which produces a child UniversalTx whose pcTx[0]
 * is the inbound Push Chain tx that closes the round-trip.
 *
 * The correlation mechanism mirrors `scripts/poll-outbound.ts` Step D:
 *   1. Search Cosmos for `universal_tx_created.inbound_tx_hash='${extHash}'`
 *      and pull the child `utx_id` from the resulting events.
 *   2. Query the child UTX via `getUniversalTxByIdV2(utxId)`. Its `pcTx[0]`
 *      is the inbound Push Chain tx; its `universalStatus` tells us terminal.
 */

import { UniversalTxStatus } from '../../generated/uexecutor/v2/types';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import type { CHAIN } from '../../constants/enums';
import { detectUniversalTx } from '../../universal-tx-detector/detector';
import { resolveChildInboundsFromDetection } from '../../universal-tx-detector/child-inbounds';

export type InboundPushTxStatus = 'pending' | 'confirmed' | 'failed';

export interface InboundPushTxDetails {
  /** The Push Chain tx hash that processed the inbound from the CEA. */
  pushTxHash: string;
  /** Child UTX id (Push Chain UniversalTx that owns the inbound). */
  childUtxId: string;
  /** Source chain that the CEA executed on. */
  sourceChain: string;
  /** External tx hash used as the correlation key. */
  outboundExternalTxHash: string;
  /** Final status of the inbound execution. */
  status: InboundPushTxStatus;
  /** Error message when status === 'failed'. */
  errorMessage?: string;
}

export interface WaitForInboundOptions {
  initialWaitMs?: number;
  pollingIntervalMs?: number;
  /** Total timeout from the call site (includes initialWaitMs). */
  timeout?: number;
  /** Optional callback for streamed status updates. */
  progressHook?: (event: {
    status: 'waiting' | 'polling' | 'found' | 'confirmed' | 'failed' | 'timeout';
    elapsedMs: number;
    childUtxId?: string;
    pushTxHash?: string;
  }) => void;
}

const TERMINAL_SUCCESS_STATUSES = new Set<number>([
  UniversalTxStatus.INBOUND_SUCCESS,
  UniversalTxStatus.PC_EXECUTED_SUCCESS,
]);

const TERMINAL_FAILURE_STATUSES = new Set<number>([
  UniversalTxStatus.PC_EXECUTED_FAILED,
  UniversalTxStatus.PC_PENDING_REVERT,
  UniversalTxStatus.OUTBOUND_FAILED,
  UniversalTxStatus.CANCELED,
]);

const stripHex = (id: string): string =>
  id.startsWith('0x') ? id.slice(2) : id;
const ensureHex = (id: string): string =>
  id.startsWith('0x') ? id : `0x${id}`;

/**
 * Resolves the child UTX id for an R3 round-trip from the source-chain tx.
 *
 * Primary path: use the universal-tx-detector to parse the source-chain
 * receipt, locate the `UniversalTx(fromCEA=true)` log emitted by the CEA's
 * `sendUniversalTxToUEA` call, and derive the child utxId via the
 * deterministic `sha256(caip:txHash:logIndex)` formula. This bypasses the
 * cosmos `universal_tx_created.inbound_tx_hash` indexer which has been
 * unreliable on testnet.
 *
 * Fallback: the original cosmos text search, kept in place so if the
 * indexer ever becomes the source of truth again (or the detector path
 * hits an RPC snag for the source chain) we still have a second chance.
 *
 * Returns `{ utxId: string }` on hit, `{ utxId: null }` when neither path
 * has seen it yet, or `{ utxId: null, error }` when both paths failed with
 * recoverable RPC errors.
 */
export async function findChildUtxIdFromExternalTx(
  ctx: OrchestratorContext,
  externalTxHash: string,
  sourceChain?: string
): Promise<{
  utxId: string | null;
  error?: Error;
  derivedFrom?: 'detector' | 'cosmos-fallback';
}> {
  // Primary: detector-based deterministic derivation.
  if (sourceChain) {
    try {
      const detection = await detectUniversalTx(
        externalTxHash as `0x${string}`,
        sourceChain as CHAIN,
        {
          pushClient: ctx.pushClient,
          rpcUrls: ctx.rpcUrls,
          skipPushChainLookup: true,
        }
      );
      const resolutions = await resolveChildInboundsFromDetection(
        ctx.pushClient,
        detection
      );
      // Pick the R3 return-trip child: prefer UniversalTx over RevertUniversalTx.
      const match =
        resolutions.find((r) => r.sourceEventName === 'UniversalTx') ??
        resolutions[0];
      if (match?.universalTxId) {
        printLog(
          ctx,
          `[findChildUtxIdFromExternalTx] detector derived utxId ${match.universalTxId} for ${externalTxHash} on ${sourceChain}`
        );
        return { utxId: ensureHex(match.universalTxId), derivedFrom: 'detector' };
      }
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error(String(err));
      printLog(
        ctx,
        `[findChildUtxIdFromExternalTx] detector path failed: ${wrapped.message} — falling back to cosmos search`
      );
      // Fall through to cosmos search.
    }
  }

  // Fallback: cosmos text search (original path).
  try {
    const query = `universal_tx_created.inbound_tx_hash='${externalTxHash}'`;
    const results = await ctx.pushClient.searchCosmosByQuery(query);
    for (const tx of results) {
      for (const event of tx.events ?? []) {
        if (
          event.type === 'universal_tx_created' ||
          event.type === 'outbound_created'
        ) {
          for (const attr of event.attributes ?? []) {
            if (attr.key === 'utx_id' && attr.value) {
              return {
                utxId: ensureHex(attr.value),
                derivedFrom: 'cosmos-fallback',
              };
            }
          }
        }
      }
    }
    return { utxId: null };
  } catch (err) {
    const wrapped = err instanceof Error ? err : new Error(String(err));
    printLog(
      ctx,
      `[findChildUtxIdFromExternalTx] cosmos fallback also failed: ${wrapped.message}`
    );
    return { utxId: null, error: wrapped };
  }
}

/**
 * Polls Push Chain for the inbound tx that closes an R3 round-trip.
 * Resolves when the child UTX reaches a terminal state (success/failure) or
 * rejects with a Timeout error if neither child UTX nor terminal state is
 * observed within the configured timeout.
 */
export async function waitForInboundPushTx(
  ctx: OrchestratorContext,
  outboundExternalTxHash: string,
  sourceChain: string,
  opts: WaitForInboundOptions = {}
): Promise<InboundPushTxDetails> {
  const initialWaitMs = opts.initialWaitMs ?? 30000;
  const pollingIntervalMs = opts.pollingIntervalMs ?? 5000;
  const timeout = opts.timeout ?? 300000;
  const progressHook = opts.progressHook;

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  printLog(
    ctx,
    `[waitForInboundPushTx] Starting | externalTxHash: ${outboundExternalTxHash} | sourceChain: ${sourceChain} | initialWait: ${initialWaitMs}ms | pollInterval: ${pollingIntervalMs}ms | timeout: ${timeout}ms`
  );
  progressHook?.({ status: 'waiting', elapsedMs: 0 });
  if (initialWaitMs > 0) {
    printLog(ctx, `[waitForInboundPushTx] Initial wait of ${initialWaitMs}ms...`);
    await new Promise((r) => setTimeout(r, Math.min(initialWaitMs, timeout)));
    printLog(ctx, `[waitForInboundPushTx] Initial wait done. Starting polling. Elapsed: ${elapsed()}ms`);
  }

  let childUtxId: string | null = null;
  let strippedChildUtxId: string | undefined;
  let pushTxHash: string | undefined;
  let lastEmittedStatus: 'polling' | 'found' | undefined;
  let consecutiveRpcErrors = 0;
  let pendingTerminalSuccessRetries = 0;
  let pollCount = 0;
  // Heuristic threshold — log a distinct warning when this many back-to-back
  // RPC failures happen so callers can see the difference between
  // "indexer hasn't seen it yet" and "RPC is down."
  const RPC_FAILURE_WARN_THRESHOLD = 5;
  // When chain reports terminal success but pcTx hasn't populated yet, give
  // the indexer one extra poll cycle to catch up before returning empty hash.
  const MAX_PENDING_TERMINAL_RETRIES = 2;

  while (elapsed() < timeout) {
    pollCount++;
    const pollStart = Date.now();
    printLog(ctx, `[waitForInboundPushTx] Poll #${pollCount} | Elapsed: ${elapsed()}ms / ${timeout}ms | phase: ${childUtxId ? 'utx-status' : 'child-search'}`);
    // Phase 1 — find child UTX id from the outbound external tx hash
    if (!childUtxId) {
      const search = await findChildUtxIdFromExternalTx(
        ctx,
        outboundExternalTxHash,
        sourceChain
      );
      printLog(ctx, `[waitForInboundPushTx] Poll #${pollCount} child-search result: utxId=${search.utxId ?? 'null'}${search.error ? ` error=${search.error.message}` : ''}`);
      if (search.error) {
        consecutiveRpcErrors++;
        if (consecutiveRpcErrors === RPC_FAILURE_WARN_THRESHOLD) {
          printLog(
            ctx,
            `[waitForInboundPushTx] ${RPC_FAILURE_WARN_THRESHOLD} consecutive Cosmos search errors — RPC may be unhealthy. Continuing until timeout.`
          );
        }
      } else {
        consecutiveRpcErrors = 0;
        if (search.utxId) {
          childUtxId = search.utxId;
          strippedChildUtxId = stripHex(childUtxId);
          progressHook?.({
            status: 'found',
            elapsedMs: elapsed(),
            childUtxId,
          });
          lastEmittedStatus = 'found';
        } else if (lastEmittedStatus !== 'polling') {
          progressHook?.({ status: 'polling', elapsedMs: elapsed() });
          lastEmittedStatus = 'polling';
        }
      }
    }

    // Phase 2 — once we have the child UTX, query its status until terminal
    if (childUtxId && strippedChildUtxId) {
      try {
        const response = await ctx.pushClient.getUniversalTxByIdV2(
          strippedChildUtxId
        );
        consecutiveRpcErrors = 0;
        const utx = response?.universalTx;
        const status = utx?.universalStatus ?? -1;

        if (utx?.pcTx?.[0]?.txHash) {
          pushTxHash = utx.pcTx[0].txHash;
        }
        printLog(ctx, `[waitForInboundPushTx] Poll #${pollCount} utx-status | status: ${status} | pcTx[0].txHash: '${pushTxHash ?? ''}' | pcTx len: ${utx?.pcTx?.length ?? 0}`);

        if (TERMINAL_SUCCESS_STATUSES.has(status)) {
          // Wait one more poll cycle if pcTx hasn't populated yet — the
          // indexer occasionally flips status before the pcTx hash is queryable.
          if (!pushTxHash && pendingTerminalSuccessRetries < MAX_PENDING_TERMINAL_RETRIES) {
            pendingTerminalSuccessRetries++;
          } else {
            progressHook?.({
              status: 'confirmed',
              elapsedMs: elapsed(),
              childUtxId,
              pushTxHash,
            });
            return {
              childUtxId,
              pushTxHash: pushTxHash ?? '',
              sourceChain,
              outboundExternalTxHash,
              status: 'confirmed',
            };
          }
        } else if (TERMINAL_FAILURE_STATUSES.has(status)) {
          const errMsg =
            utx?.pcTx?.[0]?.errorMsg ||
            `inbound terminated with status ${status}`;
          progressHook?.({
            status: 'failed',
            elapsedMs: elapsed(),
            childUtxId,
            pushTxHash,
          });
          return {
            childUtxId,
            pushTxHash: pushTxHash ?? '',
            sourceChain,
            outboundExternalTxHash,
            status: 'failed',
            errorMessage: errMsg,
          };
        } else if (pushTxHash) {
          // Tiebreaker: cosmos has the Push Chain tx hash populated but the
          // indexer hasn't transitioned universalStatus to a terminal yet.
          // Query Push RPC directly for the receipt — if it's confirmed on
          // chain, treat as terminal-success; if it reverted, treat as
          // terminal-failure. Cosmos-indexer lag stops blocking us here.
          try {
            const receipt = await ctx.pushClient.publicClient.getTransactionReceipt({
              hash: pushTxHash as `0x${string}`,
            });
            if (receipt?.status === 'success') {
              printLog(
                ctx,
                `[waitForInboundPushTx] Push RPC tiebreaker: ${pushTxHash} confirmed on chain (cosmos still status=${status}); treating as terminal-success`
              );
              progressHook?.({
                status: 'confirmed',
                elapsedMs: elapsed(),
                childUtxId,
                pushTxHash,
              });
              return {
                childUtxId,
                pushTxHash,
                sourceChain,
                outboundExternalTxHash,
                status: 'confirmed',
              };
            }
            if (receipt?.status === 'reverted') {
              printLog(
                ctx,
                `[waitForInboundPushTx] Push RPC tiebreaker: ${pushTxHash} REVERTED on chain (cosmos still status=${status}); treating as terminal-failure`
              );
              progressHook?.({
                status: 'failed',
                elapsedMs: elapsed(),
                childUtxId,
                pushTxHash,
              });
              return {
                childUtxId,
                pushTxHash,
                sourceChain,
                outboundExternalTxHash,
                status: 'failed',
                errorMessage: 'Push Chain inbound tx reverted on chain',
              };
            }
            // receipt missing / pending — keep polling.
          } catch (rpcErr) {
            // TransactionReceiptNotFoundError means not yet mined — continue
            // polling. Other errors get logged but don't break the loop.
            const msg =
              rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
            if (!/not found|TransactionReceiptNotFound|could not be found/i.test(msg)) {
              printLog(
                ctx,
                `[waitForInboundPushTx] Push RPC tiebreaker failed for ${pushTxHash}: ${msg}`
              );
            }
          }
        }
      } catch (err) {
        consecutiveRpcErrors++;
        if (consecutiveRpcErrors === RPC_FAILURE_WARN_THRESHOLD) {
          printLog(
            ctx,
            `[waitForInboundPushTx] ${RPC_FAILURE_WARN_THRESHOLD} consecutive getUniversalTxByIdV2 errors — RPC may be unhealthy. Continuing until timeout.`
          );
        }
        printLog(
          ctx,
          `[waitForInboundPushTx] getUniversalTxByIdV2 failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      if (lastEmittedStatus !== 'polling') {
        progressHook?.({
          status: 'polling',
          elapsedMs: elapsed(),
          childUtxId,
        });
        lastEmittedStatus = 'polling';
      }
    }

    if (elapsed() >= timeout) break;
    printLog(ctx, `[waitForInboundPushTx] Poll #${pollCount} not ready (${Date.now() - pollStart}ms). Waiting ${pollingIntervalMs}ms...`);
    await new Promise((r) => setTimeout(r, pollingIntervalMs));
  }
  printLog(ctx, `[waitForInboundPushTx] TIMEOUT after ${pollCount} polls | elapsed: ${elapsed()}ms`);

  progressHook?.({ status: 'timeout', elapsedMs: elapsed() });
  throw new InboundTimeoutError(outboundExternalTxHash, elapsed());
}

/**
 * Thrown by `waitForInboundPushTx` when the polling loop exceeds the
 * configured timeout without observing a terminal inbound Push tx. Callers
 * (response-builder) `instanceof`-check to distinguish timeout (→ 399-03)
 * from generic failure (→ 399-02) without relying on error-message prefixes.
 */
export class InboundTimeoutError extends Error {
  readonly code = 'INBOUND_TIMEOUT' as const;
  readonly correlationKey: string;
  readonly elapsedMs: number;
  constructor(correlationKey: string, elapsedMs: number) {
    super(
      `Timeout waiting for inbound Push tx after ${Math.round(
        elapsedMs / 1000
      )}s (correlation key: ${correlationKey}).`
    );
    this.name = 'InboundTimeoutError';
    this.correlationKey = correlationKey;
    this.elapsedMs = elapsedMs;
  }
}
