import { isAddress, type Hex } from 'viem';
import type { Orchestrator } from '../orchestrator/orchestrator';
import { InvalidReadQueryError, ReadRegistryUnavailableError, ReadStateError, ReadTimeoutError } from './errors';
import type { PreparedRead, ReadCallback, ReadRequestEntrypoint, UniversalReadResponse } from './read-state.types';
import { toLifecycleOptions, type ReadExecuteOptions } from './read-params';
import { encodeSpec, toCallData } from './spec-builder';
import PROGRESS_HOOKS from '../progress-hook/progress-hook';
import { PROGRESS_HOOK } from '../progress-hook/progress-hook.types';
import { READ_STATUS, UNIVERSAL_READ_STATUS } from './read-state.types';

export type ReadExecutorDeps = Pick<Orchestrator, 'execute' | 'trackRead' | 'revalidateRead'> & Partial<Pick<Orchestrator, 'getProgressHook'>>;

/**
 * The custom-receiver contract of `read()` / `executeReads()`: a non-zero target and the
 * app's request entrypoint. Pure — call it before any preflight so a malformed request
 * fails without a network round-trip.
 */
export function assertRequestEntrypoint(callback: ReadCallback | undefined, method = 'executeReads'): Required<Pick<ReadCallback, 'target'>> & { request: ReadRequestEntrypoint } {
  const { target, request } = callback ?? {};
  if (!target) throw new ReadRegistryUnavailableError(method);
  if (!isAddress(target) || /^0x0{40}$/i.test(target)) throw new InvalidReadQueryError('callback.target must be a non-zero address');
  if (!request) throw new InvalidReadQueryError('callback.request must specify the app request ABI and functionName');
  if (!Array.isArray(request.abi) || !request.functionName) throw new InvalidReadQueryError('callback.request needs abi and functionName');
  return { target, request };
}

/** Validate every app call before sending any transaction. */
export function readCall(prepared: PreparedRead) {
  const { target, request } = assertRequestEntrypoint(prepared.callback);
  return { to: target, ...toCallData(prepared, request) };
}

/** Sequential wallet fallback attaches the hashes it already mined to the error it throws. */
function committedHashes(err: unknown): Hex[] {
  const hashes = (err as { transactionHashes?: unknown } | null)?.transactionHashes;
  return Array.isArray(hashes) ? (hashes as Hex[]) : [];
}

