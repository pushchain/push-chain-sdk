import '@e2e/shared/setup';
/**
 * E2E · read state · web2. A public JSON endpoint, two extracts, results in extract
 * order; heightless destination (blockNumber 0); fee 0 on Donut today.
 */
import { PushChain } from '../../../src';
import { CALLBACK_GAS, FULL_BUDGET_CLIENT, makePushEoaClient, pushKey, sendRead, SLOW_PATH } from '../_shared';

const READ = PushChain.CONSTANTS.READ;

const d = pushKey ? describe : describe.skip;

d('read state › web2 JSON', () => {
  it('GETs a public endpoint and decodes the extracts in order', async () => {
    const { client } = await makePushEoaClient(pushKey!);
    const prepared = await client.universal.prepareRead('https://jsonplaceholder.typicode.com/todos/1', {
      chain: READ.WEB2,
      web2: {
        extract: [
          { path: '$.id', valueType: 'uint256' },
          { path: '$.completed', valueType: 'bool' },
        ],
      },
      callback: { target: FULL_BUDGET_CLIENT, gasLimit: CALLBACK_GAS },
      expiryBlocks: SLOW_PATH.expiryBlocks,
    });
    expect(prepared.spec.blockNumber).toBe(0n);
    expect(prepared.spec.account).toMatchObject({ chainNamespace: 'web2', chainId: 'https' });
    expect(prepared.protocolFee).toBe(0n);

    const { read } = await sendRead(client, prepared, FULL_BUDGET_CLIENT);
    const done = await read.wait(SLOW_PATH.wait);
    expect(done.status).toBe(READ.STATUS.FULFILLED);
    expect(done.callbackDelivered).toBe(true);
    expect(done.chain).toBeUndefined();
    expect(done.destination.caip2).toBe('web2:https');
    expect(done.value).toEqual([1n, false]);
  }, SLOW_PATH.jestTimeoutMs);
});
