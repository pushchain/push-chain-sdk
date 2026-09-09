import { isAddress, type Hex } from 'viem';
import type { Orchestrator } from '../orchestrator/orchestrator';
import { InvalidReadQueryError, ReadRegistryUnavailableError, ReadStateError } from './errors';
import type { PreparedRead, ReadCallback, ReadRequestEntrypoint, UniversalReadResponse } from './read-state.types';
import { toLifecycleOptions, type ReadExecuteOptions } from './read-params';
import { encodeSpec, toCallData } from './spec-builder';

export type ReadExecutorDeps = Pick<Orchestrator, 'execute' | 'trackRead'>;

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
  const calls = reads.map(readCall);
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
    if (committed.length === 0) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new ReadStateError(
      'READ_REQUEST_TX_FAILED',
      `read request batch failed after ${committed.length} of ${calls.length} calls were mined: ${reason}`,
      { txHash: committed[committed.length - 1], hint: `Resume the committed reads with trackRead({ txHash }) for: ${committed.join(', ')}` },
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
  return Promise.all(ordered.map(async (record, i) => {
    const opts = { ...lifecycle, resultShape: reads[i].encodedQuery.resultShape };
    const response = await deps.trackRead({ requestId: record.requestId }, opts);
    return options.waitForCompletion === false ? response : response.wait();
  }));
}
