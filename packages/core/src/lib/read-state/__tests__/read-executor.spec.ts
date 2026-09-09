import { decodeFunctionData, parseAbi } from 'viem';
import { CHAIN } from '../../constants/enums';
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
  (r.wait as jest.Mock).mockResolvedValue({ ...r, status: 3, callbackDelivered: true });
  return r;
}

function setup(records: UniversalReadResponse[]) {
  const execute = jest.fn().mockResolvedValue({ hash, wait: jest.fn().mockResolvedValue({ status: 1 }) });
  const trackRead = jest.fn().mockImplementation(async (ref) => 'txHash' in ref
    ? records
    : records.find((r) => r.requestId === ref.requestId));
  return { execute, trackRead, deps: { execute, trackRead } as unknown as ReadExecutorDeps };
}

describe('executeReads app-contract path', () => {
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
    expect(result.map((r) => r.requestId)).toEqual([ra.requestId, rb.requestId]);
    const calls = execute.mock.calls[0][0].data;
    expect(calls.map((c: { value: bigint }) => c.value)).toEqual([a.value, b.value]);
    expect(decodeFunctionData({ abi, data: calls[0].data }).functionName).toBe('request');
    expect(execute.mock.calls[0][1].enforceGasCheck).toBe(true);
    expect(trackRead).toHaveBeenCalledWith({ requestId: ra.requestId }, expect.objectContaining({ resultShape: a.encodedQuery.resultShape }));
    expect(ra.wait).toHaveBeenCalledTimes(1);
  });

  it('waitForCompletion=false returns resumable snapshots without polling', async () => {
    const p = prepared(), r = response(p, 1);
    const { deps, execute } = setup([r]);
    expect(await executeReads(deps, [p], { waitForCompletion: false })).toEqual([r]);
    expect(execute.mock.calls[0][0].to).toBe(target);
    expect(typeof execute.mock.calls[0][0].data).toBe('string');
    expect(r.wait).not.toHaveBeenCalled();
  });

  it('collects every hash after sequential wallet fallback', async () => {
    const a = prepared(1n), b = prepared(2n), ra = response(a, 1), rb = response(b, 2);
    const { deps, execute, trackRead } = setup([ra, rb]);
    execute.mockResolvedValue({ hash: secondHash, transactionHashes: [hash, secondHash], wait: async () => ({ status: 1 }) });
    trackRead.mockImplementation(async (ref) => 'txHash' in ref ? (ref.txHash === hash ? [ra] : [rb]) : [ra, rb].find((r) => r.requestId === ref.requestId));
    expect((await executeReads(deps, [a, b])).map((r) => r.requestId)).toEqual([ra.requestId, rb.requestId]);
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
    expect((await executeReads(setup([r]).deps, [p]))[0].callbackDelivered).toBe(false);
    (r.wait as jest.Mock).mockRejectedValueOnce(new ReadTimeoutError(1, 1000));
    await expect(executeReads(setup([r]).deps, [p])).rejects.toBeInstanceOf(ReadTimeoutError);
  });
});
