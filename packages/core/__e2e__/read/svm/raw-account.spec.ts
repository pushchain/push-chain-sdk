import '@e2e/shared/setup';
import { Connection, SystemProgram } from '@solana/web3.js';
import { bytesToHex } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { CHAIN_INFO, PUSH_CHAIN_INFO } from '../../../src/lib/constants/chain';
import { PushClient } from '../../../src/lib/push-client/push-client';
import { prepareRead } from '../../../src/lib/read-state/spec-builder';
import { CALLBACK_GAS, FULL_BUDGET_CLIENT, makePushEoaClient, pushKey, sendRead, SLOW_PATH } from '../_shared';

const d = pushKey ? describe : describe.skip;
d('read state › SVM raw account', () => {
  it('returns the System Program account bytes through the low-level query API', async () => {
    const { client } = await makePushEoaClient(pushKey!);
    const pushClient = new PushClient({ network: PUSH_NETWORK.TESTNET_DONUT, rpcUrls: PUSH_CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC });
    const prepared = await prepareRead({ pushClient, pushNetwork: PUSH_NETWORK.TESTNET_DONUT, defaultRefundTo: client.universal.account }, {
      destination: { chain: CHAIN.SOLANA_DEVNET },
      query: { type: 'rawAccountData', account: SystemProgram.programId.toBase58() },
      callbackGasLimit: CALLBACK_GAS, expiryBlocks: SLOW_PATH.expiryBlocks,
    });
    const { read } = await sendRead(client, prepared, FULL_BUDGET_CLIENT);
    const done = await read.wait(SLOW_PATH.wait);
    const connection = new Connection(CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC[0], 'finalized');
    const truth = await connection.getAccountInfo(SystemProgram.programId, 'finalized');
    expect(truth).not.toBeNull();
    if (!truth) throw new Error('Solana RPC did not return the System Program account');
    expect(done.callbackDelivered).toBe(true);
    expect(done.decoded).toEqual({ kind: 'raw', value: bytesToHex(truth.data) });
    expect(done.value).toBe(bytesToHex(truth.data));
  }, SLOW_PATH.jestTimeoutMs);
});
