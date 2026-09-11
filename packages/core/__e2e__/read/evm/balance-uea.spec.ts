import '@e2e/shared/setup';
/**
 * E2E · read state · the flagship path: a Sepolia-origin signer requests the read
 * THROUGH its UEA (Route 1 → UEA executes the client call). ReadRequested is emitted
 * inside the UEA's execute — the ingestion path the N1 fix added. First proven live
 * 2026-09-09 (read 0xdc0a66ba…); this spec keeps it proven.
 *
 * The UEA is the refund target: UEA_EVM has a payable receive(), so the unspent
 * budget lands back in it (Q8).
 */
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { CALLBACK_GAS, FULL_BUDGET_CLIENT, READ_CLIENT_ABI, createProgressTracker, evmKey, SLOW_PATH, retryTruth, sepoliaTruth } from '../_shared';

const READ = PushChain.CONSTANTS.READ;

const d = evmKey ? describe : describe.skip;

d('read state › EVM balance requested through a UEA', () => {
  const tracker = createProgressTracker();
  const sepoliaRpc = sepoliaTruth();

  it('UEA-originated request is ingested, fulfilled, and refunded to the UEA', async () => {
    const { pushClient: client, account } = await createEvmPushClient({ chain: CHAIN.ETHEREUM_SEPOLIA, privateKey: evmKey!, progressHook: tracker.hook });
    const uea = client.universal.account as `0x${string}`;

    // subject = the origin EOA itself: a balance the owner recognises
    const prepared = await client.universal.prepareRead(account.address, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      callback: { target: FULL_BUDGET_CLIENT, gasLimit: CALLBACK_GAS },
      expiryBlocks: SLOW_PATH.expiryBlocks,
    });
    expect(prepared.spec.revertRecipient).toBe(uea); // defaults to the UEA, no warning (it is a UEA)
    expect(prepared.warnings).toEqual([]);

    const read = await client.universal.read(account.address, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      blockNumber: prepared.spec.blockNumber,
      expiryBlocks: SLOW_PATH.expiryBlocks,
      callback: { target: FULL_BUDGET_CLIENT, gasLimit: CALLBACK_GAS, request: { abi: READ_CLIENT_ABI, functionName: 'request' } },
      waitForCompletion: false,
    });
    expect(read.request.originalFunder.toLowerCase()).toBe(FULL_BUDGET_CLIENT.toLowerCase());
    expect(read.request.refundTo).toBe(uea);

    const done = await read.wait(SLOW_PATH.wait);
    expect(done.status).toBe(READ.STATUS.FULFILLED);
    expect(done.callbackDelivered).toBe(true);
    expect(done.value).toBe(await retryTruth(() => sepoliaRpc.getBalance({ address: account.address, blockNumber: prepared.spec.blockNumber })));
    expect(done.fees.refundFailed).toBe(false);
    expect(done.fees.burned! + done.fees.refunded!).toBe(done.fees.callbackBudget);
  }, SLOW_PATH.jestTimeoutMs);
});
