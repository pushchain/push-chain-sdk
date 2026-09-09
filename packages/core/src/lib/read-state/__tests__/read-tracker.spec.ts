/**
 * trackRead / wait / refresh against a scripted node and the real Donut fixtures.
 * Fake timers: no test here waits on the clock.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Hex } from 'viem';
import { PUSH_NETWORK } from '../../constants/enums';
import { READ_TRACK_MAX_TIMEOUT_MS, READ_TRACK_POLL_INTERVAL_MS } from '../../constants/read-state';
import { QueryUniversalReadResponse, UniversalReadStatus, type UniversalRead } from '../../generated/ucallback/v1';
import { PROGRESS_HOOK, type ProgressEvent } from '../../progress-hook/progress-hook.types';
import { TransactionRoute } from '../../orchestrator/route-detector';
import type { OrchestratorContext } from '../../orchestrator/internals/context';
import { trackRead as trackReadViaCtx } from '../../orchestrator/internals/read-state';
import { ReadNotFoundError, ReadTimeoutError } from '../errors';
import { REFUND_FAILED_TOPIC0 } from '../read-events';
import { defaultWaitTimeoutMs, inferResultShape, toRequestIdHex, trackRead, type TrackReadDeps } from '../read-tracker';
import { UNIVERSAL_READ_STATUS, READ_STATUS, READ_ERROR_CODE } from '../read-state.types';
import fulfilSuccess from './fixtures/receipts/fulfil.success-evm.json';
import settleSuccess from './fixtures/receipts/settle.success-evm.json';
import fulfilReverted from './fixtures/receipts/fulfil.callback-reverted.json';
import expiredBlockResults from './fixtures/node/block-results.22963638.expired.json';

const node = (name: string): UniversalRead =>
  QueryUniversalReadResponse.decode(
    new Uint8Array(Buffer.from(readFileSync(join(__dirname, 'fixtures', 'node', `universal-read.${name}.b64`), 'utf8').trim(), 'base64')),
  ).read!;

const RECEIPTS: Record<string, unknown> = {
  '0x1d241ed89c868aa7d032ecb82aaf9608d7a8822def82dbd704ce5d2dd59899d2': fulfilSuccess,
  '0x47eb5d30423c462b9b0b860fa764f0e0efea26fc370065f42a36e8c72ec5d603': settleSuccess,
  '0x717295e90376de52f341e47a1530ad0704fe27b5d9ffadc79eec0825d2972d43': fulfilReverted,
};

const READ2_ID = '0xf3d62fb962c84259e728d184dd2e3199c4d6c39790e20d60f2bacf0c10eca168' as const;
const READ2_TX = '0x8329b6134cc622fb58a015e54ec11d5bb38b604f8a3d42e62133fc31047ae732' as const;

/** A node that answers `getUniversalRead` from a script (last entry repeats) and receipts from the fixture map. */
function scriptedDeps(script: (UniversalRead | undefined)[], extra: Partial<TrackReadDeps> = {}) {
  let i = 0;
  const calls = { getUniversalRead: 0, getReadsByTx: 0, receipts: [] as string[], blockResults: [] as number[] };
  const deps: TrackReadDeps = {
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    pushClient: {
      getUniversalRead: async () => {
        calls.getUniversalRead++;
        const read = script[Math.min(i++, script.length - 1)];
        return { read };
      },
      getReadsByTx: async () => {
        calls.getReadsByTx++;
        const read = script[Math.min(i++, script.length - 1)];
        return { reads: read ? [read] : [] };
      },
      getTransactionReceiptWithArchiveFallback: async (hash: Hex) => {
        calls.receipts.push(hash);
        const r = RECEIPTS[hash.toLowerCase()];
        if (!r) throw new Error(`no receipt for ${hash}`);
        return r as never;
      },
      getBlockResultEvents: async (height: number) => {
        calls.blockResults.push(height);
        if (height !== 22963638) throw new Error(`no block results for ${height}`);
        return expiredBlockResults.result.finalize_block_events as never;
      },
    } as never,
    ...extra,
  };
  return { deps, calls };
}

