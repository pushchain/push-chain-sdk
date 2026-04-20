/**
 * Unit test for the `waitForOutboundTx` initial-wait clamp.
 *
 * Before the fix: a short `timeout` (e.g. 100ms) was blocked by the default
 * 20s `initialWaitMs` — per-call timeout overrides via `tx.wait({
 * outboundTimeoutMs })` were effectively ignored.
 *
 * After the fix: `initialWaitMs` is clamped to `timeout`, and a fast-exit
 * throw fires as soon as elapsed >= timeout. This lets short timeouts
 * (deterministic tests, mobile UIs with tight budgets) actually fail fast.
 */
import { waitForOutboundTx, OutboundTimeoutError } from '../internals/outbound-sync';
import type { OrchestratorContext } from '../internals/context';

describe('waitForOutboundTx initial-wait clamp', () => {
  function makeStubCtx(): OrchestratorContext {
    // Minimal stub — the clamp path only needs printLog to be callable and
    // pushClient methods that never get invoked (the fast-exit branch bails
    // before any RPC). If the clamp is broken we'd block waiting on the
    // default 20s initial wait and the test would time out.
    return {
      pushClient: {
        getUniversalTxByIdV2: jest
          .fn()
          .mockRejectedValue(new Error('should not be reached')),
        publicClient: {
          getTransactionReceipt: jest
            .fn()
            .mockRejectedValue(new Error('should not be reached')),
        },
      },
      printTraces: false,
      pushNetwork: 'TESTNET_DONUT',
    } as unknown as OrchestratorContext;
  }

  it('throws OutboundTimeoutError within the clamped budget (100ms)', async () => {
    const ctx = makeStubCtx();
    const started = Date.now();

    await expect(
      waitForOutboundTx(ctx, '0xdeadbeef', {
        initialWaitMs: 20_000, // default — would block for 20s without the clamp
        pollingIntervalMs: 5_000,
        timeout: 100, // ← per-call override
      })
    ).rejects.toBeInstanceOf(OutboundTimeoutError);

    const elapsed = Date.now() - started;
    // With the clamp: initial wait = min(20_000, 100) = 100ms, then fast-exit.
    // Allow generous slack for jest scheduler jitter — the point is that
    // elapsed should be FAR less than the default 20s initial wait.
    expect(elapsed).toBeLessThan(1_500);
  });

  it('throws with elapsedMs matching the override (not the default)', async () => {
    const ctx = makeStubCtx();
    try {
      await waitForOutboundTx(ctx, '0xdeadbeef', {
        initialWaitMs: 20_000,
        pollingIntervalMs: 5_000,
        timeout: 200,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OutboundTimeoutError);
      const typed = err as OutboundTimeoutError;
      expect(typed.elapsedMs).toBeGreaterThanOrEqual(200);
      // Fast-exit runs ~immediately after the clamped initial wait; should
      // never approach the default 20_000ms.
      expect(typed.elapsedMs).toBeLessThan(2_000);
      expect(typed.code).toBe('OUTBOUND_TIMEOUT');
    }
  });
});
