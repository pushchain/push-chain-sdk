/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * Route 3 (CEA on source chain → Push Chain) — progress-hook parity between
 * the live sendTransaction() stream, trackTransaction() reconstruction, and
 * the tracked.wait() client stream.
 *
 * Two scenarios pinned here:
 *
 *  1. **Payload-only (timeout terminal)** — BNB_TESTNET source, no funds.
 *     Under the OBSERVED gate the flow never reaches cosmos OBSERVED (the
 *     source-chain Vault.finalizeUniversalTx reverts; cosmos stays at
 *     UNSPECIFIED). Deterministic terminal: SEND-TX-399-03 with
 *     phase='outbound'. Short outboundTimeoutMs keeps the test fast.
 *
 *  2. **Funds-flowing-back (success terminal)** — ETHEREUM_SEPOLIA source,
 *     USDT bridged back. Cosmos reaches OBSERVED in ~60–90 s; terminal is
 *     SEND-TX-309-03 SUCCESS with the external tx hash populated on the
 *     receipt (`externalStatus: 'success'`).
 *
 * Reconstruction in `tx-transformer.reconstructR3` emits a backbone WITHOUT
 * the 302-03-XX sizer hook; live stream includes it (Case A natural for
 * payload-only, Case A also natural for USDT bridge under current testnet
 * gas pricing). The expected live/replay arrays account for this.
 */
