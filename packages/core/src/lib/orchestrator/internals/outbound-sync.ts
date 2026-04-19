/**
 * Outbound transaction sync: polling helpers that wait for outbound
 * transactions to complete on external chains.
 *
 * Extracted from Orchestrator.waitForOutboundTx / waitForAllOutboundTxsV2.
 */

import { bs58 } from '../../internal/bs58';
import { CHAIN_INFO, VM_NAMESPACE } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import { UniversalTxStatus } from '../../generated/uexecutor/v1/types';
import { OutboundStatus } from '../../generated/uexecutor/v2/types';
import type {
  CascadeHopInfo,
  WaitForOutboundOptions,
  OutboundTxDetails,
  TransactionRouteType,
} from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { chainFromNamespace } from './helpers';
import {
  extractUniversalSubTxIdFromTx,
  extractAllUniversalSubTxIds,
  computeUniversalTxId,
} from './outbound-tracker';

// ============================================================================
// Outbound sync configuration constants
// ============================================================================

/** Initial wait before the first poll (ms). */
export const OUTBOUND_INITIAL_WAIT_MS = 20000; // 20s

/** Interval between consecutive polls (ms). */
export const OUTBOUND_POLL_INTERVAL_MS = 5000; // 5s

/** Maximum total timeout for the outbound polling loop (ms). */
export const OUTBOUND_MAX_TIMEOUT_MS = 180000; // 180s (3 min)

/** Maximum total timeout for the R3 inbound round-trip polling loop (ms). */
export const INBOUND_MAX_TIMEOUT_MS = 300000; // 300s (5 min) — covers R3 inbound latency on testnet

/** Initial wait before the first inbound poll (ms). Set to 0 — the outbound just completed, so the indexer may already have the child UTX. */
export const INBOUND_INITIAL_WAIT_MS = 0;

// ============================================================================
// Typed errors
// ============================================================================

/**
 * Thrown by `waitForOutboundTx` when the polling loop exceeds the configured
 * timeout without observing an external tx hash. Callers can `instanceof`
 * check to distinguish between timeout (→ 299-03) and terminal failure
 * (→ 299-02) without resorting to error-message prefix matching.
 */
export class OutboundTimeoutError extends Error {
  readonly code = 'OUTBOUND_TIMEOUT' as const;
  readonly pushChainTxHash: string;
  readonly elapsedMs: number;
  constructor(pushChainTxHash: string, elapsedMs: number, timeoutMs: number) {
    super(
      `Timeout waiting for outbound transaction. Push Chain TX: ${pushChainTxHash}. Timeout: ${timeoutMs}ms. The relay may still be processing.`
    );
    this.name = 'OutboundTimeoutError';
    this.pushChainTxHash = pushChainTxHash;
    this.elapsedMs = elapsedMs;
  }
}

/**
 * Thrown by `waitForOutboundTx` when the universal tx reaches a terminal
 * failure state or an outbound leg reports REVERTED status. Distinguishes
 * a *failure* (→ 299-02) from a *timeout* (→ 299-03).
 */
export class OutboundFailedError extends Error {
  readonly code = 'OUTBOUND_FAILED' as const;
  readonly pushChainTxHash: string;
  readonly destinationChain?: string;
  constructor(
    message: string,
    pushChainTxHash: string,
    destinationChain?: string
  ) {
    super(message);
    this.name = 'OutboundFailedError';
    this.pushChainTxHash = pushChainTxHash;
    this.destinationChain = destinationChain;
  }
}

// ============================================================================
// waitForOutboundTx
// ============================================================================

/**
 * Wait for outbound transaction to complete and return external chain details.
 * @internal Used by .wait() for outbound routes - not part of public API.
 * Uses polling with configurable initial wait, interval, and timeout.
 *
 * Default strategy: 30s initial wait, then poll every 5s, 120s total timeout.
 *
 * @param ctx - Orchestrator context
 * @param pushChainTxHash - The Push Chain transaction hash
 * @param options - Polling configuration options
 * @returns External chain tx details
 * @throws Error on timeout
 */
