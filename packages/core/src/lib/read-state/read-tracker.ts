/**
 * trackRead / wait / refresh — resume a read from its Push tx hash or requestId
 * and follow it to a terminal status.
 *
 * Source of truth is the node's `ucallback.v1.Query` record. What the node
 * does NOT tell us is parsed from the UniversalCallback logs of the Push txs it
 * lists in `pc_tx` (fulfil → ReadFulfilled | CallbackFailed; settle →
 * CallbackGasReported + RefundSent | RefundFailed).
 *
 * Two rules verified live on Donut (2026-09-09):
 *  - FULFILLED does not mean delivered: the node sets it even when the app
 *    callback reverted. `callbackDelivered` is the real answer (I4).
 *  - EXPIRED has no EVM-indexed tx / receipt / logs (EndBlocker); never fetch
 *    its `pc_tx`. The refund is confirmed from the EndBlock `tx_log` events in the
 *    Cosmos block results instead (RefundSent / RefundFailed); if that lookup fails
 *    the refund fields stay undefined rather than guessed.
 */
import { bytesToHex, type Address, type Hex } from 'viem';
import { PUSH_CHAIN_INFO, UNIVERSAL_CALLBACK_ADDRESSES } from '../constants/chain';
import { CHAIN, PUSH_NETWORK } from '../constants/enums';
import {
  PUSH_BLOCK_TIME_MS,
  READ_NAMESPACE,
  READ_TRACK_LOOKUP_TIMEOUT_MS,
  READ_TRACK_MAX_TIMEOUT_MS,
  READ_TRACK_MIN_POLL_INTERVAL_MS,
  READ_TRACK_POLL_INTERVAL_MS,
} from '../constants/read-state';
import type { UniversalRead } from '../generated/ucallback/v1';
import { PROGRESS_HOOK } from '../progress-hook/progress-hook.types';
import type { PushClient } from '../push-client/push-client';
import { resolveDestination } from './destination';
import { decodeEvmQueryEnvelope, decodeSvmQueryEnvelope, decodeWeb2QueryEnvelope, EVM_QUERY_TYPE, SVM_QUERY_TYPE, WEB2_VALUE_TYPE } from './envelopes';
import { ReadDecodeError, ReadNotFoundError, ReadStateError, ReadTimeoutError } from './errors';
import { parseFulfilOutcome } from './read-events';
import {
  READ_STATUS,
  TERMINAL_READ_STATUSES,
  UNIVERSAL_READ_STATUS,
  type FulfilOutcome,
  type ReadFees,
  type ReadLifecycleOptions,
  type ReadRef,
  type ReadResultShape,
  type ReadSpec,
  type UniversalReadResponse,
  type Web2ValueType,
} from './read-state.types';
import { decodeReadResult } from './result-decoder';

export type ReadHookEmitter = (hookId: string, ...args: unknown[]) => void;

