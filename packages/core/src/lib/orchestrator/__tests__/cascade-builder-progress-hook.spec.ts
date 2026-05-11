/**
 * Tests for the per-call `progressHook` option on
 * `pushChain.universal.executeTransactions(txs, { progressHook })` —
 * implemented at the orchestrator seam as
 * `Orchestrator.createCascadedBuilder(txs, { progressHook })`.
 *
 * Contract under test:
 *
 *   1. When `progressHook` is omitted, `createCascadedBuilder` delegates
 *      straight through to the underlying cascade builder with no wrapping.
 *
 *   2. When `progressHook` is provided:
 *      a. During the synchronous `send()` phase, `ctx.progressHook` is
 *         replaced with a fanout that forwards every `ProgressEvent` to BOTH
 *         the init-time hook (passed to `PushChain.initialize`) AND the
 *         per-call hook. This captures pre-flight + composeCascade + broadcast
 *         emissions, which are all fired through `fireProgressHook(ctx, ...)`.
 *      b. If the per-call hook and init-time hook are the same function
 *         reference, the wrapper fires once (no double-delivery).
 *      c. The per-call hook is also passed as the cascade builder's
 *         `defaultEventHook` (4th positional arg), so it transparently becomes
 *         the default `eventHook` used by `waitForAll` for the post-broadcast
 *         tracking stream — without leaking the synchronous wrapper across
 *         calls.
 *      d. After `send()` resolves OR rejects, `ctx.progressHook` is restored
 *         to the original init-time hook so subsequent calls aren't polluted.
 *
 * The underlying `_createCascadedBuilder` (cascade.ts) is mocked so the test
 * runs in milliseconds and doesn't try to hit a Push Chain RPC. We only need
 * to verify the wrapping/threading contract — the real cascade logic is
 * tested elsewhere (e.g. `cascade-event-hook-bridge.spec.ts`, the e2e suite).
 */

import { Orchestrator } from '../orchestrator';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { UniversalSigner } from '../../universal/universal.types';
import {
  PROGRESS_HOOK,
  ProgressEvent,
} from '../../progress-hook/progress-hook.types';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import { fireProgressHook } from '../internals/context';
import type { OrchestratorContext } from '../internals/context';
import type { PreparedUniversalTx } from '../orchestrator.types';

// Replace the underlying cascade builder so we can drive the wrapper without
// composeCascade / RPC reads / signer / executeFn ever running for real.
//
// We need to mock at BOTH the source module AND the barrel — orchestrator.ts
// imports `createCascadedBuilder as _createCascadedBuilder` from
// `'./internals'` (the barrel re-export), so mocking only the source would
// leave the barrel's re-exported binding pointing at the real implementation.
jest.mock('../internals/cascade', () => {
  const actual = jest.requireActual('../internals/cascade');
  return {
    ...actual,
    createCascadedBuilder: jest.fn(),
  };
});
jest.mock('../internals', () => {
  const actual = jest.requireActual('../internals');
  const mockedCascade = jest.requireMock('../internals/cascade');
  return {
    ...actual,
    createCascadedBuilder: mockedCascade.createCascadedBuilder,
  };
});

import { createCascadedBuilder as _mockedCreateCascadedBuilder } from '../internals/cascade';
const mockedCreateCascadedBuilder =
  _mockedCreateCascadedBuilder as unknown as jest.Mock;

// Minimal signer — never used because we mock the cascade builder.
const mockSigner: UniversalSigner = {
  account: {
    address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
    chain: CHAIN.ETHEREUM_SEPOLIA,
  },
  signMessage: async (data: Uint8Array) => data,
  signAndSendTransaction: async (unsignedTx: Uint8Array) => unsignedTx,
};

// Fake hop. The mocked cascade builder never inspects this — it only exists to
// satisfy the array-length check in the caller. (`createCascadedBuilder` skips
// the wrapping entirely when `progressHook` is undefined, but it still calls
// the mock with `preparedTxs`.)
const fakePreparedTx = {
  _hop: { route: 'UOA_TO_PUSH' },
  route: 'UOA_TO_PUSH',
} as unknown as PreparedUniversalTx;

// Test progress event — content doesn't matter, only identity.
const TEST_EVENT_101: ProgressEvent =
  PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_101]('eip155:11155111');
