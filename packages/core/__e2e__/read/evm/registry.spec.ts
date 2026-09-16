import '@e2e/shared/setup';
import { createPublicClient, http } from 'viem';
import { CHAIN, PushChain } from '../../../src';
// Internal helpers are used here to verify registry storage, not as public SDK APIs.
import { getReadQueryKey } from '../../../src/lib/read-state/read-params';
import { getRegistryReadResult, getLatestRegistryReadResult } from '../../../src/lib/read-state/registry';
import { PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { makePushEoaClient, pushKey, SLOW_PATH } from '../_shared';

// Funded test: submits two requests. Run explicitly through the read CI group.
const d = pushKey ? describe : describe.skip;
d('read state › canonical registry', () => {
  it('reads without a callback and groups different pins under one logical key', async () => {
    const { client, account } = await makePushEoaClient(pushKey!);
    const subject = account.address;
    const chain = CHAIN.ETHEREUM_SEPOLIA;
    const options = { chain, expiryBlocks: SLOW_PATH.expiryBlocks,
      advanced: { timeout: SLOW_PATH.wait.timeoutMs, pollingIntervalMs: SLOW_PATH.wait.pollingIntervalMs } } as const;
    const first = await client.universal.read(subject, options);
    expect(first.status).toBe(PushChain.CONSTANTS.READ.STATUS.FULFILLED);
    expect(first.raw?.status).toBe(PushChain.CONSTANTS.READ.RESULT_STATUS.SUCCESS);
    expect(first.callbackDelivered).toBe(true);
    const p = await client.universal.prepareRead(subject, { chain, blockNumber: first.request.spec.blockNumber - 1n,
      expiryBlocks: SLOW_PATH.expiryBlocks, callback: { gasLimit: 750_000n } });
    const batch = await client.universal.executeReads([p], { advanced: options.advanced });
    const second = batch.reads[0];
    expect(second.callbackDelivered).toBe(true);
    expect(second.raw?.status).toBe(PushChain.CONSTANTS.READ.RESULT_STATUS.SUCCESS);
    const rpc = createPublicClient({ transport: http('https://evm.donut.rpc.push.org') });
    const key = getReadQueryKey(subject, { chain });
    expect(p.queryKey).toBe(key);
    const stored = await getRegistryReadResult(rpc, PUSH_NETWORK.TESTNET_DONUT, BigInt(first.requestId));
    expect(stored.resultData).toBe(first.raw?.resultData);
    const latest = await getLatestRegistryReadResult(rpc, PUSH_NETWORK.TESTNET_DONUT, client.universal.account, key);
    expect(latest.requestId).toBe(BigInt(second.requestId));
    expect(latest.resultData).toBe(second.raw?.resultData);
    for (const result of [first, second]) {
      expect(result.request.refundTo.toLowerCase()).toBe(client.universal.account.toLowerCase());
      expect(result.fees.refundFailed).toBe(false);
      expect(result.fees.burned! + result.fees.refunded!).toBe(result.fees.callbackBudget);
    }
  }, SLOW_PATH.jestTimeoutMs * 2);
});
