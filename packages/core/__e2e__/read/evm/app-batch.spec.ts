import '@e2e/shared/setup';
import type { Address } from 'viem';
import { PushChain, ReadStateError } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { CALLBACK_GAS, FULL_BUDGET_CLIENT, READ_CLIENT_ABI, makePushEoaClient, pushKey, evmKey, SLOW_PATH, retryTruth, sepoliaTruth } from '../_shared';

const d = describe;
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
  (pushKey ? it : it.skip)('recovers the committed read after a sequential request failure', async () => {
    const { client } = await makePushEoaClient(pushKey!, undefined, true);
    const good = await client.universal.prepareRead(subject, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      expiryBlocks: SLOW_PATH.expiryBlocks,
      callback: { target: FULL_BUDGET_CLIENT, gasLimit: CALLBACK_GAS, request: { abi: READ_CLIENT_ABI, functionName: 'request' } },
    });
    // Deliberately invalid second call: the app/system contract rejects gasLimit=0.
    // In the sequential path the first read is already paid for and must be recoverable.
    const error = await client.universal.executeReads([good, { ...good, callbackGasLimit: 0n }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReadStateError);
    const failure = error as ReadStateError;
    expect(failure.code).toBe('READ_REQUEST_TX_FAILED');
    expect(failure.transactionHashes).toHaveLength(1);
    expect(failure.pendingTransactionHash).toBeUndefined();
    const [snapshot] = await client.universal.trackRead({ txHash: failure.transactionHashes![0] });
    const done = await snapshot.wait(SLOW_PATH.wait);
    expect(done.callbackDelivered).toBe(true);
    expect(done.value).toBe(await retryTruth(() => sepoliaTruth().getBalance({ address: subject, blockNumber: good.spec.blockNumber })));
    expect(done.fees.burned! + done.fees.refunded!).toBe(done.fees.callbackBudget);
  }, SLOW_PATH.jestTimeoutMs);

  (pushKey ? it : it.skip)('Push EOA preserves mixed-query order and decode shapes', async () => {
    const { client } = await makePushEoaClient(pushKey!);
    await checkBatch(client, false);
  }, SLOW_PATH.jestTimeoutMs);

  (evmKey ? it : it.skip)('UEA preserves mixed-query order in one transaction', async () => {
    const { pushClient: client } = await createEvmPushClient({ chain: CHAIN.ETHEREUM_SEPOLIA, privateKey: evmKey! });
    await checkBatch(client, true);
  }, SLOW_PATH.jestTimeoutMs);
});
