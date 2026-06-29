import '@e2e/shared/setup';

import { Keypair } from '@solana/web3.js';
import { createWalletClient, http, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createProgressTracker } from '@e2e/shared/progress-tracker';
import {
  fundUeaPC,
  makePushContext,
} from '../docs-examples/_helpers/docs-fund';

const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;
const RECIPIENT = '0x0000000000000000000000000000000000042101' as `0x${string}`;
const SEND_VALUE = PushChain.utils.helpers.parseUnits('0.001', 18);
const UEA_PC_TOP_UP = '0.01';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function expectCompactInsufficientSourceBalance(
  run: () => Promise<unknown>,
  tracker: ReturnType<typeof createProgressTracker>
): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeDefined();
  const message = errorMessage(caught);
  expect(message).toMatch(/Insufficient (source|Solana) balance/i);
  expect(message.length).toBeLessThan(220);
  expect(message).not.toMatch(/TransactionRequest|VersionedTransaction/i);
  expect(message).not.toMatch(/Logs:\s*\[/i);

  const emittedMessages = tracker.events.map(({ event }) => event.message);
  expect(emittedMessages).toContain(message);
  expect(tracker.getIds()).toContain('SEND-TX-104-04');
  expect(tracker.getIds()).not.toContain('SEND-TX-199-02');
}

describe('source balance errors for funded fresh UEAs', () => {
  (pushKey ? it : it.skip)(
    'surfaces a compact Sepolia source-balance error after funding only the fresh UEA',
    async () => {
      const pushCtx = makePushContext(pushKey as Hex);
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
      });
      const tracker = createProgressTracker();

      const universalSigner =
        await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        });
      const client = await PushChain.initialize(universalSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: tracker.hook,
      });

      await fundUeaPC(
        pushCtx,
        client.universal.account as `0x${string}`,
        UEA_PC_TOP_UP
      );

      await expectCompactInsufficientSourceBalance(
        () =>
          client.universal.sendTransaction({
            to: RECIPIENT,
            value: SEND_VALUE,
          }),
        tracker
      );
    },
    300_000
  );

  (pushKey ? it : it.skip)(
    'surfaces a compact Solana source-balance error after funding only the fresh UEA',
    async () => {
      const pushCtx = makePushContext(pushKey as Hex);
      const keypair = Keypair.generate();
      const tracker = createProgressTracker();

      const universalSigner =
        await PushChain.utils.signer.toUniversalFromKeypair(keypair, {
          chain: CHAIN.SOLANA_DEVNET,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        });
      const client = await PushChain.initialize(universalSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: tracker.hook,
      });

      await fundUeaPC(
        pushCtx,
        client.universal.account as `0x${string}`,
        UEA_PC_TOP_UP
      );

      await expectCompactInsufficientSourceBalance(
        () =>
          client.universal.sendTransaction({
            to: RECIPIENT,
            value: SEND_VALUE,
          }),
        tracker
      );
    },
    300_000
  );
});
