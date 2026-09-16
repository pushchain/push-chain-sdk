import '@e2e/shared/setup';
/**
 * E2E · read state · expiry, forced deterministically.
 *
 * minConfirmations 500 makes validators hold (latest < pin + 500 for ~2 h on Sepolia)
 * while expiryBlocks 30 lets the EndBlocker sweep it in ~40 s. Expiry is not
 * EVM-indexed (no tx, no receipt): the SDK must not try to fetch one; it confirms the
 * refund from the EndBlock tx_log events in the Cosmos block results instead.
 */
import { createPublicClient, http } from 'viem';
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { CALLBACK_GAS, FULL_BUDGET_CLIENT, createProgressTracker, makePushEoaClient, pushKey, sendRead } from '../_shared';

const READ = PushChain.CONSTANTS.READ;

const d = pushKey ? describe : describe.skip;

d('read state › expiry', () => {
  const tracker = createProgressTracker();
  const pushRpc = createPublicClient({ transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]) });

  it('EXPIRED is a status, refunds the whole budget, and never needs a receipt', async () => {
    const { client, account } = await makePushEoaClient(pushKey!);
    // The default pin backs off by minConfirmations (so normal reads never wait).
    // To force a hold, pin at the oracle head explicitly: validators then need
    // latest ≥ pin + 500, ~100 min away on Sepolia — long after expiryBlocks 30.
    const base = { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: FULL_BUDGET_CLIENT, gasLimit: CALLBACK_GAS } } as const;
    const probe = await client.universal.prepareRead('0x000000000000000000000000000000000000dEaD', base);
    const prepared = await client.universal.prepareRead('0x000000000000000000000000000000000000dEaD', {
      ...base,
      minConfirmations: 500,
      expiryBlocks: 30n,
      blockNumber: probe.preflight.observedChainHeight - 1n,
    });
    expect(prepared.spec.minConfirmations).toBe(500);

    const before = await pushRpc.getBalance({ address: account.address });
    const { read } = await sendRead(client, prepared, FULL_BUDGET_CLIENT);
    expect(read.status === READ.STATUS.PENDING || read.status === READ.STATUS.VOTING).toBe(true);

    const tracked = await client.universal.trackRead({ requestId: read.requestId }, { advanced: { timeout: 170_000, pollingIntervalMs: 3_000 }, progressHook: tracker.hook });
    // Client timeout must not cancel or corrupt the on-chain request. The same
    // handle can refresh and resume all the way to its eventual expiry/refund.
    await expect(tracked.wait({ timeoutMs: 500, pollingIntervalMs: 500 })).rejects.toMatchObject({ code: 'READ_TIMEOUT', requestId: read.requestId });
    expect((await tracked.refresh()).requestId).toBe(read.requestId);
    const done = await tracked.wait();
    expect(done.status).toBe(READ.STATUS.EXPIRED);
    expect(done.isTerminal).toBe(true);
    expect(done.callbackDelivered).toBeUndefined();
    expect(done.value).toBeUndefined();
    expect(done.fees.refunded).toBe(done.fees.callbackBudget); // RefundSent, confirmed from block_results
    expect(done.fees.refundFailed).toBe(false);
    expect(done.fees.burned).toBeUndefined();
    expect(done.pcTx).toHaveLength(1); // the sweeper's pseudo-tx — not fetchable, not fetched

    // the refund really landed: EOA lost only gas + protocol fee, not the budget
    const after = await pushRpc.getBalance({ address: account.address });
    expect(before - after).toBeLessThan(prepared.callbackBudget);

    const ids = tracker.getIds();
    expect(ids[ids.length - 1]).toBe('READ-TX-199-02');
  }, 300_000);
});
