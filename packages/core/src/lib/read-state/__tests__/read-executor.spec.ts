import { decodeFunctionData, parseAbi } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { executeStandardPayload } from '../../orchestrator/internals/execute-standard';
import type { OrchestratorContext } from '../../orchestrator/internals/context';
import type { ExecuteParams } from '../../orchestrator/orchestrator.types';
import { assertRequestEntrypoint, executeReads, type ReadExecutorDeps } from '../read-executor';
import { buildReadSpecFromPreflight } from '../spec-builder';
import { resolveDestination } from '../destination';
import { ReadTimeoutError } from '../errors';
import type { PreparedRead, UniversalReadResponse } from '../read-state.types';

const target = '0x1111111111111111111111111111111111111111';
const hash = `0x${'aa'.repeat(32)}` as const;
const secondHash = `0x${'bb'.repeat(32)}` as const;
const abi = parseAbi(['function request(((string chainNamespace,string chainId,bytes owner) account,bytes query,uint16 minConfirmations,uint64 blockNumber,uint64 expiryPushChainHeight,uint256 maxFee,address revertRecipient) spec,uint64 gasLimit) payable returns (uint256)']);

function prepared(slot = 0n) {
  return buildReadSpecFromPreflight({
    destination: resolveDestination({ chain: CHAIN.ETHEREUM_SEPOLIA }),
    protocolFee: 0n, observedChainHeight: 100n, pushBlockNumber: 100n,
    pushGasPrice: 1_000_000_000n, universalCallback: target, universalCore: target, fetchedAt: Date.now(),
  }, {
    destination: { chain: CHAIN.ETHEREUM_SEPOLIA },
    query: { type: 'storageSlot', target, slot }, refundTo: target,
    callbackGasLimit: 200_000n,
    callback: { target, request: { abi, functionName: 'request' } },
  });
}

function response(p: PreparedRead, index: number): UniversalReadResponse {
  const r = {
    requestId: `0x${index.toString(16).padStart(64, '0')}`, txHash: hash, status: 1,
    request: { spec: p.spec, callbackTarget: target, callbackGasLimit: p.callbackGasLimit, logIndex: index },
    wait: jest.fn(),
  } as unknown as UniversalReadResponse;
  (r.wait as jest.Mock).mockResolvedValue({ ...r, status: 3, isTerminal: true, callbackDelivered: true, raw: { status: 1 } });
  return r;
}

function setup(records: UniversalReadResponse[]) {
  const execute = jest.fn().mockResolvedValue({ hash, wait: jest.fn().mockResolvedValue({ status: 1 }) });
  const trackRead = jest.fn().mockImplementation(async (ref) => 'txHash' in ref
    ? records
    : records.find((r) => r.requestId === ref.requestId));
  return { execute, trackRead, deps: { execute, trackRead, revalidateRead: jest.fn().mockResolvedValue(undefined) } as unknown as ReadExecutorDeps };
}