const TEST_EVENT_199_01: ProgressEvent =
  PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_01]('0xdeadbeef');

function makeOrchestrator(
  initHook?: (e: ProgressEvent) => void
): Orchestrator {
  return new Orchestrator(
    mockSigner,
    PUSH_NETWORK.TESTNET_DONUT,
    {},
    false,
    initHook
  );
}

describe('Orchestrator.createCascadedBuilder — per-call progressHook', () => {
  beforeEach(() => {
    mockedCreateCascadedBuilder.mockReset();
  });

  it('does NOT wrap ctx.progressHook when no per-call hook is provided', async () => {
    const initHook = jest.fn();
    const orchestrator = makeOrchestrator(initHook);
    const ctx = orchestrator as unknown as OrchestratorContext;
    const originalHook = ctx.progressHook;

    // Inside the synchronous send(), inspect what ctx.progressHook looks like.
    let observedDuringSend: ((e: ProgressEvent) => void) | undefined;
    mockedCreateCascadedBuilder.mockReturnValue({
      send: async () => {
        observedDuringSend = ctx.progressHook;
        return { initialTxHash: '0xfake' };
      },
    });

    await orchestrator.createCascadedBuilder([fakePreparedTx]).send();

    // No wrapping: it's the init-time hook itself.
    expect(observedDuringSend).toBe(originalHook);
    expect(observedDuringSend).toBe(initHook);
    // And no `defaultEventHook` (4th arg) was passed.
    expect(mockedCreateCascadedBuilder.mock.calls[0][3]).toBeUndefined();
  });

  it('passes the per-call hook as defaultEventHook (4th arg) to the cascade builder', async () => {
    const initHook = jest.fn();
    const perCallHook = jest.fn();
    const orchestrator = makeOrchestrator(initHook);

    mockedCreateCascadedBuilder.mockReturnValue({
      send: async () => ({ initialTxHash: '0xfake' }),
    });

    await orchestrator
      .createCascadedBuilder([fakePreparedTx], { progressHook: perCallHook })
      .send();

    // 4th positional arg is `defaultEventHook`, and it must be the per-call
    // hook — that's the bridge that lets waitForAll's eventHook default to
    // the per-call hook for the post-broadcast tracking stream.
    expect(mockedCreateCascadedBuilder).toHaveBeenCalledTimes(1);
    expect(mockedCreateCascadedBuilder.mock.calls[0][3]).toBe(perCallHook);
  });

  it('wraps ctx.progressHook to fan events to BOTH init-time and per-call hooks during send()', async () => {
    const initHook = jest.fn();
    const perCallHook = jest.fn();
    const orchestrator = makeOrchestrator(initHook);
    const ctx = orchestrator as unknown as OrchestratorContext;

    // Inside the mocked send(), fire two progress events via the real
    // `fireProgressHook` (which reads ctx.progressHook at fire time). Both
    // hooks should receive each event, in order.
    mockedCreateCascadedBuilder.mockReturnValue({
      send: async () => {
        fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_101, 'eip155:11155111');
        fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_01, '0xdeadbeef');
        return { initialTxHash: '0xfake' };
      },
    });

    await orchestrator
      .createCascadedBuilder([fakePreparedTx], { progressHook: perCallHook })
      .send();

    // Both hooks see the same sequence.
    expect(initHook).toHaveBeenCalledTimes(2);
    expect(perCallHook).toHaveBeenCalledTimes(2);
    expect(initHook.mock.calls[0][0].id).toBe(TEST_EVENT_101.id);
    expect(initHook.mock.calls[1][0].id).toBe(TEST_EVENT_199_01.id);
    expect(perCallHook.mock.calls[0][0].id).toBe(TEST_EVENT_101.id);
    expect(perCallHook.mock.calls[1][0].id).toBe(TEST_EVENT_199_01.id);
  });

  it('dedups when the per-call hook IS the init-time hook (same reference fires once)', async () => {
    // A consumer might reasonably pass `{ progressHook: theSameHookFromInit }`
    // — wrapping must not double-fire, otherwise terminal markers (e.g.
    // 999-01) would re-trigger UI state machines that listen for them.
    const shared = jest.fn();
    const orchestrator = makeOrchestrator(shared);
    const ctx = orchestrator as unknown as OrchestratorContext;

    mockedCreateCascadedBuilder.mockReturnValue({
      send: async () => {
        fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_101, 'eip155:11155111');
        return { initialTxHash: '0xfake' };
      },
    });

    await orchestrator
      .createCascadedBuilder([fakePreparedTx], { progressHook: shared })
      .send();

    // One event, one call — not two.
    expect(shared).toHaveBeenCalledTimes(1);
    expect(shared.mock.calls[0][0].id).toBe(TEST_EVENT_101.id);
  });

  it('delivers events to the per-call hook even when no init-time hook is configured', async () => {
    const perCallHook = jest.fn();
    const orchestrator = makeOrchestrator(undefined); // no init hook
    const ctx = orchestrator as unknown as OrchestratorContext;

    mockedCreateCascadedBuilder.mockReturnValue({
      send: async () => {
        fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_101, 'eip155:11155111');
        return { initialTxHash: '0xfake' };
      },
    });

    await orchestrator
      .createCascadedBuilder([fakePreparedTx], { progressHook: perCallHook })
      .send();

    expect(perCallHook).toHaveBeenCalledTimes(1);
    expect(perCallHook.mock.calls[0][0].id).toBe(TEST_EVENT_101.id);
  });

  it('restores ctx.progressHook after send() resolves', async () => {
    const initHook = jest.fn();
    const perCallHook = jest.fn();
    const orchestrator = makeOrchestrator(initHook);
    const ctx = orchestrator as unknown as OrchestratorContext;

    mockedCreateCascadedBuilder.mockReturnValue({
      send: async () => ({ initialTxHash: '0xfake' }),
    });

    await orchestrator
      .createCascadedBuilder([fakePreparedTx], { progressHook: perCallHook })
      .send();

    // After resolution, ctx.progressHook is back to the init-time hook —
    // proving the wrapper doesn't leak into the next call.
    expect(ctx.progressHook).toBe(initHook);

    // Sanity: an event fired now (outside the cascade call) only reaches the
    // init-time hook, not the per-call hook.
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_101, 'eip155:11155111');
    expect(initHook).toHaveBeenCalledTimes(1);
    expect(perCallHook).not.toHaveBeenCalled();
  });

  it('restores ctx.progressHook even when send() rejects', async () => {
    const initHook = jest.fn();
    const perCallHook = jest.fn();
    const orchestrator = makeOrchestrator(initHook);
    const ctx = orchestrator as unknown as OrchestratorContext;

    mockedCreateCascadedBuilder.mockReturnValue({
      send: async () => {
        // Fire a pre-failure event (mimics SEND_TX_999_02 firing inside
        // composeCascade before the throw) and then throw.
        fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_101, 'eip155:11155111');
        throw new Error('insufficient UEA balance');
      },
    });

    await expect(
      orchestrator
        .createCascadedBuilder([fakePreparedTx], { progressHook: perCallHook })
        .send()
    ).rejects.toThrow('insufficient UEA balance');

    // Pre-throw event reached both hooks…
    expect(initHook).toHaveBeenCalledTimes(1);
    expect(perCallHook).toHaveBeenCalledTimes(1);
    // …and the wrapper was still restored despite the throw.
    expect(ctx.progressHook).toBe(initHook);
  });

  it('isolates per-call hooks across two sequential cascade calls', async () => {
    // The wrapper must be scoped strictly to ONE send(). Two sequential
    // executeTransactions calls with different per-call hooks must not bleed
    // into each other.
    const initHook = jest.fn();
    const perCallA = jest.fn();
    const perCallB = jest.fn();
    const orchestrator = makeOrchestrator(initHook);
    const ctx = orchestrator as unknown as OrchestratorContext;

    mockedCreateCascadedBuilder.mockImplementation(() => ({
      send: async () => {
        fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_101, 'eip155:11155111');
        return { initialTxHash: '0xfake' };
      },
    }));

    await orchestrator
      .createCascadedBuilder([fakePreparedTx], { progressHook: perCallA })
      .send();
    await orchestrator
      .createCascadedBuilder([fakePreparedTx], { progressHook: perCallB })
      .send();

    // Each per-call hook saw its own call exactly once. The init-time hook
    // saw both. Neither per-call hook leaked into the other's call.
    expect(perCallA).toHaveBeenCalledTimes(1);
    expect(perCallB).toHaveBeenCalledTimes(1);
    expect(initHook).toHaveBeenCalledTimes(2);
  });
});
