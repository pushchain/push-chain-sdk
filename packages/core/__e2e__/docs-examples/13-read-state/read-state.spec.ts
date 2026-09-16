import '@e2e/shared/setup';
/**
 * Mirrors the runnable example in the read-state SDK spec (plan/read-state-sdk-spec.md,
 * "prepareRead / executeReads / trackRead" — the contract-dev flow) and the
 * .changeset/read-state.md snippet. When the website MDX page (13-Read-State.mdx)
 * lands, cite its slug + line range here and keep the block byte-for-byte.
 */
import { createWalletClient, http, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PushChain, toCallData } from '../../../src';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { PUSH_CHAIN_DEF, fundUeaPC, makePushContext } from '../_helpers/docs-fund';
import { READ_CLIENT_ABI, FULL_BUDGET_CLIENT } from '../../read/_shared';

const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;

describe('docs-examples › 13-read-state', () => {
  /**
   * slug: read_state_prepare_track (to be assigned) — a fresh Push wallet funded with
   * 0.5 PC prepares a Sepolia balance read for its own UniversalReadClient, sends it,
   * and tracks it to the decoded value.
   */
  (pushKey ? it : it.skip)('read_state_prepare_track — prepareRead → sendTransaction → trackRead → wait', async () => {
    const pushCtx = makePushContext(pushKey as Hex);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({ account, chain: PUSH_CHAIN_DEF, transport: http(PUSH_CHAIN_DEF.rpcUrls.default.http[0]) });
    await fundUeaPC(pushCtx, account.address, '0.5');

    // Code
    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.PUSH_TESTNET_DONUT,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, { network: PUSH_NETWORK.TESTNET_DONUT });

    const user = '0x000000000000000000000000000000000000dEaD';
    const myReadClient = FULL_BUDGET_CLIENT;

    // build a validated ReadSpec for your own UniversalReadClient contract
    const prepared = await client.universal.prepareRead(user, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      callback: { target: myReadClient, gasLimit: 200_000n },
    });
    const { data, value } = toCallData(prepared, { abi: READ_CLIENT_ABI, functionName: 'request' });
    const tx = await client.universal.sendTransaction({ to: myReadClient, data, value });
    await tx.wait();

    // resume by tx hash, wait for quorum, get the decoded value
    const [read] = await client.universal.trackRead({ txHash: tx.hash as Hex });
    const done = await read.wait();
    const ok = done.status === PushChain.CONSTANTS.READ.STATUS.FULFILLED && done.callbackDelivered;
    // Code end

    expect(ok).toBe(true);
    expect(typeof done.value).toBe('bigint');
    expect(done.fees.burned! + done.fees.refunded!).toBe(done.fees.callbackBudget);
  }, 300_000);
});
