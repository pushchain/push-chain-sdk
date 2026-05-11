/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Reproduces Option 3 from
 * https://github.com/pushchain/push-chain-examples/tree/main/core-sdk-functions/send-universal-transaction-to-external-chains
 *
 * Flow (per the example's `route2SolanaCounter()`):
 *   - Signer: Push-native EOA on Push Chain Donut (PUSH_PRIVATE_KEY).
 *   - Action: `client.universal.sendTransaction({
 *       to: { address: SOL_TEST_PROGRAM, chain: SOLANA_DEVNET },
 *       value: 0n,
 *       data: <encodeTxData(IDL, receive_sol, [0n])>,
 *     })`
 *   - Expectation: tx broadcasts on Push Chain, outbound relays to Solana
 *     Devnet, `tx.wait()` returns `receipt.status === 1` and
 *     `receipt.externalChain === SOLANA_DEVNET`.
 *
 * Important difference from the existing
 * `docs-examples/07-transaction-scenarios/route2.spec.ts::route2_solana`
 * (currently `.skip`'d): that test uses a SEPOLIA UOA signer. Option 3 in
 * the public example uses a PUSH-NATIVE EOA — i.e. the user signs directly
 * on Push Chain with no UOA hop. Whether the route detector / R2 SVM
 * handlers behave correctly for Push-native + external-SVM-target is what
 * this spec validates.
 *
 * Run:
 *   PUSH_PRIVATE_KEY=0x... npx nx test core \
 *     --testPathPattern='svm/outbound/option3-push-eoa-to-solana-counter'
 */
import '@e2e/shared/setup';
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import { Hex } from 'viem';
import { createEvmPushClient } from '@e2e/shared/evm-client';

// Same Solana Devnet program + Anchor IDL as the public example.
const SOL_TEST_PROGRAM = '8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx';

// Trimmed Anchor IDL — only the `receive_sol(amount: u64)` instruction
// invoked here. Matches example index.ts:43-61 byte-for-byte.
const TEST_COUNTER_IDL = {
  address: SOL_TEST_PROGRAM,
  metadata: { name: 'test_counter', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'receive_sol',
      discriminator: [121, 244, 250, 3, 8, 229, 225, 1],
      accounts: [
        {
          name: 'counter',
          writable: true,
          pda: {
            seeds: [
              { kind: 'const', value: [99, 111, 117, 110, 116, 101, 114] },
            ],
          },
        },
        {
          name: 'recipient',
          writable: true,
          address: '89q1AUFb7YREHtjc1aYaPywovPq6tb3GYNPyDUJ3rshi',
        },
        { name: 'cea_authority', writable: true },
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
  ],
} as const;

describe('Option 3 — Push-native EOA → test_counter.receive_sol on Solana Devnet (e2e)', () => {
  let pushClient: PushChain;
  const events: ProgressEvent[] = [];

  const privateKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;
  const skip = !privateKey;

  beforeAll(async () => {
    if (skip) {
      console.log('Skipping — PUSH_PRIVATE_KEY not set');
      return;
    }
    const setup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey: privateKey!,
      progressHook: (e: ProgressEvent) => {
        events.push(e);
        // Log the lifecycle stream so a failed run shows exactly where the
        // SDK stopped firing events (mirrors the example's formatter).
        const emoji =
          e.level === 'SUCCESS' ? '✅' : e.level === 'ERROR' ? '❌' : 'ℹ️';
        console.log(`${emoji} [${e.id}] ${e.title}`);
      },
    });
    pushClient = setup.pushClient;
    console.log(`UEA on Push: ${pushClient.universal.account}`);
  }, 120_000);

  beforeEach(() => {
    events.length = 0;
  });

  it(
    'sendTransaction to Solana Devnet test_counter via Push-native EOA + Anchor IDL',
    async () => {
      if (skip) return;

      // Encode receive_sol(amount=0) using the Anchor IDL — same path as
      // the public example (encodeTxData with `abi: TEST_COUNTER_IDL`).
      const data = PushChain.utils.helpers.encodeTxData({
        abi: TEST_COUNTER_IDL as any,
        functionName: 'receive_sol',
        args: [BigInt(0)],
      });
      // Sanity: the encoded bytes must match the well-known Borsh +
      // discriminator output from the unit-tested fixture (utils.spec.ts:470).
      // If this assertion fails, encodeTxData regressed and the on-chain
      // behavior below is undefined.
      expect(data).toBe('0x79f4fa0308e5e1010000000000000000');

      let tx;
      try {
        tx = await pushClient.universal.sendTransaction({
          to: {
            address: SOL_TEST_PROGRAM,
            chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
          },
          value: BigInt(0),
          data,
        });
      } catch (err) {
        console.log('\n──── ProgressEvent stream up to failure ────');
        for (const e of events) {
          console.log(`  [${e.id}] level=${e.level} title=${e.title}`);
        }
        console.log('───────────────────────────────────────────');
        throw err;
      }

      console.log(`📤 Push tx hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await tx.wait();
      console.log(`✅ Settled. status=${receipt.status} block=${receipt.blockNumber}`);
      if (receipt.externalTxHash) {
        console.log(`   Solana tx hash:  ${receipt.externalTxHash}`);
        console.log(`   external status: ${receipt.externalStatus ?? 'n/a'}`);
      }

      expect(receipt.status).toBe(1);
      expect(receipt.externalStatus).toBe('success');
      expect(receipt.externalChain).toBe(CHAIN.SOLANA_DEVNET);
      expect(receipt.externalTxHash).toBeDefined();
      // For SVM targets, the SDK returns `externalTxHash` as a base58 Solana
      // signature (no `0x` prefix). Users can paste it directly into a
      // Solana explorer or `connection.getTransaction(sig)`. A 64-byte
      // signature encodes to 87–88 base58 chars.
      expect(receipt.externalTxHash).not.toMatch(/^0x/);
      expect(receipt.externalTxHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,90}$/);
    },
    600_000
  );
});
