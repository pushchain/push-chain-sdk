/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * Route 3 track-transaction replay parity against an already-completed
 * round-trip. Proves the full outbound + inbound hook stream fires on
 * replay of a historical Push tx, independent of whether the TSS relayer
 * happens to be healthy right now.
 *
 * The reference tx is the same one used by the universal-tx-detector's
 * Stage 3 live spec — a Push → Sepolia → Push round-trip where cosmos
 * has all three tx hashes indexed and universalTxId cross-referenced.
 */
import { CHAIN } from '../../src/lib/constants/enums';
import type { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { TransactionRoute } from '../../src/lib/orchestrator/route-detector';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import type { Hex } from 'viem';

// Known-good R3 FUNDS round-trip (Push root). Matches the detector live
// spec's Stage 3 root — cosmos has the full cascade indexed.
const PUSH_ROOT =
  '0x80fc70302f8eaac02649b18fe5a09b1580d0f6190b420d3a1058c39ecbf53443' as const;

// Backbone (no sizer — reconstructR3 drops 302-03-XX since it needs the
// live gas-fee response).
const EXECUTE_IDS_REPLAY = [
  'SEND-TX-301',
  'SEND-TX-302-01',
  'SEND-TX-302-02',
  'SEND-TX-303-01',
  'SEND-TX-303-02',
  'SEND-TX-304-01',
  'SEND-TX-304-02',
  'SEND-TX-304-03',
  'SEND-TX-307',
];

// Full R3 round-trip wait-phase — outbound + inbound round-trip.
// Note: 310-02 (inbound polling) only fires when the tiebreaker can't
// resolve on the first poll. For a fully-indexed historical tx (replay
// scenario), the Push RPC tiebreaker resolves immediately and 310-02 is
// skipped. The 199-99-99 intermediate marker is emitted internally but
// suppressed at the consumer dispatch boundary.
const WAIT_IDS_FULL_ROUND_TRIP = [
  'SEND-TX-309-01', // awaiting relay
  'SEND-TX-309-02', // polling outbound (dedupe)
  'SEND-TX-309-03', // outbound landed on Sepolia
  'SEND-TX-310-01', // inbound poll started
  'SEND-TX-399-01', // inbound Push tx confirmed → round-trip complete
];

describe('Route 3 replay parity (trackTransaction on a completed round-trip)', () => {
  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skip = !privateKey;

  it(
    'trackTransaction replay of a completed R3 round-trip emits the full 309-03 + 310-xx + 399-01 sequence',
    async () => {
      if (skip) {
        console.log('Skipping — EVM_PRIVATE_KEY unset');
        return;
      }

      // A signer is required even though we only call trackTransaction
      // (read-only). Reuse the shared test helper.
      const replayEvents: ProgressEvent[] = [];
      const clientEvents: ProgressEvent[] = [];

      const { pushClient } = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
        progressHook: (e: ProgressEvent) => clientEvents.push(e),
      });

      const tracked = await pushClient.universal.trackTransaction(
        PUSH_ROOT,
        {
          waitForCompletion: true,
          progressHook: (e: ProgressEvent) => replayEvents.push(e),
        }
      );

      expect(tracked.hash).toBe(PUSH_ROOT);
      expect(tracked.route).toBe(TransactionRoute.CEA_TO_PUSH);

      const receipt = await tracked.wait();
      expect(receipt.status).toBe(1);
      expect(receipt.externalStatus).toBe('success');
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.pushInboundTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(receipt.pushInboundUtxId).toMatch(/^0x[a-fA-F0-9]+$/);

      const replayIds = replayEvents.map((e) => e.id);
      const clientIds = clientEvents.map((e) => e.id);
      console.log(
        `Replay stream (${replayIds.length}): ${replayIds.join(' → ')}`
      );
      console.log(
        `Client stream (${clientIds.length}): ${clientIds.join(' → ')}`
      );

      const REPLAY_EXPECTED = [
        ...EXECUTE_IDS_REPLAY,
        ...WAIT_IDS_FULL_ROUND_TRIP,
      ];
      expect(replayIds).toEqual(REPLAY_EXPECTED);

      // Wait-phase IDs also reach the client-level hook (fanOut dedupe).
      for (const id of WAIT_IDS_FULL_ROUND_TRIP) {
        expect(clientIds).toContain(id);
      }

      // Spot-check: 309-03 carries the Sepolia tx hash; 399-01 carries the
      // Push inbound tx hash — both should be populated.
      const outboundConfirmed = replayEvents.find(
        (e) => e.id === 'SEND-TX-309-03'
      )!;
      expect(
        (outboundConfirmed.response as { txHash?: string } | null)?.txHash
      ).toBe(receipt.externalTxHash);

      const inboundConfirmed = replayEvents.find(
        (e) => e.id === 'SEND-TX-399-01'
      )!;
      expect(
        (inboundConfirmed.response as { txHash?: string } | null)?.txHash
      ).toBe(receipt.pushInboundTxHash);
    },
    300_000
  );
});
