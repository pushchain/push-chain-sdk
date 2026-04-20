/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * Route 3 track-transaction replay of an R3 where the Push Chain leg
 * succeeded but the outbound tx on the source chain REVERTED. Verifies
 * the reverted external case emits SEND-TX-399-02 with phase='outbound'
 * (title "BSC Testnet Tx Failed") and annotates the receipt with
 * externalStatus='failed'. Companion to r3-replay-completed.spec.ts.
 *
 * Reference tx: 0x1f15f1a67150ecc2e6e89b14d95cb718c8613aecd02aa72e46d6fb258f93a78b
 *   - PC Execution on Push block 13831807 (confirmed)
 *   - Outbound → BSC Testnet observed tx 0x0e2036…0f10ff (reverted)
 */
import { CHAIN } from '../../src/lib/constants/enums';
import type { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { TransactionRoute } from '../../src/lib/orchestrator/route-detector';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import type { Hex } from 'viem';

const PUSH_ROOT =
  '0x1f15f1a67150ecc2e6e89b14d95cb718c8613aecd02aa72e46d6fb258f93a78b' as const;

// Reconstructed execute backbone (no sizer on replay).
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

describe('R3 replay of a tx with reverted outbound on source chain', () => {
  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skip = !privateKey;

  it(
    'emits 399-02 (phase=outbound) when cosmos / source-chain RPC reports REVERTED',
    async () => {
      if (skip) {
        console.log('Skipping — EVM_PRIVATE_KEY unset');
        return;
      }

      const replayEvents: ProgressEvent[] = [];
      const { pushClient } = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        printTraces: true,
      });

      const tracked = await pushClient.universal.trackTransaction(PUSH_ROOT, {
        waitForCompletion: true,
        progressHook: (e: ProgressEvent) => replayEvents.push(e),
      });

      expect(tracked.hash).toBe(PUSH_ROOT);
      expect(tracked.route).toBe(TransactionRoute.CEA_TO_PUSH);

      const receipt = await tracked.wait();
      console.log(`Receipt status: ${receipt.status}`);
      console.log(`externalStatus: ${receipt.externalStatus}`);
      console.log(`externalTxHash: ${receipt.externalTxHash}`);
      console.log(`externalError: ${receipt.externalError}`);

      // Push Chain leg succeeded — status stays 1.
      expect(receipt.status).toBe(1);
      // External leg reverted — annotated on the receipt.
      expect(receipt.externalStatus).toBe('failed');
      expect(typeof receipt.externalError).toBe('string');
      // Failed BSC Testnet tx hash is now propagated via OutboundFailedError
      // so consumers can link to the explorer without parsing errMsg.
      expect(receipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      // No inbound round-trip — pushInboundTxHash stays unset.
      expect(receipt.pushInboundTxHash).toBeUndefined();

      const ids = replayEvents.map((e) => e.id);
      console.log(`Failed-outbound stream (${ids.length}): ${ids.join(' → ')}`);

      // Must start with the full execute backbone in order.
      expect(ids.slice(0, EXECUTE_IDS_REPLAY.length)).toEqual(EXECUTE_IDS_REPLAY);

      // Must include the outbound-start hook (309-01) and the failure terminal
      // (399-02). 309-02 may or may not fire depending on tiebreaker timing.
      expect(ids).toContain('SEND-TX-309-01');
      expect(ids).toContain('SEND-TX-399-02');

      // Must NOT include the success terminal or inbound hooks.
      expect(ids).not.toContain('SEND-TX-309-03');
      expect(ids).not.toContain('SEND-TX-310-01');
      expect(ids).not.toContain('SEND-TX-399-01');

      // 399-02 title must reflect the source chain (phase='outbound'), not
      // the default "Push Chain Inbound Tx Failed".
      const failedEvent = replayEvents.find((e) => e.id === 'SEND-TX-399-02')!;
      expect(failedEvent.level).toBe('ERROR');
      expect(failedEvent.title.toLowerCase()).toContain('tx failed');
      expect(failedEvent.title.toLowerCase()).not.toContain('inbound');
      console.log(`399-02 title: ${failedEvent.title}`);
      console.log(`399-02 message: ${failedEvent.message}`);
    },
    300_000
  );
});
