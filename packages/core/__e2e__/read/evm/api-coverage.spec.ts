import '@e2e/shared/setup';
import { erc20Abi, parseAbi } from 'viem';
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { CALLBACK_GAS, FULL_BUDGET_CLIENT, READ_CLIENT_ABI, makePushEoaClient, pushKey, SLOW_PATH, retryTruth, sepoliaTruth } from '../_shared';

const d = pushKey ? describe : describe.skip;
const subject = '0x000000000000000000000000000000000000dEaD';
const token = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const callback = { target: FULL_BUDGET_CLIENT, gasLimit: CALLBACK_GAS, request: { abi: READ_CLIENT_ABI, functionName: 'request' } };
const base = { chain: CHAIN.ETHEREUM_SEPOLIA, callback, expiryBlocks: SLOW_PATH.expiryBlocks } as const;
const READ = PushChain.CONSTANTS.READ;

d('read state › public API coverage', () => {
  it('ERC20 shorthand survives refresh and deduplicates the shared progress hook', async () => {
    const events: string[] = [];
    const hook = (event: { id: string }) => { events.push(event.id); };
    const { client } = await makePushEoaClient(pushKey!, hook);
    const snapshot = await client.universal.read(subject, { ...base, token, waitForCompletion: false, progressHook: hook });
    const refreshed = await snapshot.refresh();
    expect(refreshed.requestId).toBe(snapshot.requestId);
    const done = await refreshed.wait(SLOW_PATH.wait);
    const balance = await retryTruth(() => sepoliaTruth().readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [subject], blockNumber: done.request.spec.blockNumber }));
    expect(done.value).toEqual([balance]);
    expect(done.callbackDelivered).toBe(true);
    expect(events.filter((id) => id === 'READ-TX-199-01')).toHaveLength(1);
  }, SLOW_PATH.jestTimeoutMs);

  it('mixed consensus outcomes and duplicate inputs retain identity and order', async () => {
    const { client } = await makePushEoaClient(pushKey!);
    const balance = await client.universal.prepareRead(subject, base);
    const reverted = await client.universal.prepareRead(token, {
      ...base,
      abi: parseAbi(['function missingReadStateTestFunction() view returns (uint256)']),
      functionName: 'missingReadStateTestFunction',
    });
    const missingWeb2 = await client.universal.prepareRead('https://jsonplaceholder.typicode.com/todos/1', {
      callback, expiryBlocks: SLOW_PATH.expiryBlocks, chain: READ.WEB2,
      web2: { extract: [{ path: '$.missingReadStateTestField', valueType: 'uint256' }] },
    });
    const results = await client.universal.executeReads([balance, reverted, missingWeb2, balance], {
      advanced: { timeout: SLOW_PATH.wait.timeoutMs, pollingIntervalMs: SLOW_PATH.wait.pollingIntervalMs },
    });
    expect(new Set(results.map((r) => r.requestId)).size).toBe(4);
    const truth = await retryTruth(() => sepoliaTruth().getBalance({ address: subject, blockNumber: balance.spec.blockNumber }));
    expect(results.map((r) => r.value)).toEqual([truth, undefined, undefined, truth]);
    expect(results[1].raw).toMatchObject({ status: READ.RESULT_STATUS.ERROR, errorCode: READ.ERROR_CODE.REVERTED });
    expect(results[2].raw).toMatchObject({ status: READ.RESULT_STATUS.ERROR, errorCode: READ.ERROR_CODE.NOT_FOUND });
    for (const r of results) {
      expect(r.status).toBe(READ.STATUS.FULFILLED);
      expect(r.callbackDelivered).toBe(true); // error result delivery is separate from read success
      expect(r.fees.refundFailed).toBe(false);
      expect(r.fees.burned! + r.fees.refunded!).toBe(r.fees.callbackBudget);
    }
  }, SLOW_PATH.jestTimeoutMs);
});