import { CHAIN } from '../../src/lib/constants/enums';
import type { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import type { UniversalExecuteParams } from '../../src/lib/orchestrator/orchestrator.types';
import { TransactionRoute } from '../../src/lib/orchestrator/route-detector';
import { getCEAAddress } from '../../src/lib/orchestrator/cea-utils';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { getToken } from '@e2e/shared/constants';
import { ensureCeaErc20Balance } from '@e2e/shared/outbound-helpers';
import type { Hex } from 'viem';

const EXECUTE_IDS_LIVE = [
  'SEND-TX-301',
  'SEND-TX-302-01',
  'SEND-TX-302-02',
  'SEND-TX-302-03-01', // Case A — payload-only R3 has gasUsd < $1
  'SEND-TX-303-01',
  'SEND-TX-303-02',
  'SEND-TX-304-01',
  'SEND-TX-304-02',
  'SEND-TX-304-03',
  'SEND-TX-307',
];

// Reconstructed execute-phase omits the sizer hook (see reconstructR3 in
// tx-transformer.ts — sizer requires gas-fee response which isn't available
// during reconstruction).
const EXECUTE_IDS_REPLAY = EXECUTE_IDS_LIVE.filter(
  (id) => !id.startsWith('SEND-TX-302-03')
);

// With outboundTimeoutMs: 30_000 and initialWaitMs clamped to 20_000,
// the poll loop fires at t≈20s (→ 309-02 once via dedupe), then times out.
// 199-99-99 is emitted internally but suppressed at the consumer boundary.
const WAIT_IDS_EXPECTED = [
  'SEND-TX-309-01', // awaiting BNB_TESTNET relay
  'SEND-TX-309-02', // first poll — emits once
  'SEND-TX-399-03', // outbound-phase timeout
];

describe('Route 3 progress-hook parity (live vs trackTransaction replay)', () => {
  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skip = !privateKey;

  it('live sendTransaction + trackTransaction replay emit the spec-ordered R3 hooks', async () => {
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

    const ueaAddress = liveSetup.pushClient.universal.account;

    // R3 payload-only from BNB CEA → Push Chain
    const liveTx = await liveSetup.pushClient.universal.sendTransaction({
      from: { chain: CHAIN.BNB_TESTNET },
      to: ueaAddress,
    });
    console.log(`Live Push Chain tx hash: ${liveTx.hash}`);

    // Short outbound timeout — R3 payload-only never reaches cosmos OBSERVED
    // (Vault.finalizeUniversalTx reverts on BSC), so we're deliberately
    // exercising the timeout-phase=outbound terminal.
    const liveReceipt = await liveTx.wait({ outboundTimeoutMs: 30_000 });
    expect(liveReceipt.status).toBe(1); // Push Chain execution succeeded
    expect(liveReceipt.externalStatus).toBe('timeout');

    const liveIds = liveClientEvents.map((e) => e.id);
    console.log(`Live stream (${liveIds.length}): ${liveIds.join(' → ')}`);

    const LIVE_EXPECTED = [...EXECUTE_IDS_LIVE, ...WAIT_IDS_EXPECTED];
    expect(liveIds).toEqual(LIVE_EXPECTED);

    // 399-03 must carry phase='outbound' and the source chain (not 'inbound').
    const terminalEvent = liveClientEvents.find(
      (e) => e.id === 'SEND-TX-399-03'
    )!;
    expect(
      (terminalEvent.response as { phase?: string } | null)?.phase
    ).toBe('outbound');
    expect(terminalEvent.title).toContain('BNB_TESTNET');

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
    expect(tracked.route).toBe(TransactionRoute.CEA_TO_PUSH);
    await tracked.wait({ outboundTimeoutMs: 30_000 });

    const replayIds = trackReplayEvents.map((e) => e.id);
    const trackClientIds = trackClientEvents.map((e) => e.id);
    console.log(
      `Replay stream (${replayIds.length}): ${replayIds.join(' → ')}`
    );
    console.log(
      `Track client stream (${trackClientIds.length}): ${trackClientIds.join(' → ')}`
    );

    // Replay stream = reconstructed execute (no sizer) + intermediate
    // 199-99-99 + wait-phase emitted via the auto-registered per-call
    // progressHook.
    const REPLAY_EXPECTED = [
      ...EXECUTE_IDS_REPLAY,
      ...WAIT_IDS_EXPECTED,
    ];
    expect(replayIds).toEqual(REPLAY_EXPECTED);

    // Wait-phase IDs reach the client-level hook too (fanOut dedupe).
    for (const id of WAIT_IDS_EXPECTED) {
      expect(trackClientIds).toContain(id);
    }
  }, 300_000);

  // ========================================================================
  // Scenario 2: FUNDS-flowing-back (success terminal)
  // ========================================================================
  // ETHEREUM_SEPOLIA source; cosmos OBSERVED gate is reached in ~60 s on
  // testnet. Terminal is 309-03 (SUCCESS), receipt.externalStatus='success',
  // externalTxHash populated. Validates the OBSERVED gate doesn't cause
  // false timeouts for legitimate success paths.
  it(
    'FUNDS success: live + replay + track-client streams complete full round-trip at 399-01',
    async () => {
      if (skip) {
        console.log('Skipping — EVM_PRIVATE_KEY unset');
        return;
      }

      const usdt = getToken(CHAIN.ETHEREUM_SEPOLIA, 'USDT');
      const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)

      // --- Live send -----------------------------------------------------
      const liveClientEvents: ProgressEvent[] = [];
      const liveSetup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey,
        progressHook: (e: ProgressEvent) => liveClientEvents.push(e),
      });

      const ueaAddress = liveSetup.pushClient.universal.account;
      const { cea: ceaAddress } = await getCEAAddress(
        ueaAddress,
        CHAIN.ETHEREUM_SEPOLIA
      );
      await ensureCeaErc20Balance({
        pushClient: liveSetup.pushClient,
        ceaAddress,
        token: usdt,
        requiredAmount: bridgeAmount,
        targetChain: CHAIN.ETHEREUM_SEPOLIA,
      });

      // Discard hooks emitted during the (conditional) R2 funding helper —
      // when the CEA is already pre-funded this is a no-op, but on a fresh
      // wallet ensureCeaErc20Balance runs a full UOA_TO_CEA bridge first.
      // We only want to assert on the R3 stream that follows.
      liveClientEvents.length = 0;

      const params: UniversalExecuteParams = {
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: ueaAddress,
        funds: { amount: bridgeAmount, token: usdt },
      };

      const liveTx = await liveSetup.pushClient.universal.sendTransaction(
        params
      );
      console.log(`FUNDS live Push tx: ${liveTx.hash}`);
      const liveReceipt = await liveTx.wait();
      expect(liveReceipt.status).toBe(1);
      expect(liveReceipt.externalStatus).toBe('success');
      expect(liveReceipt.externalTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const liveIds = liveClientEvents.map((e) => e.id);
      console.log(
        `FUNDS live stream (${liveIds.length}): ${liveIds.join(' → ')}`
      );

      // FUNDS R3 completes the full round-trip: outbound lands on Sepolia
      // (309-03), then Push-RPC tiebreaker resolves the inbound on first
      // poll so 310-02 is skipped, and 399-01 is the round-trip terminal.
      // 199-99-99 is suppressed at the consumer boundary.
      const SUCCESS_WAIT_IDS = [
        'SEND-TX-309-01',
        'SEND-TX-309-02',
        'SEND-TX-309-03',
        'SEND-TX-310-01',
        'SEND-TX-399-01',
      ];
      // Live execute = same backbone + sizer Case A (testnet gas < $1
      // naturally for USDT bridge).
      const LIVE_EXPECTED = [...EXECUTE_IDS_LIVE, ...SUCCESS_WAIT_IDS];
      expect(liveIds).toEqual(LIVE_EXPECTED);

      // 309-03 response should carry the external tx hash so downstream
      // consumers can link to the explorer.
      const successEvent = liveClientEvents.find(
        (e) => e.id === 'SEND-TX-309-03'
      )!;
      expect(successEvent.level).toBe('INFO');
      const successResp = successEvent.response as {
        txHash: string;
        chain: string;
      } | null;
      expect(successResp?.txHash).toBe(liveReceipt.externalTxHash);

      // --- trackTransaction replay --------------------------------------
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
      expect(tracked.route).toBe(TransactionRoute.CEA_TO_PUSH);
      await tracked.wait();

      const replayIds = trackReplayEvents.map((e) => e.id);
      const trackClientIds = trackClientEvents.map((e) => e.id);
      console.log(
        `FUNDS replay stream (${replayIds.length}): ${replayIds.join(' → ')}`
      );
      console.log(
        `FUNDS track-client stream (${trackClientIds.length}): ${trackClientIds.join(' → ')}`
      );

      // Replay stream = reconstructed execute (no sizer) + success wait-phase.
      const REPLAY_EXPECTED = [...EXECUTE_IDS_REPLAY, ...SUCCESS_WAIT_IDS];
      expect(replayIds).toEqual(REPLAY_EXPECTED);

      for (const id of SUCCESS_WAIT_IDS) {
        expect(trackClientIds).toContain(id);
      }
    },
    600_000 // 10 min — covers first-run CEA pre-fund (if needed) + cosmos indexer wait
  );
});
