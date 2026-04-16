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
 * Searches Cosmos for a child UTX created by an inbound from the given external
 * tx. Returns `{ utxId: string }` on hit, `{ utxId: null }` on a successful
 * empty result (indexer hasn't seen it yet), or `{ utxId: null, error }` when
 * the RPC itself fails — lets the caller distinguish "not found yet" from
 * "RPC down" so a permanent outage doesn't look like an in-flight inbound.
 */
export async function findChildUtxIdFromExternalTx(
  ctx: OrchestratorContext,
  externalTxHash: string
): Promise<{ utxId: string | null; error?: Error }> {
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
              return { utxId: ensureHex(attr.value) };
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
      `[findChildUtxIdFromExternalTx] search failed: ${wrapped.message}`
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

  progressHook?.({ status: 'waiting', elapsedMs: 0 });
  if (initialWaitMs > 0) {
    await new Promise((r) => setTimeout(r, Math.min(initialWaitMs, timeout)));
  }

  let childUtxId: string | null = null;
  let strippedChildUtxId: string | undefined;
  let pushTxHash: string | undefined;
  let lastEmittedStatus: 'polling' | 'found' | undefined;
  let consecutiveRpcErrors = 0;
  let pendingTerminalSuccessRetries = 0;
  // Heuristic threshold — log a distinct warning when this many back-to-back
  // RPC failures happen so callers can see the difference between
  // "indexer hasn't seen it yet" and "RPC is down."
  const RPC_FAILURE_WARN_THRESHOLD = 5;
  // When chain reports terminal success but pcTx hasn't populated yet, give
  // the indexer one extra poll cycle to catch up before returning empty hash.
  const MAX_PENDING_TERMINAL_RETRIES = 2;

  while (elapsed() < timeout) {
    // Phase 1 — find child UTX id from the outbound external tx hash
    if (!childUtxId) {
      const search = await findChildUtxIdFromExternalTx(
        ctx,
        outboundExternalTxHash
      );
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
    await new Promise((r) => setTimeout(r, pollingIntervalMs));
  }

  progressHook?.({ status: 'timeout', elapsedMs: elapsed() });
  throw new Error(
    `Timeout waiting for inbound Push tx after ${Math.round(
      elapsed() / 1000
    )}s (correlation key: ${outboundExternalTxHash}).`
  );
}
