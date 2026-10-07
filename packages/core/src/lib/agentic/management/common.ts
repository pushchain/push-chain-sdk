import { getAddress, type Address, type Hex, type Log } from 'viem';
import type { MultiCall, UniversalTxResponse } from '../../orchestrator/orchestrator.types';
import {
  PushChainBatchExecutionError,
  PushChainExecutionError,
  type DecodedErrorPayload,
} from '../../orchestrator/internals/errors';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import type { AgenticGeneration } from '../deployments';
import { AGENTIC_ERROR_CODE, AgenticError, AgenticRevertError } from '../errors';
import type { AgenticRuntime } from '../runtime';
import type { AgenticProgressHook } from '../agentic.types';
import { Snapshot } from '../reads/snapshot';
import { decodeAgenticRevert } from '../revert';

export function emitAgentic(
  runtime: AgenticRuntime,
  perCall: AgenticProgressHook | undefined,
  id: PROGRESS_HOOK,
  ...args: unknown[]
): void {
  runtime.emit(PROGRESS_HOOKS[id](...args), perCall);
}

export function assertCanSign(runtime: AgenticRuntime, operation: string): void {
  if (runtime.isReadOnly) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.READ_ONLY,
      `${operation} needs a signer; this client was initialized read-only`
    );
  }
}

/** Owner-only management writes: the connected signer's Push identity must be the stored owner. */
export async function assertOwner(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  wallet: Address,
  snap: Snapshot
): Promise<Address> {
  const owner = getAddress(await snap.read<Address>(wallet, gen.contracts.abis.wallet, 'owner'));
  const signer = runtime.signerPushAccount();
  if (owner !== signer) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.NOT_WALLET_OWNER,
      `${signer} is not the owner of ${wallet} (owner is ${owner})`,
      { hint: 'Rule and label writes are owner-only. Initialize with the owner signer.' }
    );
  }
  return owner;
}

/**
 * Send owner calls through the signer's ordinary transaction path: one call
 * as a plain transaction, several as the signer's batch (UEA multicall,
 * EIP-7702 atomic batch, or the documented sequential fallback for a Push EOA
 * without 7702 — reported through `atomic` / `transactionHashes`).
 */
export async function sendOwnerCalls(
  runtime: AgenticRuntime,
  calls: MultiCall[],
  progressHook: AgenticProgressHook | undefined
): Promise<UniversalTxResponse> {
  if (calls.length === 0) throw new Error('sendOwnerCalls needs at least one call');
  const options = progressHook ? { progressHook } : undefined;
  if (calls.length === 1) {
    return runtime.execute({ to: calls[0].to, value: calls[0].value, data: calls[0].data }, options);
  }
  return runtime.execute({ to: calls[0].to, value: BigInt(0), data: calls }, options);
}

/**
 * Wait for every Push transaction the operation produced and return their
 * logs in submission order. A reverted transaction raises AgenticRevertError
 * carrying all hashes.
 */
export async function confirmedLogs(
  runtime: AgenticRuntime,
  tx: UniversalTxResponse
): Promise<{ logs: Log[]; hashes: Hex[] }> {
  const hashes = (tx.transactionHashes ?? [tx.hash as Hex]) as Hex[];
  const unavailable = (cause: unknown) =>
    new AgenticError(
      AGENTIC_ERROR_CODE.RECEIPT_UNAVAILABLE,
      `submitted ${tx.hash} but could not read its receipt: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        hint: 'The transaction may still land. Check these hashes before retrying.',
        details: { txHash: tx.hash, transactionHashes: hashes },
        cause,
      }
    );
  let receipt;
  try {
    receipt = await tx.wait();
  } catch (cause) {
    throw unavailable(cause);
  }
  if (hashes.length === 1) {
    if (receipt.status !== 1) {
      throw new AgenticRevertError(`Push transaction ${tx.hash} reverted`, {
        transactionHashes: hashes,
      });
    }
    return { logs: receipt.logs as Log[], hashes };
  }
  const logs: Log[] = [];
  for (const hash of hashes) {
    let r;
    try {
      r = await runtime.reader.getTransactionReceipt({ hash });
    } catch (cause) {
      throw unavailable(cause);
    }
    if (r.status !== 'success') {
      throw new AgenticRevertError(`Push transaction ${hash} reverted`, { transactionHashes: hashes });
    }
    logs.push(...(r.logs as Log[]));
  }
  return { logs, hashes };
}

/** Normalize a send failure: keep batch hashes and decoded revert data. */
export function wrapSendError(err: unknown): unknown {
  if (err instanceof AgenticError || err instanceof AgenticRevertError) return err;
  const decoded = decodeAgenticRevert(err);
  if (err instanceof PushChainBatchExecutionError) {
    return new AgenticRevertError(err.message, {
      decodedError: decoded ?? err.decodedError,
      transactionHashes: err.transactionHashes,
      pendingTransactionHash: err.pendingTransactionHash,
      cause: err,
    });
  }
  if (decoded || err instanceof PushChainExecutionError) {
    const e = err as { message?: string; gatewayTxHash?: string; decodedError?: DecodedErrorPayload };
    return new AgenticRevertError(e?.message ?? decoded?.name ?? 'AGW revert', {
      decodedError: decoded ?? e?.decodedError,
      gatewayTxHash: e?.gatewayTxHash,
      agenticCode: decoded?.name,
      cause: err,
    });
  }
  return err;
}
