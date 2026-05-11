/**
 * E2E tests for the per-call `progressHook` option on
 * `pushChain.universal.executeTransactions(txs, { progressHook })`.
 *
 * Why these tests exist:
 *   `executeTransactions` previously took only `txs`. The init-time
 *   `progressHook` (passed to `PushChain.initialize`) was the only way to
 *   observe events during a cascade. We added a second, optional per-call
 *   `progressHook` argument that is ADDITIVE with the init-time hook — both
 *   should receive every `ProgressEvent` emitted during this call, with
 *   reference-dedup so passing the same function twice doesn't double-fire.
 *
 *   These e2es use a Sepolia EVM signer and target Push Chain Donut — the
 *   UOA_TO_PUSH (R1) route, single-hop early-return path inside
 *   `createCascadedBuilder`. (Push-native EOAs are blocked from
 *   `prepareTransaction` for Push-Chain targets — see cascade.ts:153 — so
 *   we use a Sepolia signer that maps to a UEA on Push.) The single-hop
 *   path directly invokes the inner `execute()`, which fires SEND-TX-101 /
 *   107 / 199-01 through `ctx.progressHook` — exactly the slot our wrapper
 *   intercepts.
 *
 * Run:
 *   EVM_PRIVATE_KEY=0x... npx nx test core \
 *     --testPathPattern='push/execute-transactions-progress-hook'
 */
import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { Hex } from 'viem';
import { createEvmPushClient } from '@e2e/shared/evm-client';

