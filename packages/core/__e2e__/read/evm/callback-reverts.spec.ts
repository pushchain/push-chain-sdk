import '@e2e/shared/setup';
/**
 * E2E · read state · invariant I4: FULFILLED does not mean delivered.
 *
 * RevertingReadClient's onUniversalData always reverts. Validators still reach
 * SUCCESS, the fulfil tx emits CallbackFailed (not ReadFulfilled), the node marks
 * the read FULFILLED, the contract settles — and the SDK must say
 * callbackDelivered=false with no value.
 */
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { CALLBACK_GAS, REVERTING_CLIENT, createProgressTracker, makePushEoaClient, pushKey, sendRead, SLOW_PATH } from '../_shared';

const READ = PushChain.CONSTANTS.READ;

const d = pushKey ? describe : describe.skip;

d('read state › reverting callback', () => {
  const tracker = createProgressTracker();

  it('reports FULFILLED + callbackDelivered=false, value withheld, budget still settled', async () => {
    const { client } = await makePushEoaClient(pushKey!);
    const prepared = await client.universal.prepareRead('0x000000000000000000000000000000000000dEaD', {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      callback: { target: REVERTING_CLIENT, gasLimit: CALLBACK_GAS },
      expiryBlocks: SLOW_PATH.expiryBlocks,
    });
    const { read } = await sendRead(client, prepared, REVERTING_CLIENT);

    const done = await client.universal.trackRead({ requestId: read.requestId }, { progressHook: tracker.hook }).then((r) => r.wait(SLOW_PATH.wait));
    expect(done.status).toBe(READ.STATUS.FULFILLED);
    expect(done.raw?.status).toBe(READ.RESULT_STATUS.SUCCESS); // consensus succeeded
    expect(done.callbackDelivered).toBe(false); // the app never got it
    expect(done.callbackFailReason).toBeDefined();
    expect(done.value).toBeUndefined();
    expect(done.fees.burned).toBeGreaterThan(0n);
    expect(done.fees.burned! + done.fees.refunded!).toBe(done.fees.callbackBudget);

    const ids = tracker.getIds();
    expect(ids).toContain('READ-TX-106-03');
    expect(ids).not.toContain('READ-TX-106-02');
    expect(ids[ids.length - 1]).toBe('READ-TX-199-01');
  }, SLOW_PATH.jestTimeoutMs);
});
