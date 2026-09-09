import '@e2e/shared/setup';
/**
 * E2E · read state · EVM native balance, requested by a Push-native EOA.
 *
 * prepareRead → simulateRead → sendTransaction(to: FullBudgetReadClient) →
 * trackRead({ txHash }) → wait() → value === Sepolia balance at the pinned block.
 * Costs: the callback budget (refunded minus burn) + Push gas. ~0.01 PC.
 */
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { CALLBACK_GAS, CALLBACK_SELECTOR, FULL_BUDGET_CLIENT, createProgressTracker, makePushEoaClient, pushKey, sendRead, SLOW_PATH, retryTruth, sepoliaTruth } from '../_shared';

const SUBJECT = '0x000000000000000000000000000000000000dEaD' as const;
const READ = PushChain.CONSTANTS.READ;

const d = pushKey ? describe : describe.skip;

d('read state › EVM balance from a Push EOA', () => {
  const tracker = createProgressTracker();
  const sepoliaRpc = sepoliaTruth();

  it('reads a Sepolia balance end to end and settles the budget', async () => {
    const { client, account } = await makePushEoaClient(pushKey!, tracker.hook);

    const prepared = await client.universal.prepareRead(SUBJECT, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      callback: { target: FULL_BUDGET_CLIENT, gasLimit: CALLBACK_GAS },
      expiryBlocks: SLOW_PATH.expiryBlocks,
    });
    expect(prepared.spec.revertRecipient).toBe(account.address);
    expect(prepared.spec.blockNumber).toBe(prepared.preflight.observedChainHeight - 1n);
    expect(prepared.fees.total).toBe(prepared.value);
    expect(prepared.warnings).toEqual([]);

    const sim = await client.universal.simulateRead(prepared, { appContract: FULL_BUDGET_CLIENT, callbackSelector: CALLBACK_SELECTOR });
    expect(sim).toEqual({ ok: true });

    const { txHash, read } = await sendRead(client, prepared, FULL_BUDGET_CLIENT);
    expect(read.txHash).toBe(txHash);
    expect(read.request.callbackTarget.toLowerCase()).toBe(FULL_BUDGET_CLIENT.toLowerCase());
    expect(read.request.refundTo).toBe(account.address);
    expect(read.fees.paid).toBe(prepared.value);
    expect(read.fees.callbackBudget).toBe(prepared.callbackBudget);

    tracker.reset();
    const done = await read.wait(SLOW_PATH.wait);
    expect(done.status).toBe(READ.STATUS.FULFILLED);
    expect(done.callbackDelivered).toBe(true);
    expect(done.raw?.status).toBe(READ.RESULT_STATUS.SUCCESS);

    const truth = await retryTruth(() => sepoliaRpc.getBalance({ address: SUBJECT, blockNumber: prepared.spec.blockNumber }));
    expect(done.value).toBe(truth);

    // settlement: burned + refunded == escrowed budget, refund pushed to the EOA
    expect(done.fees.burned).toBeGreaterThan(0n);
    expect(done.fees.refundFailed).toBe(false);
    expect(done.fees.burned! + done.fees.refunded!).toBe(done.fees.callbackBudget);

    const ids = tracker.getIds();
    expect(ids[0]).toBe('READ-TX-104-02');
    expect(ids).toContain('READ-TX-106-02');
    expect(ids[ids.length - 1]).toBe('READ-TX-199-01');
  }, SLOW_PATH.jestTimeoutMs);
});