export async function executeReads(
  deps: ReadExecutorDeps,
  reads: PreparedRead[],
  options: ReadExecuteOptions = {},
): Promise<UniversalReadResponse[]> {
  if (reads.length === 0) return [];
  const hooks = new Set([deps.getProgressHook?.(), options.progressHook]);
  const emit = (id: PROGRESS_HOOK, ...args: unknown[]) => {
    for (const hook of hooks) if (hook) hook(PROGRESS_HOOKS[id](...args));
  };
  const batch = reads.length > 1;
  let failedAt = 0; // 0 denotes a batch-wide failure before an individual read is known.
  if (batch) emit(PROGRESS_HOOK.READ_TX_001, reads.length, reads.map(r => r.preflight.destination.caip2));
  try {
    const calls = reads.map(readCall);
    // Validate the whole batch against current state before sending any request.
    for (const [i, prepared] of reads.entries()) {
      failedAt = i + 1;
      if (batch) emit(PROGRESS_HOOK.READ_TX_002_01, i + 1, reads.length, prepared.preflight.destination.caip2);
      await deps.revalidateRead(prepared);
    }
    failedAt = 0;
    emit(PROGRESS_HOOK.READ_TX_104_01);
    let tx: Awaited<ReturnType<ReadExecutorDeps['execute']>>;
    try {
      tx = await deps.execute(
        calls.length === 1 ? calls[0] : { to: calls[0].to, data: calls },
        { enforceGasCheck: options.advanced?.enforceGasCheck, progressHook: options.progressHook },
      );
    } catch (err) {
      // A non-atomic batch can fail after earlier calls were mined: those reads exist,
      // their budgets are escrowed, and only these hashes lead back to them.
      const committed = committedHashes(err);
      const pending = (err as { pendingTransactionHash?: Hex } | null)?.pendingTransactionHash;
      if (committed.length === 0 && !pending) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      throw new ReadStateError(
        'READ_REQUEST_TX_FAILED',
        `read request batch failed after ${committed.length} of ${calls.length} calls were mined: ${reason}`,
        {
          txHash: committed[committed.length - 1] ?? pending,
          transactionHashes: committed,
          pendingTransactionHash: pending,
          hint: [
            committed.length ? `Resume the committed reads with trackRead({ txHash }) for: ${committed.join(', ')}` : '',
            pending ? `Check the receipt of broadcast transaction ${pending} before retrying; its outcome is unknown` : '',
          ].filter(Boolean).join('; '),
        },
      );
    }
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new ReadStateError('READ_REQUEST_TX_FAILED', 'read request transaction reverted', { txHash: tx.hash });
    const hashes = tx.transactionHashes ?? [tx.hash as Hex];
    const lifecycle = { ...toLifecycleOptions(options), progressHook: options.progressHook };
    const groups = await Promise.all(hashes.map((txHash) => deps.trackRead({ txHash }, lifecycle)));
    const remaining = groups.flatMap((group) => [...group].sort((a, b) => a.request.logIndex - b.request.logIndex));
    // Each entrypoint must emit one matching request. Never silently attach another
    // read's ABI/result to an input, even if the app emitted unexpected extra logs.
    const ordered = reads.map((prepared, i) => {
      const index = remaining.findIndex((r) =>
        r.request.callbackTarget.toLowerCase() === calls[i].to.toLowerCase() &&
        r.request.callbackGasLimit === prepared.callbackGasLimit &&
        encodeSpec(r.request.spec).toLowerCase() === encodeSpec(prepared.spec).toLowerCase(),
      );
      if (index < 0) throw new ReadStateError('READ_REQUEST_MISMATCH', `no matching request for prepared read ${i}; resume using the Push transaction hashes: ${hashes.join(', ')}`, { txHash: tx.hash });
      return remaining.splice(index, 1)[0];
    });
    if (remaining.length) throw new ReadStateError('READ_REQUEST_MISMATCH', `app emitted unexpected extra reads; resume using the Push transaction hashes: ${hashes.join(', ')}`, { txHash: tx.hash });
    const results = await Promise.all(ordered.map(async (record, i) => {
      try {
        const opts = { ...lifecycle, resultShape: reads[i].encodedQuery.resultShape };
        const response = await deps.trackRead({ requestId: record.requestId }, opts);
        if (options.waitForCompletion === false) {
          emit(PROGRESS_HOOK.READ_TX_104_02, response.txHash, response.requestId, response.request.logIndex);
          return response;
        }
        const terminal = await response.wait();
        if (batch) emit(PROGRESS_HOOK.READ_TX_002_99_99, i + 1, reads.length, terminal.requestId);
        return terminal;
      } catch (error) {
        if (failedAt === 0) failedAt = i + 1;
        throw error;
      }
    }));
    if (batch && options.waitForCompletion !== false) {
      const failed = results.findIndex(r => r.status !== UNIVERSAL_READ_STATUS.FULFILLED || r.callbackDelivered !== true || r.raw?.status !== READ_STATUS.SUCCESS);
      if (failed < 0) emit(PROGRESS_HOOK.READ_TX_999_01, results.length);
      else emit(PROGRESS_HOOK.READ_TX_999_02, failed + 1, results.length, results[failed].errorMsg || 'Read or callback did not succeed');
    }
    return results;
  } catch (error) {
    if (batch) {
      if (error instanceof ReadTimeoutError) emit(PROGRESS_HOOK.READ_TX_999_03, failedAt, reads.length);
      else emit(PROGRESS_HOOK.READ_TX_999_02, failedAt, reads.length, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}