export async function waitForOutboundTx(
  ctx: OrchestratorContext,
  pushChainTxHash: string,
  options: WaitForOutboundOptions = {}
): Promise<OutboundTxDetails> {
  const {
    initialWaitMs = OUTBOUND_INITIAL_WAIT_MS,
    pollingIntervalMs = OUTBOUND_POLL_INTERVAL_MS,
    timeout = OUTBOUND_MAX_TIMEOUT_MS,
    progressHook,
    _resolvedSubTxId,
    _expectedDestinationChain,
  } = options;

  // Terminal failure states — fail fast instead of polling until timeout
  const TERMINAL_FAILURE_STATES = new Set([
    UniversalTxStatus.OUTBOUND_FAILED,
    UniversalTxStatus.PC_EXECUTED_FAILED,
    UniversalTxStatus.CANCELED,
  ]);

  const startTime = Date.now();

  printLog(ctx, `[waitForOutboundTx] Starting | txHash: ${pushChainTxHash} | initialWait: ${initialWaitMs}ms | pollInterval: ${pollingIntervalMs}ms | timeout: ${timeout}ms`);

  progressHook?.({ status: 'waiting', elapsed: 0 });

  // Clamp the initial wait to the configured timeout so a short per-call
  // `outboundTimeoutMs` (e.g. from `tx.wait({ outboundTimeoutMs })`) isn't
  // blocked by the default 20s settle-time. Mirrors the equivalent
  // Math.min(initialWaitMs, timeout) clamp in inbound-tracker.ts.
  const effectiveInitialWaitMs = Math.min(initialWaitMs, timeout);
  printLog(ctx, `[waitForOutboundTx] Initial wait of ${effectiveInitialWaitMs}ms (configured: ${initialWaitMs}ms, clamped to timeout ${timeout}ms)...`);
  await new Promise((resolve) => setTimeout(resolve, effectiveInitialWaitMs));

  // Fast-exit: if the clamped initial wait already consumed the full budget,
  // skip the poll loop and go straight to the timeout throw below.
  if (Date.now() - startTime >= timeout) {
    const elapsedMs = Date.now() - startTime;
    printLog(ctx, `[waitForOutboundTx] Timeout reached during initial wait (elapsed: ${elapsedMs}ms / ${timeout}ms)`);
    progressHook?.({ status: 'timeout', elapsed: elapsedMs });
    throw new OutboundTimeoutError(pushChainTxHash, elapsedMs, timeout);
  }

  // Start polling
  printLog(ctx, `[waitForOutboundTx] Initial wait done. Starting polling. Elapsed: ${Date.now() - startTime}ms`);
  progressHook?.({ status: 'polling', elapsed: Date.now() - startTime });

  // Cache the universalSubTxId after first extraction to avoid redundant receipt fetches.
  // If a pre-resolved ID was provided (cascade per-hop tracking), use it directly.
  let cachedUniversalSubTxId: string | undefined = _resolvedSubTxId;

  let pollCount = 0;
  while (Date.now() - startTime < timeout) {
    pollCount++;
    const pollStart = Date.now();
    printLog(ctx, `[waitForOutboundTx] Poll #${pollCount} | Elapsed: ${pollStart - startTime}ms / ${timeout}ms`);

    if (!cachedUniversalSubTxId) {
      cachedUniversalSubTxId = (await extractUniversalSubTxIdFromTx(ctx, pushChainTxHash)) ?? undefined;
      if (!cachedUniversalSubTxId) {
        cachedUniversalSubTxId = computeUniversalTxId(ctx.pushNetwork, pushChainTxHash);
      }
      printLog(ctx, `[waitForOutboundTx] Extracted & cached universalSubTxId: ${cachedUniversalSubTxId}`);
    }

    // Query with cached ID
    const queryId = cachedUniversalSubTxId.startsWith('0x')
      ? cachedUniversalSubTxId.slice(2)
      : cachedUniversalSubTxId;

    try {
      const utxResponse = await ctx.pushClient.getUniversalTxByIdV2(queryId);

      const statusNum = utxResponse?.universalTx?.universalStatus as number;
      const statusName = UniversalTxStatus[statusNum] ?? statusNum;
      const outbounds = utxResponse?.universalTx?.outboundTx || [];
      printLog(ctx, `[waitForOutboundTx] Poll #${pollCount} | status: ${statusNum} (${statusName}) | outboundTx count: ${outbounds.length} | first txHash: '${outbounds[0]?.observedTx?.txHash || ''}' | first dest: '${outbounds[0]?.destinationChain || ''}'`);

      // Check for terminal failure states — fail fast
      if (TERMINAL_FAILURE_STATES.has(statusNum)) {
        printLog(ctx, `[waitForOutboundTx] Terminal failure state: ${statusName}`);
        progressHook?.({ status: 'failed', elapsed: Date.now() - startTime });
        throw new OutboundFailedError(
          `Outbound transaction failed with status ${statusName}. Push Chain TX: ${pushChainTxHash}.`,
          pushChainTxHash
        );
      }

      // Iterate V2 outbound array
      for (const ob of outbounds) {
        // Fail fast on per-outbound REVERTED status
        if (ob.outboundStatus === OutboundStatus.REVERTED) {
          printLog(ctx, `[waitForOutboundTx] Outbound to ${ob.destinationChain} REVERTED`);
          progressHook?.({ status: 'failed', elapsed: Date.now() - startTime });
          throw new OutboundFailedError(
            `Outbound to ${ob.destinationChain} reverted: ${ob.observedTx?.errorMsg || 'Unknown'}. Push Chain TX: ${pushChainTxHash}.`,
            pushChainTxHash,
            ob.destinationChain
          );
        }

        if (ob.observedTx?.txHash) {
          // If a destination chain filter is set, skip outbound entries that don't match
          if (_expectedDestinationChain && ob.destinationChain !== _expectedDestinationChain) {
            printLog(ctx, `[waitForOutboundTx] Poll #${pollCount} | outbound chain '${ob.destinationChain}' does not match expected '${_expectedDestinationChain}', skipping`);
            continue;
          }

          const chain = chainFromNamespace(ob.destinationChain);
          if (chain) {
            const explorerBaseUrl = CHAIN_INFO[chain]?.explorerUrl;
            const isSvm = CHAIN_INFO[chain]?.vm === VM.SVM;

            // For SVM chains, convert hex txHash to base58 and append cluster param
            let displayTxHash = ob.observedTx.txHash;
            let explorerUrl = '';
            if (isSvm && ob.observedTx.txHash.startsWith('0x')) {
              const bytes = new Uint8Array(Buffer.from(ob.observedTx.txHash.slice(2), 'hex'));
              displayTxHash = bs58.encode(Buffer.from(bytes));
              const cluster = chain === CHAIN.SOLANA_DEVNET ? '?cluster=devnet'
                : chain === CHAIN.SOLANA_TESTNET ? '?cluster=testnet' : '';
              explorerUrl = explorerBaseUrl ? `${explorerBaseUrl}/tx/${displayTxHash}${cluster}` : '';
            } else {
              explorerUrl = explorerBaseUrl ? `${explorerBaseUrl}/tx/${ob.observedTx.txHash}` : '';
            }

            const details: OutboundTxDetails = {
              externalTxHash: ob.observedTx.txHash,
              destinationChain: chain,
              explorerUrl,
              recipient: ob.recipient,
              amount: ob.amount,
              assetAddr: ob.externalAssetAddr,
            };
            printLog(ctx, `[waitForOutboundTx] FOUND on poll #${pollCount} | elapsed: ${Date.now() - startTime}ms | externalTxHash: ${details.externalTxHash}`);
            progressHook?.({ status: 'found', elapsed: Date.now() - startTime });
            return details;
          }
        }
      }
    } catch (error) {
      // Re-throw typed terminal failure so the caller can classify it as
      // 299-02. Transient errors (RPC hiccups, deserialization) are logged
      // and the loop continues polling until timeout.
      if (error instanceof OutboundFailedError) {
        throw error;
      }
      printLog(ctx, `[waitForOutboundTx] Poll #${pollCount} ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }

    printLog(ctx, `[waitForOutboundTx] Poll #${pollCount} not ready yet (${Date.now() - pollStart}ms). Waiting ${pollingIntervalMs}ms...`);

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));
  }

  const elapsedMs = Date.now() - startTime;
  printLog(ctx, `[waitForOutboundTx] TIMEOUT after ${pollCount} polls | elapsed: ${elapsedMs}ms`);
  progressHook?.({ status: 'timeout', elapsed: elapsedMs });

  throw new OutboundTimeoutError(pushChainTxHash, elapsedMs, timeout);
}