export interface TrackReadDeps {
  pushClient: Pick<PushClient, 'getUniversalRead' | 'getReadsByTx' | 'getTransactionReceiptWithArchiveFallback' | 'getBlockResultEvents'>;
  pushNetwork: PUSH_NETWORK;
  /** Progress events. Wire to `fireProgressHook(ctx, …)` in the orchestrator. */
  emit?: ReadHookEmitter;
  /** Override for tests. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function trackRead(deps: TrackReadDeps, ref: { txHash: Hex }, opts?: ReadLifecycleOptions): Promise<UniversalReadResponse[]>;
export async function trackRead(deps: TrackReadDeps, ref: { requestId: Hex | bigint }, opts?: ReadLifecycleOptions): Promise<UniversalReadResponse>;
export async function trackRead(
  deps: TrackReadDeps,
  ref: ReadRef,
  opts: ReadLifecycleOptions = {},
): Promise<UniversalReadResponse | UniversalReadResponse[]> {
  if ('txHash' in ref) {
    const records = await lookupWithRetry(deps, ref, opts);
    return Promise.all(records.map((r) => buildResponse(deps, r, opts)));
  }
  const [record] = await lookupWithRetry(deps, ref, opts);
  return buildResponse(deps, record, opts);
}

/** Normalise a bigint / hex requestId to the node's lowercase 32-byte key. */
export function toRequestIdHex(id: Hex | bigint): Hex {
  const hex = typeof id === 'bigint' ? id.toString(16) : id.replace(/^0x/i, '');
  return `0x${hex.toLowerCase().padStart(64, '0')}`;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

async function fetchRecords(deps: TrackReadDeps, ref: ReadRef): Promise<UniversalRead[]> {
  if ('txHash' in ref) {
    const { reads } = await deps.pushClient.getReadsByTx(ref.txHash);
    return reads;
  }
  const { read } = await deps.pushClient.getUniversalRead(toRequestIdHex(ref.requestId));
  return read ? [read] : [];
}

/** A request is indexed when its block is processed — briefly retry a miss. */
async function lookupWithRetry(deps: TrackReadDeps, ref: ReadRef, opts: ReadLifecycleOptions): Promise<UniversalRead[]> {
  const now = deps.now ?? Date.now;
  const interval = pollInterval(opts);
  const start = now();
  for (;;) {
    const records = await fetchRecords(deps, ref);
    if (records.length > 0) return records;
    if (now() - start + interval > READ_TRACK_LOOKUP_TIMEOUT_MS) break;
    await sleep(interval);
  }
  const label = 'txHash' in ref ? ref.txHash : toRequestIdHex(ref.requestId);
  throw new ReadNotFoundError(label, 'txHash' in ref ? { txHash: ref.txHash } : { requestId: label });
}

function pollInterval(opts: ReadLifecycleOptions): number {
  return Math.max(READ_TRACK_MIN_POLL_INTERVAL_MS, opts.pollingIntervalMs ?? READ_TRACK_POLL_INTERVAL_MS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Record → response
// ---------------------------------------------------------------------------

async function buildResponse(deps: TrackReadDeps, record: UniversalRead, opts: ReadLifecycleOptions): Promise<UniversalReadResponse> {
  const req = record.request;
  if (!req) throw new ReadStateError('READ_RECORD_INCOMPLETE', 'node record has no request', { requestId: record.id });

  const requestId = toRequestIdHex(record.id as Hex);
  const status = record.status as number as UNIVERSAL_READ_STATUS;
  const isTerminal = TERMINAL_READ_STATUSES.has(status);
  const destination = resolveDestination({ chain: req.destinationChain as CHAIN });
  const callbackBudget = BigInt(req.callbackBudget || '0');

  const spec: ReadSpec = {
    account: { chainNamespace: destination.chainNamespace, chainId: destination.chainId, owner: bytesToHex(req.owner) },
    query: bytesToHex(req.query),
    minConfirmations: req.minConfirmations,
    blockNumber: BigInt(req.destinationBlockHeight),
    expiryPushChainHeight: BigInt(req.expiryBlockHeight),
    maxFee: BigInt(req.maxFee || '0'),
    revertRecipient: req.revertRecipient as Address,
  };

  const fees: ReadFees = {
    paid: BigInt(req.feesDeposited || '0'),
    protocolFee: BigInt(req.protocolFee || '0'),
    callbackBudget,
  };

  // Settlement facts live in the logs of the node's own txs.
  let outcome: FulfilOutcome = {};
  if (status === UNIVERSAL_READ_STATUS.EXPIRED) {
    // EndBlocker expiry: no receipt exists. The contract pushes the full budget to
    // refundTo, but a rejecting recipient does not prevent EXPIRED — so read the
    // RefundSent / RefundFailed logs from the block results instead of assuming.
    outcome = await collectExpiryOutcome(deps, record, requestId);
    if (outcome.refunded !== undefined) fees.refunded = outcome.refunded;
    if (outcome.refundFailed !== undefined) fees.refundFailed = outcome.refundFailed;
  } else if (status === UNIVERSAL_READ_STATUS.FULFILLED || status === UNIVERSAL_READ_STATUS.FAILED) {
    outcome = await collectOutcome(deps, record, requestId);
    if (outcome.burned !== undefined) fees.burned = outcome.burned;
    if (outcome.refunded !== undefined) fees.refunded = outcome.refunded;
    if (outcome.refundFailed !== undefined) fees.refundFailed = outcome.refundFailed;
  }

  const raw = record.result
    ? { status: record.result.status as number as READ_STATUS, resultData: bytesToHex(record.result.resultData), errorCode: record.result.errorCode as number }
    : null;

  const callbackDelivered = status === UNIVERSAL_READ_STATUS.FULFILLED ? outcome.delivered : undefined;

  let decoded: UniversalReadResponse['decoded'];
  let decodeError: string | undefined;
  let value: unknown;
  if (status === UNIVERSAL_READ_STATUS.FULFILLED && callbackDelivered && raw?.status === READ_STATUS.SUCCESS) {
    const shape = opts.resultShape ?? inferResultShape(destination.namespace, spec.query);
    try {
      decoded = decodeReadResult(raw.resultData, shape);
      value = 'values' in decoded ? decoded.values : decoded.value;
    } catch (e) {
      decodeError = e instanceof ReadDecodeError ? e.message : String(e);
    }
  }

  const txHash = req.requestedTxHash.toLowerCase() as Hex;
  const response: UniversalReadResponse = {
    requestId,
    txHash,
    destination,
    chain: chainFromCaip2(destination.caip2),
    status,
    isTerminal,
    callbackDelivered,
    callbackFailReason: outcome.failReason,
    value,
    decoded,
    decodeError,
    raw,
    errorMsg: record.errorMsg,
    fees,
    request: {
      spec,
      callbackTarget: req.callbackTarget as Address,
      originalFunder: req.originalFunder as Address,
      refundTo: req.revertRecipient as Address,
      callbackGasLimit: BigInt(req.callbackGasLimit),
      logIndex: req.requestedLogIndex,
      createdAtHeight: BigInt(req.createdAtHeight),
    },
    pcTx: record.pcTx.map((t) => ({ txHash: t.txHash as Hex, blockHeight: t.blockHeight, status: t.status, errorMsg: t.errorMsg })),
    explorerUrl: explorerTxUrl(deps.pushNetwork, txHash),
    refresh: () => trackRead(deps, { requestId }, opts),
    wait: (waitOpts) => waitForRead(deps, response, { ...opts, ...waitOpts }),
  };
  return response;
}

/** Parse every pc_tx receipt (fulfil, settle) into one merged outcome. Missing receipts are skipped. */
async function collectOutcome(deps: TrackReadDeps, record: UniversalRead, requestId: Hex): Promise<FulfilOutcome> {
  const uc = UNIVERSAL_CALLBACK_ADDRESSES[deps.pushNetwork];
  const merged: FulfilOutcome = {};
  for (const t of record.pcTx) {
    if (!t.txHash) continue;
    try {
      const receipt = await deps.pushClient.getTransactionReceiptWithArchiveFallback(t.txHash as Hex);
      const o = parseFulfilOutcome(receipt, uc, requestId);
      for (const [k, v] of Object.entries(o)) {
        if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
      }
    } catch {
      // pruned or not yet available — leave those fields undefined rather than guess
    }
  }
  return merged;
}

/**
 * Expiry runs in the EndBlocker, so its UniversalCallback logs exist only as Cosmos
 * `tx_log` events (`mode: EndBlock`) at the sweeper's block. Each `txLog` attribute is
 * one JSON log with base64 `data`. Any failure leaves the outcome empty (unknown).
 */
async function collectExpiryOutcome(deps: TrackReadDeps, record: UniversalRead, requestId: Hex): Promise<FulfilOutcome> {
  const heights = [...new Set(record.pcTx.map((t) => t.blockHeight).filter((h) => h > 0))].sort((a, b) => b - a);
  for (const height of heights) {
    try {
      const events = await deps.pushClient.getBlockResultEvents(height);
      const logs: { address: string; topics: string[]; data: string }[] = [];
      for (const ev of events) {
        if (ev.type !== 'tx_log') continue;
        if (!ev.attributes.some((a) => a.key === 'mode' && a.value === 'EndBlock')) continue;
        for (const a of ev.attributes) {
          if (a.key !== 'txLog') continue;
          try {
            const log = JSON.parse(a.value) as { address: string; topics: string[]; data: string };
            if (typeof log.address !== 'string' || !Array.isArray(log.topics) || !log.topics.every((t) => typeof t === 'string')) continue;
            const data = typeof log.data === 'string' && log.data.startsWith('0x') ? log.data : bytesToHex(new Uint8Array(Buffer.from(log.data ?? '', 'base64')));
            logs.push({ address: log.address, topics: log.topics, data });
          } catch { /* An unrelated malformed log must not hide this request's refund. */ }
        }
      }
      const out = parseFulfilOutcome({ logs }, UNIVERSAL_CALLBACK_ADDRESSES[deps.pushNetwork], requestId);
      // RequestExpired carries the amount the contract tried to push; only RefundSent /
      // RefundFailed say whether it landed. Report the amount only when it did.
      if (out.refundFailed === true) return { refundFailed: true };
      if (out.refundFailed === false) return { refunded: out.refunded, refundFailed: false };
    } catch {
      // One unavailable attempt must not hide matching logs at another height.
    }
  }
  return {};
}

/** Best-effort shape from the on-chain envelope. Contract calls carry no ABI → raw. */
export function inferResultShape(namespace: string, query: Hex): ReadResultShape {
  try {
    switch (namespace) {
      case READ_NAMESPACE.EVM: {
        const { queryType } = decodeEvmQueryEnvelope(query);
        if (queryType === EVM_QUERY_TYPE.ACCOUNT_BALANCE) return { kind: 'uint256' };
        if (queryType === EVM_QUERY_TYPE.STORAGE_SLOT) return { kind: 'bytes32' };
        return { kind: 'raw' };
      }
      case READ_NAMESPACE.SVM: {
        const { queryType } = decodeSvmQueryEnvelope(query);
        return queryType === SVM_QUERY_TYPE.RAW_ACCOUNT_DATA ? { kind: 'raw' } : { kind: 'uint256' };
      }
      case READ_NAMESPACE.WEB2: {
        const { extract } = decodeWeb2QueryEnvelope(query);
        const byNumber = Object.fromEntries(Object.entries(WEB2_VALUE_TYPE).map(([name, n]) => [n, name])) as Record<number, Web2ValueType>;
        return {
          kind: 'web2',
          extract: extract.map((e) => ({ path: e.path, valueType: byNumber[e.valueType] ?? 'bytes', decimals: e.decimals })),
        };
      }
      default:
        return { kind: 'raw' };
    }
  } catch {
    return { kind: 'raw' };
  }
}

function chainFromCaip2(caip2: string): CHAIN | undefined {
  return (Object.values(CHAIN) as string[]).includes(caip2) ? (caip2 as CHAIN) : undefined;
}

function explorerTxUrl(network: PUSH_NETWORK, txHash: Hex): string {
  const chain = network === PUSH_NETWORK.MAINNET ? CHAIN.PUSH_MAINNET : network === PUSH_NETWORK.LOCALNET ? CHAIN.PUSH_LOCALNET : CHAIN.PUSH_TESTNET_DONUT;
  const base = PUSH_CHAIN_INFO[chain].explorerUrl ?? 'https://explorer.donut.push.org';
  return `${base}/tx/${txHash}`;
}

// ---------------------------------------------------------------------------
// wait()
// ---------------------------------------------------------------------------

const STATUS_NAME: Record<number, string> = {
  [UNIVERSAL_READ_STATUS.UNSPECIFIED]: 'UNSPECIFIED',
  [UNIVERSAL_READ_STATUS.PENDING]: 'PENDING',
  [UNIVERSAL_READ_STATUS.VOTING]: 'VOTING',
  [UNIVERSAL_READ_STATUS.FULFILLED]: 'FULFILLED',
  [UNIVERSAL_READ_STATUS.EXPIRED]: 'EXPIRED',
  [UNIVERSAL_READ_STATUS.FAILED]: 'FAILED',
  [UNIVERSAL_READ_STATUS.ABORTED]: 'ABORTED',
};

export function statusName(status: number): string {
  return STATUS_NAME[status] ?? `UNKNOWN(${status})`;
}

/** Default: the request's own lifetime in wall-clock, capped. */
export function defaultWaitTimeoutMs(createdAtHeight: bigint, expiryPushChainHeight: bigint): number {
  const blocks = expiryPushChainHeight > createdAtHeight ? Number(expiryPushChainHeight - createdAtHeight) : 0;
  return Math.min(READ_TRACK_MAX_TIMEOUT_MS, Math.max(READ_TRACK_MIN_POLL_INTERVAL_MS, blocks * PUSH_BLOCK_TIME_MS));
}

/**
 * Poll until terminal. Resolves on EVERY terminal status (EXPIRED / FAILED / ABORTED
 * are statuses, not throws — house convention); only a client timeout throws.
 */
export async function waitForRead(deps: TrackReadDeps, initial: UniversalReadResponse, opts: ReadLifecycleOptions): Promise<UniversalReadResponse> {
  const now = deps.now ?? Date.now;
  const emit: ReadHookEmitter = deps.emit ?? (() => undefined);
  const interval = pollInterval(opts);
  const timeoutMs = opts.timeoutMs ?? defaultWaitTimeoutMs(initial.request.createdAtHeight, initial.request.spec.expiryPushChainHeight);
  const start = now();

  emit(PROGRESS_HOOK.READ_TX_104_02, initial.txHash, initial.requestId, initial.request.logIndex);

  // Every snapshot taken from here on is built with the wait() options, so a
  // resultShape given to wait() decodes even a record that is already terminal.
  let current = initial;
  const timeout = (): never => {
    const elapsed = now() - start;
    emit(PROGRESS_HOOK.READ_TX_199_03, current.requestId, statusName(current.status), elapsed);
    throw new ReadTimeoutError(current.status, elapsed, { requestId: current.requestId, txHash: current.txHash });
  };
  // A single deadline includes RPC/receipt latency. A missing snapshot must not
  // start trackRead's separate initial-ingestion retry window.
  const reload = async (): Promise<UniversalReadResponse> => {
    const remaining = timeoutMs - (now() - start);
    if (remaining <= 0) return timeout();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const records = await fetchRecords(deps, { requestId: initial.requestId });
          return records[0] ? buildResponse(deps, records[0], opts) : current;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            try { timeout(); } catch (error) { reject(error); }
          }, remaining);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  if (initial.isTerminal && opts.resultShape !== undefined) current = await reload();
  let announced: UNIVERSAL_READ_STATUS | undefined;
  for (;;) {
    if (current.isTerminal) {
      emitTerminal(emit, current);
      return current;
    }
    if (current.status !== announced) {
      announced = current.status;
      if (current.status === UNIVERSAL_READ_STATUS.PENDING) emit(PROGRESS_HOOK.READ_TX_105_01, current.requestId);
      else if (current.status === UNIVERSAL_READ_STATUS.VOTING) emit(PROGRESS_HOOK.READ_TX_105_02, current.requestId);
    }
    const elapsed = now() - start;
    if (elapsed >= timeoutMs) timeout();
    await sleep(Math.min(interval, timeoutMs - elapsed));
    current = await reload();
  }
}

function emitTerminal(emit: ReadHookEmitter, r: UniversalReadResponse): void {
  if (r.status === UNIVERSAL_READ_STATUS.FULFILLED) {
    if (r.callbackDelivered === true) emit(PROGRESS_HOOK.READ_TX_106_02, r.requestId);
    else if (r.callbackDelivered === false) emit(PROGRESS_HOOK.READ_TX_106_03, r.requestId, r.callbackFailReason);
    if (r.fees.burned !== undefined) emit(PROGRESS_HOOK.READ_TX_106_04, r.requestId, r.fees.burned, r.fees.refunded ?? 0n);
    if (r.fees.refundFailed === true) emit(PROGRESS_HOOK.READ_TX_106_06, r.requestId, r.fees.refunded, r.request.refundTo);
    else if (r.fees.refunded !== undefined) emit(PROGRESS_HOOK.READ_TX_106_05, r.requestId, r.fees.refunded, r.request.refundTo);
    emit(PROGRESS_HOOK.READ_TX_199_01, r.requestId, r.value, r.raw?.resultData ?? '0x', r.callbackDelivered);
    return;
  }
  emit(PROGRESS_HOOK.READ_TX_199_02, r.requestId, statusName(r.status), r.raw?.errorCode, r.errorMsg, r.fees.refunded);
}
