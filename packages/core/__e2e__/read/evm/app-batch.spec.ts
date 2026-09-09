import '@e2e/shared/setup';
import type { Address } from 'viem';
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { CALLBACK_GAS, FULL_BUDGET_CLIENT, READ_CLIENT_ABI, makePushEoaClient, pushKey, evmKey, SLOW_PATH, retryTruth, sepoliaTruth } from '../_shared';

const d = pushKey && evmKey ? describe : describe.skip;
const subject: Address = '0x000000000000000000000000000000000000dEaD';
const token: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const tokenAbi = [{ type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;

async function checkBatch(client: PushChain, atomic: boolean) {
  const callback = { target: FULL_BUDGET_CLIENT, gasLimit: CALLBACK_GAS, request: { abi: READ_CLIENT_ABI, functionName: 'request' } };
  const common = { chain: CHAIN.ETHEREUM_SEPOLIA, callback, expiryBlocks: SLOW_PATH.expiryBlocks } as const;
  const prepared = await Promise.all([
    client.universal.prepareRead(subject, common),
    client.universal.prepareRead(token, { ...common, storageSlot: 0n }),
    client.universal.prepareRead(token, { ...common, abi: tokenAbi, functionName: 'totalSupply' }),
  ]);
  const snapshots = await client.universal.executeReads(prepared, { waitForCompletion: false });
  expect(snapshots).toHaveLength(3);
  const result = await Promise.all(snapshots.map((r) => r.wait(SLOW_PATH.wait)));
  const rpc = sepoliaTruth();
  const truth = await retryTruth(() => Promise.all([
    rpc.getBalance({ address: subject, blockNumber: prepared[0].spec.blockNumber }),
    rpc.getStorageAt({ address: token, slot: `0x${'0'.repeat(64)}`, blockNumber: prepared[1].spec.blockNumber }),
    rpc.readContract({ address: token, abi: tokenAbi, functionName: 'totalSupply', blockNumber: prepared[2].spec.blockNumber }),
  ]));
  expect(result.map((r) => r.value)).toEqual([truth[0], truth[1], [truth[2]]]);
  expect(new Set(result.map((r) => r.requestId)).size).toBe(3);
  if (atomic) expect(new Set(result.map((r) => r.txHash)).size).toBe(1);
  for (const r of result) {
    expect(r.callbackDelivered).toBe(true);
    expect(r.request.refundTo.toLowerCase()).toBe(client.universal.account.toLowerCase());
    expect(r.fees.refundFailed).toBe(false);
    expect(r.fees.burned! + r.fees.refunded!).toBe(r.fees.callbackBudget);
  }
}

d('read state › custom app batch', () => {
  it('Push EOA preserves mixed-query order and decode shapes', async () => {
    const { client } = await makePushEoaClient(pushKey!);
    await checkBatch(client, false);
  }, SLOW_PATH.jestTimeoutMs);

  it('UEA preserves mixed-query order in one transaction', async () => {
    const { pushClient: client } = await createEvmPushClient({ chain: CHAIN.ETHEREUM_SEPOLIA, privateKey: evmKey! });
    await checkBatch(client, true);
  }, SLOW_PATH.jestTimeoutMs);
});