const withStatus = (r: UniversalRead, status: UniversalReadStatus): UniversalRead => ({ ...r, status, result: undefined, pcTx: [] });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('trackRead — terminal records straight from the node', () => {
  it('FULFILLED + delivered: value decoded, fees from the fulfil and settle receipts', async () => {
    const { deps, calls } = scriptedDeps([node('success-evm')]);
    const r = await trackRead(deps, { requestId: READ2_ID });
    expect(r.requestId).toBe(READ2_ID);
    expect(r.txHash).toBe(READ2_TX);
    expect(r.status).toBe(UNIVERSAL_READ_STATUS.FULFILLED);
    expect(r.isTerminal).toBe(true);
    expect(r.callbackDelivered).toBe(true);
    expect(r.value).toBe(2706196938206701455473n);
    expect(r.decoded).toEqual({ kind: 'uint256', value: 2706196938206701455473n });
    expect(r.raw).toEqual({
      status: READ_STATUS.SUCCESS,
      resultData: '0x000000000000000000000000000000000000000000000092b406e140cc2c8871',
      errorCode: READ_ERROR_CODE.UNSPECIFIED,
    });
    expect(r.fees).toEqual({
      paid: 50_000_000_000_000_000n,
      protocolFee: 0n,
      callbackBudget: 50_000_000_000_000_000n,
      burned: 118_289_000_000_000n,
      refunded: 49_881_711_000_000_000n,
      refundFailed: false,
    });
    expect(r.fees.burned! + r.fees.refunded!).toBe(r.fees.callbackBudget);
    expect(r.chain).toBe('eip155:11155111');
    expect(r.destination.caip2).toBe('eip155:11155111');
    expect(r.request.callbackTarget.toLowerCase()).toBe('0x5f7221d31a01a71662cabeec2567c55ad03e2fb7');
    expect(r.request.refundTo.toLowerCase()).toBe('0x0a16cba65ffcaa4c2282b27b027ab4a2fe46e0bf');
    expect(r.request.spec.blockNumber).toBe(11667326n);
    expect(r.request.spec.expiryPushChainHeight).toBe(22958748n);
    expect(r.request.callbackGasLimit).toBe(200000n);
    expect(r.request.logIndex).toBe(1);
    expect(r.pcTx).toHaveLength(2);
    expect(r.explorerUrl).toBe(`https://explorer.donut.push.org/tx/${READ2_TX}`);
    expect(calls.receipts).toHaveLength(2); // fulfil + settle, exactly once each
  });

  it('FULFILLED but the callback reverted: callbackDelivered=false, no value (I4)', async () => {
    const { deps } = scriptedDeps([node('callback-reverted')]);
    const r = await trackRead(deps, { requestId: '0x9f0466e2a3f7c20e3af1f104df7cdb254e3ff00ba50b646ccb622d648462aabe' });
    expect(r.status).toBe(UNIVERSAL_READ_STATUS.FULFILLED);
    expect(r.raw?.status).toBe(READ_STATUS.SUCCESS); // consensus succeeded…
    expect(r.callbackDelivered).toBe(false); // …but the app never received it
    expect(r.callbackFailReason).toBeDefined();
    expect(r.value).toBeUndefined();
    expect(r.decoded).toBeUndefined();
  });

  it('FULFILLED with an ERROR result: raw carries the code, value undefined, delivered still parsed', async () => {
    const { deps, calls } = scriptedDeps([node('error-invalid-query')]);
    const r = await trackRead(deps, { requestId: '0xeba3eb9efad8c867bd19a66d925b5febae02efb5151faaf20d9fa8ea799c0d71' });
    expect(r.raw).toEqual({ status: READ_STATUS.ERROR, resultData: '0x', errorCode: READ_ERROR_CODE.INVALID_QUERY });
    expect(r.value).toBeUndefined();
    expect(r.callbackDelivered).toBeUndefined(); // receipts for this read are not in the fixture set
    expect(calls.receipts).toHaveLength(2); // it still tried both pc_tx
  });

  it('EXPIRED: never fetches a receipt; the refund is confirmed from the EndBlock tx_log events', async () => {
    const { deps, calls } = scriptedDeps([node('expired')]);
    const r = await trackRead(deps, { requestId: '0x4a6e27e003a8801f7f5dffff3beb8af6836b9e68a99c94bbb22dc95b180857a9' });
    expect(r.status).toBe(UNIVERSAL_READ_STATUS.EXPIRED);
    expect(r.isTerminal).toBe(true);
    expect(r.callbackDelivered).toBeUndefined();
    expect(r.fees.refunded).toBe(50_000_000_000_000_000n); // RefundSent in block 22963638, mode EndBlock
    expect(r.fees.refundFailed).toBe(false);
    expect(r.fees.burned).toBeUndefined();
    expect(calls.receipts).toEqual([]);
    expect(calls.blockResults).toEqual([22963638]);
    expect(r.request.spec.minConfirmations).toBe(500);
  });

  it('EXPIRED: when the block results are unavailable the refund stays unknown, never guessed', async () => {
    const { deps, calls } = scriptedDeps([node('expired')]);
    deps.pushClient.getBlockResultEvents = async () => { throw new Error('pruned'); };
    const r = await trackRead(deps, { requestId: '0x4a6e27e003a8801f7f5dffff3beb8af6836b9e68a99c94bbb22dc95b180857a9' });
    expect(r.status).toBe(UNIVERSAL_READ_STATUS.EXPIRED);
    expect(r.fees.refunded).toBeUndefined();
    expect(r.fees.refundFailed).toBeUndefined();
    expect(calls.receipts).toEqual([]);
  });

  it('EXPIRED: a RefundFailed log reports refundFailed=true and no amount', async () => {
    const { deps } = scriptedDeps([node('expired')]);
    const failed = JSON.parse(JSON.stringify(expiredBlockResults.result.finalize_block_events)) as { type: string; attributes: { key: string; value: string }[] }[];
    for (const ev of failed) {
      if (ev.type !== 'tx_log') continue;
      for (const a of ev.attributes) {
        if (a.key !== 'txLog') continue;
        const log = JSON.parse(a.value) as { topics: string[] };
        if (log.topics[0] === '0xfbeaa807aad4fcff31eff41f17142e6dcd1babf57c4730e3a4c706ac608cc057') {
          // RefundSent → RefundFailed: same indexed layout (requestId, recipient) + amount
          log.topics[0] = REFUND_FAILED_TOPIC0;
          a.value = JSON.stringify({ ...JSON.parse(a.value), topics: log.topics });
        }
      }
    }
    deps.pushClient.getBlockResultEvents = async () => failed as never;
    const r = await trackRead(deps, { requestId: '0x4a6e27e003a8801f7f5dffff3beb8af6836b9e68a99c94bbb22dc95b180857a9' });
    expect(r.fees.refundFailed).toBe(true);
    expect(r.fees.refunded).toBeUndefined();
  });

  it('SVM and web2 records infer their result shape from the envelope', async () => {
    // Their fulfil receipts are not fixtures → callbackDelivered unknown → value withheld,
    // so the shape inference is checked directly on the stored envelope.
    const svm = await trackRead(scriptedDeps([node('svm')]).deps, { requestId: node('svm').id as Hex });
    expect(svm.chain).toBe('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
    expect(svm.request.spec.account.owner.length).toBe(66); // 32 bytes
    expect(inferResultShape('solana', svm.request.spec.query)).toEqual({ kind: 'uint256' });
    const web2 = await trackRead(scriptedDeps([node('web2')]).deps, { requestId: node('web2').id as Hex });
    expect(web2.chain).toBeUndefined();
    expect(web2.destination.caip2).toBe('web2:https');
    expect(inferResultShape('web2', web2.request.spec.query)).toEqual({
      kind: 'web2',
      extract: [
        { path: '$.id', valueType: 'uint256', decimals: 0 },
        { path: '$.completed', valueType: 'bool', decimals: 0 },
      ],
    });
  });

  it('resultShape option overrides inference (a contract call carries no ABI on chain)', async () => {
    const { deps } = scriptedDeps([node('success-evm')]);
    const r = await trackRead(deps, { requestId: READ2_ID }, { resultShape: { kind: 'raw' } });
    expect(r.value).toBe('0x000000000000000000000000000000000000000000000092b406e140cc2c8871');
    const bad = await trackRead(deps, { requestId: READ2_ID }, { resultShape: { kind: 'web2', extract: [{ path: '$', valueType: 'string' }] } });
    expect(bad.value).toBeUndefined();
    expect(bad.decodeError).toMatch(/./);
  });

  it('by txHash resolves to an array; requestId accepts bigint', async () => {
    const { deps, calls } = scriptedDeps([node('success-evm')]);
    const arr = await trackRead(deps, { txHash: READ2_TX });
    expect(arr).toHaveLength(1);
    expect(arr[0].requestId).toBe(READ2_ID);
    expect(calls.getReadsByTx).toBe(1);
    const one = await trackRead(deps, { requestId: BigInt(READ2_ID) });
    expect(one.requestId).toBe(READ2_ID);
  });

  it('toRequestIdHex normalises', () => {
    expect(toRequestIdHex(1n)).toBe('0x' + '0'.repeat(63) + '1');
    expect(toRequestIdHex(READ2_ID.toUpperCase().replace('0X', '0x') as Hex)).toBe(READ2_ID);
  });
});

describe('trackRead — lookup retry', () => {
  it('retries a not-yet-ingested record, then throws ReadNotFoundError', async () => {
    const { deps, calls } = scriptedDeps([undefined]);
    const p = trackRead(deps, { requestId: READ2_ID }, { pollingIntervalMs: 1000 });
    const rejection = expect(p).rejects.toBeInstanceOf(ReadNotFoundError);
    await jest.advanceTimersByTimeAsync(31_000);
    await rejection;
    expect(calls.getUniversalRead).toBeGreaterThan(20);
  });

  it('finds a record that appears on the second poll', async () => {
    const { deps } = scriptedDeps([undefined, node('success-evm')]);
    const p = trackRead(deps, { txHash: READ2_TX }, { pollingIntervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000);
    expect((await p)[0].status).toBe(UNIVERSAL_READ_STATUS.FULFILLED);
  });
});

describe('wait()', () => {
  const success = node('success-evm');
  const pending = withStatus(success, UniversalReadStatus.UNIVERSAL_READ_STATUS_PENDING);
  const voting = withStatus(success, UniversalReadStatus.UNIVERSAL_READ_STATUS_VOTING);

  it('a missing snapshot respects the shared timeout and retains the last status', async () => {
    const { deps } = scriptedDeps([pending, undefined]);
    const first = await trackRead(deps, { requestId: READ2_ID });
    const rejection = first.wait({ timeoutMs: 1000, pollingIntervalMs: 500 }).catch((e) => e);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await rejection).toMatchObject({ lastStatus: UNIVERSAL_READ_STATUS.PENDING });
    expect((await rejection).message).toContain('1000 ms');
    expect(await rejection).toBeInstanceOf(ReadTimeoutError);
  });

  it('a stalled RPC cannot exceed the wait deadline', async () => {
    const { deps } = scriptedDeps([pending]);
    const first = await trackRead(deps, { requestId: READ2_ID });
    deps.pushClient.getUniversalRead = () => new Promise(() => undefined);
    const rejection = first.wait({ timeoutMs: 1000, pollingIntervalMs: 500 }).catch((e) => e);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await rejection).toBeInstanceOf(ReadTimeoutError);
  });

  it('recovers from a missing snapshot without resetting the deadline', async () => {
    const { deps } = scriptedDeps([pending, undefined, success]);
    const first = await trackRead(deps, { requestId: READ2_ID });
    const done = first.wait({ timeoutMs: 2000, pollingIntervalMs: 500 });
    await jest.advanceTimersByTimeAsync(1000);
    expect((await done).value).toBe(2706196938206701455473n);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('PENDING → VOTING → FULFILLED resolves with the terminal snapshot and hooks in order', async () => {
    const emitted: string[] = [];
    const { deps } = scriptedDeps([pending, voting, success], { emit: (id) => emitted.push(id) });
    const first = await trackRead(deps, { requestId: READ2_ID });
    expect(first.isTerminal).toBe(false);
    expect(first.raw).toBeNull();
    const p = first.wait({ pollingIntervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(2000);
    const done = await p;
    expect(done.status).toBe(UNIVERSAL_READ_STATUS.FULFILLED);
    expect(done.value).toBe(2706196938206701455473n);
    expect(emitted).toEqual([
      PROGRESS_HOOK.READ_TX_104_02,
      PROGRESS_HOOK.READ_TX_105_01,
      PROGRESS_HOOK.READ_TX_105_02,
      PROGRESS_HOOK.READ_TX_106_01,
      PROGRESS_HOOK.READ_TX_106_02,
      PROGRESS_HOOK.READ_TX_106_04,
      PROGRESS_HOOK.READ_TX_106_05,
      PROGRESS_HOOK.READ_TX_199_01,
    ]);
  });

  it('wait({ resultShape }) re-decodes even an already-terminal record (the ABI is not on chain)', async () => {
    const { deps } = scriptedDeps([success]);
    const r = await trackRead(deps, { requestId: READ2_ID });
    expect(r.decoded?.kind).toBe('uint256');
    const raw = await r.wait({ resultShape: { kind: 'raw' } });
    expect(raw.decoded).toEqual({ kind: 'raw', value: '0x000000000000000000000000000000000000000000000092b406e140cc2c8871' });
    const { deps: polled } = scriptedDeps([pending, success]);
    const p = (await trackRead(polled, { requestId: READ2_ID })).wait({ pollingIntervalMs: 1000, resultShape: { kind: 'bytes32' } });
    await jest.advanceTimersByTimeAsync(1000);
    expect((await p).decoded?.kind).toBe('bytes32');
  });

  it('already terminal: resolves at once without polling', async () => {
    const { deps, calls } = scriptedDeps([success]);
    const r = await trackRead(deps, { requestId: READ2_ID });
    const before = calls.getUniversalRead;
    await expect(r.wait()).resolves.toBe(r);
    expect(calls.getUniversalRead).toBe(before);
  });

  it('reverted callback emits 106-03 instead of 106-02', async () => {
    const emitted: string[] = [];
    const { deps } = scriptedDeps([node('callback-reverted')], { emit: (id) => emitted.push(id) });
    await (await trackRead(deps, { requestId: node('callback-reverted').id as Hex })).wait();
    expect(emitted).toContain(PROGRESS_HOOK.READ_TX_106_03);
    expect(emitted).not.toContain(PROGRESS_HOOK.READ_TX_106_02);
    expect(emitted[emitted.length - 1]).toBe(PROGRESS_HOOK.READ_TX_199_01);
  });

  it.each([
    ['EXPIRED', node('expired'), UNIVERSAL_READ_STATUS.EXPIRED],
    ['FAILED', withStatus(success, UniversalReadStatus.UNIVERSAL_READ_STATUS_FAILED), UNIVERSAL_READ_STATUS.FAILED],
    ['ABORTED', withStatus(success, UniversalReadStatus.UNIVERSAL_READ_STATUS_ABORTED), UNIVERSAL_READ_STATUS.ABORTED],
  ])('%s is a status, not a throw — 199-02 emitted', async (_n, record, expected) => {
    const events: unknown[][] = [];
    const { deps } = scriptedDeps([pending, record], { emit: (id, ...args) => events.push([id, ...args]) });
    const p = (await trackRead(deps, { requestId: READ2_ID })).wait({ pollingIntervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.status).toBe(expected);
    expect(r.isTerminal).toBe(true);
    const last = events[events.length - 1];
    expect(last[0]).toBe(PROGRESS_HOOK.READ_TX_199_02);
    expect(last[2]).toBe(_n);
  });

  it('timeout throws ReadTimeoutError with the last status and emits 199-03', async () => {
    const events: unknown[][] = [];
    const { deps } = scriptedDeps([pending, voting], { emit: (id, ...args) => events.push([id, ...args]) });
    const p = (await trackRead(deps, { requestId: READ2_ID })).wait({ pollingIntervalMs: 1000, timeoutMs: 3500 });
    const rejection = p.catch((e) => e);
    await jest.advanceTimersByTimeAsync(4000);
    const err = await rejection;
    expect(err).toBeInstanceOf(ReadTimeoutError);
    expect((err as ReadTimeoutError).lastStatus).toBe(UNIVERSAL_READ_STATUS.VOTING);
    expect((err as ReadTimeoutError).requestId).toBe(READ2_ID);
    expect(events[events.length - 1][0]).toBe(PROGRESS_HOOK.READ_TX_199_03);
    expect(events[events.length - 1][2]).toBe('VOTING');
  });

  it('default timeout is the request lifetime in wall-clock, capped', () => {
    expect(defaultWaitTimeoutMs(100n, 110n)).toBe(10 * 1340);
    expect(defaultWaitTimeoutMs(22957752n, 22958748n)).toBe(READ_TRACK_MAX_TIMEOUT_MS);
    expect(defaultWaitTimeoutMs(10n, 10n)).toBeGreaterThan(0);
  });

  it('polling interval floors at 500 ms', async () => {
    const { deps, calls } = scriptedDeps([pending, pending, pending, success]);
    const p = (await trackRead(deps, { requestId: READ2_ID })).wait({ pollingIntervalMs: 1 });
    await jest.advanceTimersByTimeAsync(499);
    expect(calls.getUniversalRead).toBe(1);
    await jest.advanceTimersByTimeAsync(READ_TRACK_POLL_INTERVAL_MS);
    await p;
    expect(calls.getUniversalRead).toBe(4);
  });

  it('refresh() re-reads by requestId and returns a new snapshot', async () => {
    const { deps } = scriptedDeps([pending, success]);
    const first = await trackRead(deps, { txHash: READ2_TX });
    const again = await first[0].refresh();
    expect(again.status).toBe(UNIVERSAL_READ_STATUS.FULFILLED);
    expect(first[0].status).toBe(UNIVERSAL_READ_STATUS.PENDING); // snapshots are immutable
  });
});

describe('through the orchestrator: READ-TX hooks are not R1-suppressed', () => {
  it('a non-R1 currentRoute still receives every READ-TX event', async () => {
    const events: ProgressEvent[] = [];
    const script = [withStatus(node('success-evm'), UniversalReadStatus.UNIVERSAL_READ_STATUS_PENDING), node('success-evm')];
    let i = 0;
    const ctx = {
      pushClient: {
        getUniversalRead: async () => ({ read: script[Math.min(i++, 1)] }),
        getReadsByTx: async () => ({ reads: [] }),
        getTransactionReceiptWithArchiveFallback: async (h: Hex) => RECEIPTS[h.toLowerCase()],
      },
      pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
      currentRoute: TransactionRoute.UOA_TO_CEA,
      printTraces: false,
      progressHook: (e: ProgressEvent) => events.push(e),
    } as unknown as OrchestratorContext;
    const p = (await trackReadViaCtx(ctx, { requestId: READ2_ID })).wait({ pollingIntervalMs: 1000 });
    await jest.advanceTimersByTimeAsync(1000);
    await p;
    const ids = events.map((e) => e.id);
    expect(ids[0]).toBe('READ-TX-104-02');
    expect(ids).toContain('READ-TX-105-01');
    expect(ids[ids.length - 1]).toBe('READ-TX-199-01');
    // payloads are structured, bigints stringified
    const fulfilled = events[events.length - 1];
    expect(fulfilled.level).toBe('SUCCESS');
    expect(fulfilled.response).toMatchObject({ requestId: READ2_ID, value: '2706196938206701455473', callbackDelivered: true });
    expect(typeof fulfilled.timestamp).toBe('string');
  });
});