describe('executeReads app-contract path', () => {
  it('empty batches perform no execution or tracking', async () => {
    const { deps, execute, trackRead } = setup([]);
    await expect(executeReads(deps, [])).rejects.toThrow(/at least one prepared read/);
    expect(execute).not.toHaveBeenCalled();
    expect(trackRead).not.toHaveBeenCalled();
  });

  it('maps identical prepared reads to distinct requests in log order', async () => {
    const p = prepared(), a = response(p, 1), b = response(p, 2);
    const { deps } = setup([b, a]);
    const result = await executeReads(deps, [p, p]);
    expect(result.reads.map((r) => r.requestId)).toEqual([a.requestId, b.requestId]);
    expect(result).toMatchObject({ txHash: hash, count: 2, atomic: true });
  });

  it.each(['callbackTarget', 'callbackGasLimit'])('rejects a matching spec with a different %s', async (field) => {
    const p = prepared(), r = response(p, 1);
    if (field === 'callbackTarget') r.request.callbackTarget = '0x2222222222222222222222222222222222222222';
    else r.request.callbackGasLimit++;
    await expect(executeReads(setup([r]).deps, [p])).rejects.toMatchObject({ code: 'READ_REQUEST_MISMATCH', txHash: hash });
  });
  describe('partial batches through the real native execution layers', () => {
    let warning: jest.SpyInstance;
    beforeEach(() => { warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => warning.mockRestore());

    it.each(['send', 'decline', 'nonce-refresh', 'receipt', 'first-receipt', 'revert', 'index', 'response'])('retains recovery metadata after %s failure', async (stage) => {
      let sends = 0;
      let nonceReads = 0;
      const ctx = {
        universalSigner: { account: { chain: CHAIN.PUSH_TESTNET_DONUT, address: target } },
        pushNetwork: PUSH_NETWORK.TESTNET_DONUT, printTraces: false,
        pushClient: {
          pushChainInfo: { chainId: '42101' },
          sendTransaction: async () => {
            sends++;
            if (sends === 2 && stage === 'send') throw new Error('second send failed');
            if (sends === 2 && stage === 'decline') throw new Error('User rejected request');
            if (sends === 2 && stage === 'nonce-refresh') throw new Error('invalid nonce');
            return sends === 1 ? hash : secondHash;
          },
          getTransaction: async () => { throw new Error('index unavailable'); },
          publicClient: {
            getTransactionCount: async () => {
              if (++nonceReads > 1 && stage === 'nonce-refresh') throw new Error('nonce lookup failed');
              return 0;
            },
            waitForTransactionReceipt: async ({ hash: txHash }: { hash: string }) => {
              if (stage === 'first-receipt' || (stage === 'receipt' && txHash === secondHash)) throw new Error('receipt unavailable');
              return { status: stage === 'revert' && txHash === secondHash ? 'reverted' : 'success', blockNumber: 1n };
            },
            call: async () => { throw new Error('execution reverted'); },
          },
        },
      } as unknown as OrchestratorContext;
      if (stage === 'response') ctx.pushClient.getTransaction = jest.fn().mockResolvedValue({ hash: secondHash });
      const deps = {
        execute: (params: ExecuteParams) => executeStandardPayload(ctx, params, [], () => { throw new Error('response construction failed'); }),
        trackRead: jest.fn(),
        revalidateRead: jest.fn().mockResolvedValue(undefined),
      } as unknown as ReadExecutorDeps;
      const error = await executeReads(deps, [prepared(1n), prepared(2n)]).catch((e) => e);
      expect(error.code).toBe('READ_REQUEST_TX_FAILED');
      expect(error.transactionHashes).toEqual(stage === 'first-receipt' ? [] : ['index', 'response'].includes(stage) ? [hash, secondHash] : [hash]);
      expect(error.pendingTransactionHash).toBe(stage === 'first-receipt' ? hash : stage === 'receipt' ? secondHash : undefined);
      expect(deps.trackRead).not.toHaveBeenCalled();
    });
  });
  it('supports explicit request argument mapping', async () => {
    const p = prepared();
    const reversedAbi = [{ ...abi[0], inputs: [abi[0].inputs[1], abi[0].inputs[0]] }] as const;
    p.callback = { target, request: { abi: reversedAbi, functionName: 'request', args: (spec, gas) => [gas, spec] } };
    const { deps, execute } = setup([response(p, 1)]);
    await executeReads(deps, [p]);
    const decoded = decodeFunctionData({ abi: reversedAbi, data: execute.mock.calls[0][0].data });
    expect(decoded.args?.[0]).toBe(p.callbackGasLimit);
  });
  it('encodes the app entrypoint, forwards escrow and preserves each decode shape and input order', async () => {
    const a = prepared(1n), b = prepared(2n);
    const ra = response(a, 1), rb = response(b, 2);
    const { deps, execute, trackRead } = setup([rb, ra]); // node order is request-ID order
    const result = await executeReads(deps, [a, b], { advanced: { enforceGasCheck: true } });
    expect(result.reads.map((r) => r.requestId)).toEqual([ra.requestId, rb.requestId]);
    const calls = execute.mock.calls[0][0].data;
    expect(calls.map((c: { value: bigint }) => c.value)).toEqual([a.value, b.value]);
    expect(decodeFunctionData({ abi, data: calls[0].data }).functionName).toBe('request');
    expect(execute.mock.calls[0][1].enforceGasCheck).toBe(true);
    expect(trackRead).toHaveBeenCalledWith({ requestId: ra.requestId }, expect.objectContaining({ resultShape: a.resultShape }));
    expect(ra.wait).toHaveBeenCalledTimes(1);
  });

  it('waitForCompletion=false returns resumable snapshots without polling', async () => {
    const p = prepared(), r = response(p, 1);
    const { deps, execute } = setup([r]);
    const batch = await executeReads(deps, [p], { waitForCompletion: false });
    expect(batch.reads).toEqual([r]);
    expect(batch).toMatchObject({ txHash: hash, count: 1, atomic: true });
    expect(execute.mock.calls[0][0].to).toBe(target);
    expect(typeof execute.mock.calls[0][0].data).toBe('string');
    expect(r.wait).not.toHaveBeenCalled();
    expect(await batch.wait()).toEqual([expect.objectContaining({ requestId: r.requestId, isTerminal: true })]);
    expect(r.wait).toHaveBeenCalledTimes(1);
  });

  it('collects every hash after sequential wallet fallback', async () => {
    const a = prepared(1n), b = prepared(2n), ra = response(a, 1), rb = response(b, 2);
    const { deps, execute, trackRead } = setup([ra, rb]);
    execute.mockResolvedValue({ hash: secondHash, atomic: false, transactionHashes: [hash, secondHash], wait: async () => ({ status: 1 }) });
    trackRead.mockImplementation(async (ref) => 'txHash' in ref ? (ref.txHash === hash ? [ra] : [rb]) : [ra, rb].find((r) => r.requestId === ref.requestId));
    const batch = await executeReads(deps, [a, b]);
    expect(batch.reads.map((r) => r.requestId)).toEqual([ra.requestId, rb.requestId]);
    expect(batch).toMatchObject({ txHash: secondHash, atomic: false, transactionHashes: [hash, secondHash] });
    expect(trackRead).toHaveBeenCalledWith({ txHash: hash }, expect.anything());
    expect(trackRead).toHaveBeenCalledWith({ txHash: secondHash }, expect.anything());
  });

  it('validates the entire batch before broadcasting', async () => {
    const { deps, execute } = setup([]);
    await expect(executeReads(deps, [prepared(), { ...prepared(), callback: { target } }])).rejects.toThrow(/callback.request/);
    expect(execute).not.toHaveBeenCalled();
    await expect(executeReads(deps, [{ ...prepared(), callback: undefined }])).rejects.toMatchObject({ code: 'READ_REGISTRY_UNAVAILABLE' });
  });

  it('rejects missing or extra request logs with the transaction hash for recovery', async () => {
    const p = prepared(), r = response(p, 1);
    const { deps } = setup([r, response(p, 2)]);
    await expect(executeReads(deps, [p])).rejects.toMatchObject({ code: 'READ_REQUEST_MISMATCH', txHash: hash });
    await expect(executeReads(setup([response(prepared(9n), 1)]).deps, [p])).rejects.toMatchObject({ code: 'READ_REQUEST_MISMATCH' });
  });

  it('a non-atomic batch that fails midway surfaces the hashes already mined', async () => {
    const { deps, execute, trackRead } = setup([]);
    const partial = Object.assign(new Error('sendPushTx — multicall operation 2/2 reverted'), { transactionHashes: [hash] });
    execute.mockRejectedValue(partial);
    const err = await executeReads(deps, [prepared(1n), prepared(2n)]).catch((e) => e);
    expect(err).toMatchObject({ code: 'READ_REQUEST_TX_FAILED', txHash: hash });
    expect(err.message).toContain('1 of 2');
    expect(err.message).toContain(hash);
    expect(trackRead).not.toHaveBeenCalled();
    // nothing mined → the original error passes through untouched
    execute.mockRejectedValue(new Error('insufficient funds'));
    await expect(executeReads(deps, [prepared()])).rejects.toThrow('insufficient funds');
  });

  it('assertRequestEntrypoint rejects a malformed entrypoint without any network', () => {
    expect(() => assertRequestEntrypoint(undefined, 'read')).toThrow(/read needs the UniversalReadRegistry/);
    expect(() => assertRequestEntrypoint({ target: '0x0000000000000000000000000000000000000000' })).toThrow(/non-zero/);
    expect(() => assertRequestEntrypoint({ target })).toThrow(/callback.request/);
    expect(() => assertRequestEntrypoint({ target, request: { abi, functionName: '' } })).toThrow(/abi and functionName/);
    expect(assertRequestEntrypoint({ target, request: { abi, functionName: 'request' } }).target).toBe(target);
  });

  it('does not track a reverted request transaction', async () => {
    const { deps, execute, trackRead } = setup([]);
    execute.mockResolvedValue({ hash, wait: async () => ({ status: 0 }) });
    await expect(executeReads(deps, [prepared()])).rejects.toMatchObject({ code: 'READ_REQUEST_TX_FAILED' });
    expect(trackRead).not.toHaveBeenCalled();
  });

  it('preserves callback failure responses and propagates read timeouts', async () => {
    const p = prepared(), r = response(p, 1);
    (r.wait as jest.Mock).mockResolvedValueOnce({ ...r, status: 3, callbackDelivered: false });
    expect((await executeReads(setup([r]).deps, [p])).reads[0].callbackDelivered).toBe(false);
    (r.wait as jest.Mock).mockRejectedValueOnce(new ReadTimeoutError(1, 1000));
    await expect(executeReads(setup([r]).deps, [p])).rejects.toBeInstanceOf(ReadTimeoutError);
  });
});

describe('execution validation and observable progress', () => {
  it('emits the OG balance event and enforces the read-value check when requested', async () => {
    const p = prepared();
    const { deps, execute } = setup([response(p, 1)]);
    const hook = jest.fn();
    deps.getReadBalance = jest.fn().mockResolvedValue(p.value - 1n);
    await expect(executeReads(deps, [p], { progressHook: hook, advanced: { enforceGasCheck: true } }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_READ_BALANCE' });
    expect(hook.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'READ-TX-103-01', response: expect.objectContaining({ enforceGasCheck: true, sufficient: false }) }),
      expect.objectContaining({ id: 'READ-TX-103-02' }),
    ]));
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not broadcast any read when a later prepared request is invalid', async () => {
    const a = prepared(), b = prepared(1n);
    const { deps, execute } = setup([]);
    (deps.revalidateRead as jest.Mock).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('expired'));
    await expect(executeReads(deps, [a, b])).rejects.toThrow('expired');
    expect(execute).not.toHaveBeenCalled();
  });

  it('deduplicates shared hooks and emits batch success only after completion', async () => {
    const a = prepared(), b = prepared(1n);
    const { deps } = setup([response(a, 1), response(b, 2)]);
    const hook = jest.fn();
    deps.getProgressHook = () => hook;
    await executeReads(deps, [a, b], { progressHook: hook });
    const ids = hook.mock.calls.map(([event]) => event.id);
    expect(ids.filter(id => id === 'READ-TX-001')).toHaveLength(1);
    expect(ids.filter(id => id === 'READ-TX-002-99-99')).toHaveLength(2);
    expect(ids.at(-1)).toBe('READ-TX-999-01');
  });

  it('emits confirmed events but no completion for no-wait requests', async () => {
    const a = prepared(), b = prepared(1n);
    const { deps } = setup([response(a, 1), response(b, 2)]);
    const hook = jest.fn();
    const batch = await executeReads(deps, [a, b], { progressHook: hook, waitForCompletion: false });
    let ids = hook.mock.calls.map(([event]) => event.id);
    expect(ids.filter(id => id === 'READ-TX-104-02')).toHaveLength(2);
    expect(ids).not.toContain('READ-TX-999-01');
    expect(ids).not.toContain('READ-TX-002-99-99');
    await batch.wait();
    ids = hook.mock.calls.map(([event]) => event.id);
    expect(ids.filter(id => id === 'READ-TX-002-99-99')).toHaveLength(2);
    expect(ids.at(-1)).toBe('READ-TX-999-01');
  });

  it('reports callback failure as batch failure while resolving terminal results', async () => {
    const a = prepared(), b = prepared(1n), ra = response(a, 1), rb = response(b, 2);
    (rb.wait as jest.Mock).mockResolvedValue({ ...rb, status: 3, callbackDelivered: false });
    const hook = jest.fn();
    await executeReads(setup([ra, rb]).deps, [a, b], { progressHook: hook });
    expect(hook.mock.calls.at(-1)?.[0]).toMatchObject({ id: 'READ-TX-999-02', response: { failedAt: 2 } });
  });
});
