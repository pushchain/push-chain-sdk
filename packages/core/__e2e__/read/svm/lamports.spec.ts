import '@e2e/shared/setup';
/**
 * E2E · read state · Solana devnet lamport balance.
 * The account rides in ReadSpec.account.owner as the raw 32-byte pubkey; the envelope
 * carries only a minSlot floor (reads run at finalized, not pinned).
 */
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import bs58 from 'bs58';
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { CALLBACK_GAS, FULL_BUDGET_CLIENT, makePushEoaClient, pushKey, sendRead, solanaKey, SLOW_PATH } from '../_shared';

const READ = PushChain.CONSTANTS.READ;

const d = pushKey && solanaKey ? describe : describe.skip;

d('read state › SVM lamports', () => {
  it('reads the Solana master balance at finalized commitment', async () => {
    const owner = Keypair.fromSecretKey(bs58.decode(solanaKey!)).publicKey;
    const conn = new Connection(process.env['SOLANA_RPC_URL'] ?? clusterApiUrl('devnet'), 'finalized');

    const { client } = await makePushEoaClient(pushKey!);
    const prepared = await client.universal.prepareRead(owner.toBase58(), {
      chain: CHAIN.SOLANA_DEVNET,
      callback: { target: FULL_BUDGET_CLIENT, gasLimit: CALLBACK_GAS },
      expiryBlocks: SLOW_PATH.expiryBlocks,
    });
    expect(prepared.spec.account.owner).toBe(`0x${Buffer.from(new PublicKey(owner).toBytes()).toString('hex')}`);
    expect(prepared.spec.account.chainNamespace).toBe('solana');

    const { read } = await sendRead(client, prepared, FULL_BUDGET_CLIENT);
    const done = await read.wait(SLOW_PATH.wait);
    expect(done.status).toBe(READ.STATUS.FULFILLED);
    expect(done.callbackDelivered).toBe(true);
    expect(done.chain).toBe(CHAIN.SOLANA_DEVNET);

    // the master does not move during this spec, so finalized balance is stable
    const truth = BigInt(await conn.getBalance(owner, 'finalized'));
    expect(done.value).toBe(truth);
  }, SLOW_PATH.jestTimeoutMs);
});