describe('executeTransactions per-call progressHook (e2e)', () => {
  const to = '0x35B84d6848D16415177c64D64504663b998A6ab4';

  let pushClient: PushChain;
  let initHookEvents: ProgressEvent[];

  // The init-time hook is registered once on the PushChain instance and reused
  // across every test. Each test clears `initHookEvents` in beforeEach so it
  // captures only that test's events.
  const initHook = (event: ProgressEvent) => {
    initHookEvents.push(event);
  };

  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
  const skip = !privateKey;

  beforeAll(async () => {
    if (skip) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }
    initHookEvents = [];
    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKey!,
      progressHook: initHook,
    });
    pushClient = setup.pushClient;
  }, 120_000);

  beforeEach(() => {
    initHookEvents = [];
  });

  it(
    'fires both init-time and per-call hooks during executeTransactions (additive)',
    async () => {
      if (skip) return;

      const perCallEvents: ProgressEvent[] = [];
      const perCallHook = (event: ProgressEvent) => {
        perCallEvents.push(event);
      };

      // Prepare a Push-only tx (UOA_TO_PUSH / R1). Single-hop takes the
      // early-return path inside createCascadedBuilder, which directly
      // invokes the inner execute() — the path that fires SEND-TX-101 /
      // 107 / 199-01 through `fireProgressHook(ctx, ...)`. Our wrapper
      // installs a fanout on ctx.progressHook for the duration of send().
      const prep = await pushClient.universal.prepareTransaction({
        to,
        value: BigInt(100),
      });
      const result = await pushClient.universal.executeTransactions(
        [prep],
        { progressHook: perCallHook }
      );

      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Both hooks must see the same canonical events for an R1 broadcast.
      // We use 101 (origin detected) and 199-01 (Push success) as anchors —
      // they're emitted by the standard payload pipeline used here.
      const initIds = initHookEvents.map((e) => e.id);
      const perCallIds = perCallEvents.map((e) => e.id);
      expect(initIds).toContain('SEND-TX-101');
      expect(initIds).toContain('SEND-TX-199-01');
      expect(perCallIds).toContain('SEND-TX-101');
      expect(perCallIds).toContain('SEND-TX-199-01');

      // Per-call hook should see the same ordered ID sequence as the
      // init-time hook for the synchronous send() phase. (Both wrappers
      // operate on the same `ctx.progressHook` slot, so by construction
      // they receive identical events in identical order.)
      expect(perCallIds).toEqual(initIds);

      console.log(
        `✓ init-time hook received ${initHookEvents.length} events; per-call hook received ${perCallEvents.length} events; sequences match.`
      );
    },
    120_000
  );

  it(
    'dedups when the per-call hook IS the init-time hook (no double-fire)',
    async () => {
      if (skip) return;

      // Count how many times each unique event id is delivered to initHook.
      // If the wrapper double-fired we would see counts of 2 for events
      // emitted during send().
      const countsBefore = countById(initHookEvents);

      const prep = await pushClient.universal.prepareTransaction({
        to,
        value: BigInt(100),
      });
      const result = await pushClient.universal.executeTransactions(
        [prep],
        { progressHook: initHook } // same reference as init-time hook
      );
      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Delta = events emitted during this executeTransactions call only.
      const countsAfter = countById(initHookEvents);
      const delta = subtractCounts(countsAfter, countsBefore);

      // The anchors must be present, AND each must occur exactly once.
      // A buggy wrapper that forgot to dedup would deliver 2× per event.
      expect(delta['SEND-TX-101'] ?? 0).toBe(1);
      expect(delta['SEND-TX-199-01'] ?? 0).toBe(1);

      // Defensive: no id should appear more than once in the delta. (Some
      // route handlers do emit certain ids twice within one tx — that's a
      // legitimate emission pattern, not a wrapper bug. R1 single-hop here
      // does not, so we assert ≤1 for every id seen.)
      for (const [id, count] of Object.entries(delta)) {
        expect(count).toBeLessThanOrEqual(1);
        if (count > 1) {
          console.error(`Duplicate emission detected for ${id}: ${count}×`);
        }
      }

      console.log(
        `✓ same-reference dedup verified — ${Object.keys(delta).length} unique events, all fired exactly once.`
      );
    },
    120_000
  );

  it(
    'falls back to init-time hook only when no per-call hook is provided',
    async () => {
      if (skip) return;

      // Sanity check: omitting `options` should leave behavior identical to
      // the pre-change codepath. Per-call hook is undefined, init-time hook
      // receives the full event stream.
      const prep = await pushClient.universal.prepareTransaction({
        to,
        value: BigInt(100),
      });
      const result = await pushClient.universal.executeTransactions([prep]);
      expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const ids = initHookEvents.map((e) => e.id);
      expect(ids).toContain('SEND-TX-101');
      expect(ids).toContain('SEND-TX-199-01');

      console.log(
        `✓ backwards-compatible path — init-time hook received ${initHookEvents.length} events.`
      );
    },
    120_000
  );

  it(
    'isolates the per-call hook to its own call (does not leak into subsequent calls)',
    async () => {
      if (skip) return;

      const perCallA: ProgressEvent[] = [];
      const prepA = await pushClient.universal.prepareTransaction({
        to,
        value: BigInt(100),
      });
      await pushClient.universal.executeTransactions([prepA], {
        progressHook: (e) => perCallA.push(e),
      });

      // Sanity: hook A fired during its call.
      expect(perCallA.map((e) => e.id)).toContain('SEND-TX-101');

      // Now call executeTransactions WITHOUT a per-call hook. If the wrapper
      // failed to restore `ctx.progressHook`, hook A would keep receiving
      // events from this second call too.
      const perCallALengthBefore = perCallA.length;
      const prepB = await pushClient.universal.prepareTransaction({
        to,
        value: BigInt(100),
      });
      await pushClient.universal.executeTransactions([prepB]);

      expect(perCallA.length).toBe(perCallALengthBefore);

      console.log(
        `✓ per-call hook scoped correctly — hook A received ${perCallALengthBefore} events on its call and 0 on the next call.`
      );
    },
    180_000
  );
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function countById(events: ProgressEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.id] = (counts[e.id] ?? 0) + 1;
  }
  return counts;
}

function subtractCounts(
  after: Record<string, number>,
  before: Record<string, number>
): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const [id, count] of Object.entries(after)) {
    const prev = before[id] ?? 0;
    if (count - prev > 0) delta[id] = count - prev;
  }
  return delta;
}
