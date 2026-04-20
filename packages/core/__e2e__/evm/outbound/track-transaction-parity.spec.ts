/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * Route 2 (UEA → CEA) — progress-hook parity between the live
 * sendTransaction() stream and a subsequent trackTransaction() replay.
 *
 * Asserts:
 *  - Live execute-phase stream emits the spec-ordered IDs.
 *  - tracked.wait() fires the wait-phase IDs (209-xx / 299-xx) on the
 *    client-level progressHook.
 *  - trackTransaction()'s per-call progressHook replays the execute-phase
 *    events plus the intermediate 299-99 marker.
 */
import { CHAIN } from '../../../src/lib/constants/enums';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import { buildErc20WithdrawalMulticall } from '../../../src/lib/orchestrator/payload-builders';
import { getToken } from '@e2e/shared/constants';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { TEST_TARGET } from '@e2e/shared/outbound-helpers';
import type { Hex } from 'viem';

const EXECUTE_IDS_EXPECTED = [
  'SEND-TX-201',
  'SEND-TX-202-01',
  'SEND-TX-202-02',
  'SEND-TX-203-01',
  'SEND-TX-203-02',
  'SEND-TX-204-01',
  'SEND-TX-204-02',
  'SEND-TX-204-03',
  'SEND-TX-207',
];

// 299-99 is the intermediate Push-success marker — emitted internally but
// suppressed at the consumer dispatch boundary.
const WAIT_IDS_EXPECTED = [
  'SEND-TX-209-01',
  'SEND-TX-209-02',
  'SEND-TX-299-01',
];

describe('Route 2 progress-hook parity (live vs trackTransaction replay)', () => {
  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skip = !privateKey;

  it('live sendTransaction + trackTransaction replay emit the spec-ordered hooks', async () => {
    if (skip) {
      console.log('Skipping — EVM_PRIVATE_KEY unset');
      return;
    }

    // --- Live send ------------------------------------------------------
    const liveClientEvents: ProgressEvent[] = [];
    const liveSetup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      progressHook: (e: ProgressEvent) => liveClientEvents.push(e),
    });

    const usdt = getToken(CHAIN.ETHEREUM_SEPOLIA, 'USDT');
    const amount = BigInt(10000); // 0.01 USDT
    const params: UniversalExecuteParams = {
      to: { address: TEST_TARGET, chain: CHAIN.ETHEREUM_SEPOLIA },
      funds: { amount, token: usdt },
      data: buildErc20WithdrawalMulticall(
        usdt.address as `0x${string}`,
        TEST_TARGET,
        amount
      ),
    };
    expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

    const liveTx = await liveSetup.pushClient.universal.sendTransaction(params);
    console.log(`Live tx hash: ${liveTx.hash}`);
    const liveReceipt = await liveTx.wait();
    expect(liveReceipt.status).toBe(1);
    expect(liveReceipt.externalTxHash).toBeDefined();

    const liveIds = liveClientEvents.map((e) => e.id);
    console.log(`Live stream (${liveIds.length}): ${liveIds.join(' → ')}`);

    // Live stream must match the full spec-ordered sequence exactly.
    // Post-refactor: 202 fires before 203, and 207 fires after 204-03.
    const LIVE_EXPECTED = [...EXECUTE_IDS_EXPECTED, ...WAIT_IDS_EXPECTED];
    expect(liveIds).toEqual(LIVE_EXPECTED);

    // --- trackTransaction replay ---------------------------------------
    const trackReplayEvents: ProgressEvent[] = [];
    const trackClientEvents: ProgressEvent[] = [];
    const trackSetup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      progressHook: (e: ProgressEvent) => trackClientEvents.push(e),
    });

    const tracked = await trackSetup.pushClient.universal.trackTransaction(
      liveTx.hash,
      {
        waitForCompletion: true,
        progressHook: (e: ProgressEvent) => trackReplayEvents.push(e),
      }
    );
    expect(tracked.hash).toBe(liveTx.hash);
    expect(tracked.route).toBe(TransactionRoute.UOA_TO_CEA);
    await tracked.wait();

    const replayIds = trackReplayEvents.map((e) => e.id);
    const trackClientIds = trackClientEvents.map((e) => e.id);
    console.log(`Replay stream (${replayIds.length}): ${replayIds.join(' → ')}`);
    console.log(
      `Track client stream (${trackClientIds.length}): ${trackClientIds.join(' → ')}`
    );

    // Replay stream = reconstructed execute-phase (in spec order) followed
    // by the wait-phase events delivered through the auto-registered
    // per-call progressHook. The intermediate 299-99 marker is emitted
    // internally but suppressed at the consumer dispatch boundary.
    const REPLAY_EXPECTED = [...EXECUTE_IDS_EXPECTED, ...WAIT_IDS_EXPECTED];
    expect(replayIds).toEqual(REPLAY_EXPECTED);

    // Same wait-phase IDs also reach the client-level hook.
    for (const id of WAIT_IDS_EXPECTED) {
      expect(trackClientIds).toContain(id);
    }
  }, 420000);
});