// ============================================================================
// waitForAllOutboundTxsV2
// ============================================================================

/**
 * Tracks ALL outbound transactions for a cascade with multiple outbound hops
 * (e.g., BNB + Solana). Uses V2 API which returns outboundTx[] with per-outbound
 * status tracking, matching each outbound to the correct hop by destination chain.
 */
export async function waitForAllOutboundTxsV2(
  ctx: OrchestratorContext,
  pushChainTxHash: string,
  outboundHops: CascadeHopInfo[],
  options: {
    initialWaitMs: number;
    pollingIntervalMs: number;
    timeout: number;
    progressHook?: (event: {
      hopIndex: number;
      route: TransactionRouteType;
      chain: CHAIN;
      status: string;
      txHash?: string;
    }) => void;
  }
): Promise<{ success: boolean; failedAt?: number }> {
  const { initialWaitMs, pollingIntervalMs, timeout, progressHook } = options;
  const startTime = Date.now();

  // Build a map: CAIP-2 namespace -> hop(s) for matching outbound entries
  const chainToHops = new Map<string, CascadeHopInfo[]>();
  for (const hop of outboundHops) {
    const chainInfo = CHAIN_INFO[hop.executionChain];
    if (chainInfo) {
      const namespace = `${VM_NAMESPACE[chainInfo.vm]}:${chainInfo.chainId}`;
      const existing = chainToHops.get(namespace) || [];
      existing.push(hop);
      chainToHops.set(namespace, existing);
    }
  }

  const expectedChains = [...chainToHops.keys()];
  printLog(ctx, `[waitForAllOutboundTxsV2] Starting | txHash: ${pushChainTxHash} | expectedChains: ${expectedChains.join(', ')} | timeout: ${timeout}ms`);

  // Emit initial waiting status for all outbound hops
  for (const hop of outboundHops) {
    progressHook?.({
      hopIndex: hop.hopIndex,
      route: hop.route,
      chain: hop.executionChain,
      status: 'waiting',
    });
  }

  // Initial wait before first poll
  const waitMs = Math.min(initialWaitMs, timeout);
  printLog(ctx, `[waitForAllOutboundTxsV2] Initial wait of ${waitMs}ms...`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  // Emit polling status for all hops
  for (const hop of outboundHops) {
    progressHook?.({
      hopIndex: hop.hopIndex,
      route: hop.route,
      chain: hop.executionChain,
      status: 'polling',
    });
  }

  // Extract sub-tx ID for V2 query
  let cachedQueryId: string | undefined;

  let pollCount = 0;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 10;
  while (Date.now() - startTime < timeout) {
    pollCount++;
    const elapsed = Date.now() - startTime;
    printLog(ctx, `[waitForAllOutboundTxsV2] Poll #${pollCount} | Elapsed: ${elapsed}ms / ${timeout}ms`);

    // Resolve query ID on first poll
    if (!cachedQueryId) {
      const allSubTxIds = await extractAllUniversalSubTxIds(ctx, pushChainTxHash);
      const subTxId = allSubTxIds.length > 0 ? allSubTxIds[0] : computeUniversalTxId(ctx.pushNetwork, pushChainTxHash);
      cachedQueryId = subTxId.startsWith('0x') ? subTxId.slice(2) : subTxId;
      printLog(ctx, `[waitForAllOutboundTxsV2] Resolved queryId: ${cachedQueryId}`);
    }

    try {
      const v2Response = await ctx.pushClient.getUniversalTxByIdV2(cachedQueryId);
      consecutiveErrors = 0; // Reset on successful RPC call
      const utx = v2Response?.universalTx;
      const statusNum = utx?.universalStatus as number;
      const statusName = UniversalTxStatus[statusNum] ?? statusNum;

      printLog(ctx, `[waitForAllOutboundTxsV2] Poll #${pollCount} | status: ${statusNum} (${statusName}) | outboundTx count: ${utx?.outboundTx?.length ?? 0}`);

      if (utx?.outboundTx?.length) {
        for (const ob of utx.outboundTx) {
          const destChain = ob.destinationChain;
          const hopsForChain = chainToHops.get(destChain);
          if (!hopsForChain) continue;

          const unconfirmedForChain = hopsForChain.filter((h) => h.status !== 'confirmed' && h.status !== 'failed');
          if (unconfirmedForChain.length === 0) continue;

          // Fail fast on per-outbound REVERTED
          if (ob.outboundStatus === OutboundStatus.REVERTED) {
            for (const hop of unconfirmedForChain) {
              hop.status = 'failed';
              printLog(ctx, `[waitForAllOutboundTxsV2] Outbound to ${destChain} REVERTED | hop ${hop.hopIndex} | error: ${ob.observedTx?.errorMsg || 'Unknown'}`);
              progressHook?.({
                hopIndex: hop.hopIndex,
                route: hop.route,
                chain: hop.executionChain,
                status: 'failed',
              });
            }
            return { success: false, failedAt: unconfirmedForChain[0].hopIndex };
          }

          // Check for OBSERVED with txHash
          const externalTxHash = ob.observedTx?.txHash;
          if (externalTxHash && (ob.outboundStatus === OutboundStatus.OBSERVED || ob.outboundStatus as number === 0)) {
            const chain = chainFromNamespace(destChain);
            let explorerUrl = '';
            if (chain && externalTxHash) {
              const explorerBaseUrl = CHAIN_INFO[chain]?.explorerUrl;
              const isSvm = CHAIN_INFO[chain]?.vm === VM.SVM;
              if (isSvm && externalTxHash.startsWith('0x')) {
                const bytes = new Uint8Array(Buffer.from(externalTxHash.slice(2), 'hex'));
                const base58Hash = bs58.encode(Buffer.from(bytes));
                const cluster = chain === CHAIN.SOLANA_DEVNET ? '?cluster=devnet'
                  : chain === CHAIN.SOLANA_TESTNET ? '?cluster=testnet' : '';
                explorerUrl = explorerBaseUrl ? `${explorerBaseUrl}/tx/${base58Hash}${cluster}` : '';
              } else {
                explorerUrl = explorerBaseUrl ? `${explorerBaseUrl}/tx/${externalTxHash}` : '';
              }
            }

            for (const hop of unconfirmedForChain) {
              hop.status = 'confirmed';
              hop.txHash = externalTxHash;
              hop.outboundDetails = {
                externalTxHash,
                destinationChain: chain || hop.executionChain,
                explorerUrl,
                recipient: ob.recipient,
                amount: ob.amount,
                assetAddr: ob.externalAssetAddr,
              };

              printLog(ctx, `[waitForAllOutboundTxsV2] FOUND outbound for ${destChain} | hop ${hop.hopIndex} | externalTxHash: ${externalTxHash}`);
              progressHook?.({
                hopIndex: hop.hopIndex,
                route: hop.route,
                chain: hop.executionChain,
                status: 'confirmed',
                txHash: externalTxHash,
              });
            }
          }
        }
      }

      // Check if all hops are now confirmed
      if (outboundHops.every((h) => h.status === 'confirmed')) {
        printLog(ctx, `[waitForAllOutboundTxsV2] All ${outboundHops.length} hops confirmed via V2`);
        return { success: true };
      }

      // If PC_EXECUTED_SUCCESS but some hops still unresolved, check outbound status.
      // Only auto-confirm if there are NO pending outbound txs (status=1 with empty hash).
      // Pending outbounds are still in flight on the relay — keep polling for their hashes.
      if (statusNum === UniversalTxStatus.PC_EXECUTED_SUCCESS) {
        const stillUnresolved = outboundHops.filter((h) => h.status !== 'confirmed');
        if (stillUnresolved.length > 0) {
          const hasPendingOutbound = utx?.outboundTx?.some(
            (ob) =>
              ob.outboundStatus === OutboundStatus.PENDING &&
              (!ob.observedTx?.txHash || ob.observedTx.txHash === 'EMPTY')
          );

          if (!hasPendingOutbound) {
            // No pending outbounds — safe to auto-confirm remaining hops
            for (const hop of stillUnresolved) {
              hop.status = 'confirmed';
              printLog(ctx, `[waitForAllOutboundTxsV2] Auto-confirmed hop ${hop.hopIndex} (${hop.executionChain}) based on PC_EXECUTED_SUCCESS (no pending outbounds)`);
              progressHook?.({
                hopIndex: hop.hopIndex,
                route: hop.route,
                chain: hop.executionChain,
                status: 'confirmed',
              });
            }
            return { success: true };
          }
          // Pending outbound txs still in flight — continue polling
          printLog(ctx, `[waitForAllOutboundTxsV2] ${stillUnresolved.length} hop(s) unresolved, pending outbound txs in flight — continuing to poll`);
        }
      }
    } catch (error) {
      consecutiveErrors++;
      printLog(ctx, `[waitForAllOutboundTxsV2] Poll #${pollCount} ERROR (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error instanceof Error ? error.message : String(error)}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        printLog(ctx, `[waitForAllOutboundTxsV2] Aborting — ${MAX_CONSECUTIVE_ERRORS} consecutive RPC errors`);
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));
  }

  // Timeout: fail any unresolved hops
  const timedOutHops = outboundHops.filter((h) => h.status !== 'confirmed');
  if (timedOutHops.length > 0) {
    printLog(ctx, `[waitForAllOutboundTxsV2] TIMEOUT after ${pollCount} polls | ${timedOutHops.length} hop(s) unresolved`);
    for (const hop of timedOutHops) {
      hop.status = 'failed';
      progressHook?.({
        hopIndex: hop.hopIndex,
        route: hop.route,
        chain: hop.executionChain,
        status: 'failed',
      });
    }
    return { success: false, failedAt: timedOutHops[0].hopIndex };
  }

  return { success: true };
}
