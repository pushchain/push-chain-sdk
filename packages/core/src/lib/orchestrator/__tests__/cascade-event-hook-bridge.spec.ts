/**
 * Unit tests for the cascade progress-event dispatch bridge.
 *
 * Background — the bug this guards against:
 *   `executeTransactions([prepared1, prepared2]) + cascade.wait({ progressHook })`
 *   in the push-chain-pusd PUSD/PUSD+ redeem flow used to deliver only the
 *   per-hop CascadeProgressEvent stream. The unified ProgressEvent markers
 *   (001 / 002-01 / 002-99-99 / 203-xx / 204-xx / 209-xx / 299-01 / 999-xx
 *   and the per-route awaiting/polling/success/failed/timeout hooks) were
 *   wired to a SEPARATE `eventHook` parameter on CascadeTrackOptions. UI-kit
 *   consumers wire `progressHook` at PushChain.initialize and never see
 *   `eventHook`, so the global progress toast received only the R1 ladder
 *   for the inner Push tx and went silent for the outbound R2 leg + cascade
 *   close-out.
 *
 * Fix:
 *   `dispatchCascadeProgressEvent` is the seam where cascade markers fan out.
 *   It accepts both the explicit `eventHook` (primary) and the init-time
 *   `ctx.progressHook` (secondary), invokes both with dedup if they're the
 *   same reference, and drops empty-id placeholder events.
 *
 * These tests pin the dispatch contract so the bridge can't regress without
 * a test failure.
 */
import { dispatchCascadeProgressEvent } from '../internals/cascade';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import {
  PROGRESS_HOOK,
  type ProgressEvent,
} from '../../progress-hook/progress-hook.types';

// A realistic cascade marker the redeem flow would emit on success.
const CASCADE_SUCCESS_999_01: ProgressEvent = PROGRESS_HOOKS[
  PROGRESS_HOOK.SEND_TX_999_01
](2);

// Placeholder event with empty id — pickWaitHooks returns this for R4 and
// unknown routes. The dispatcher must drop it so consumers don't see blank
// frames in the progress UI.
const PLACEHOLDER_EMPTY_ID: ProgressEvent = {
  id: '',
  title: 'placeholder',
  message: '',
  level: 'INFO',
  response: null,
  timestamp: new Date().toISOString(),
};

describe('dispatchCascadeProgressEvent', () => {
  it('no-op when both channels are undefined', () => {
    // Sanity guard: omitting both hooks must not throw. This is the
    // read-only / no-progress-listener case.
    expect(() =>
      dispatchCascadeProgressEvent(CASCADE_SUCCESS_999_01)
    ).not.toThrow();
  });

  it('delivers to the explicit eventHook only when ctx.progressHook is unset', () => {
    // Caller passed `eventHook` via cascade.wait({ eventHook: ... }), but
    // the PushChain instance was initialized without a progressHook. Only
    // the explicit channel fires.
    const primary = jest.fn();
    dispatchCascadeProgressEvent(
      CASCADE_SUCCESS_999_01,
      primary,
      undefined
    );
    expect(primary).toHaveBeenCalledTimes(1);
    expect(primary).toHaveBeenCalledWith(CASCADE_SUCCESS_999_01);
  });

  it('bridges to ctx.progressHook when no explicit eventHook is supplied (THE redeem-flow fix)', () => {
    // This is the regression guard for the push-chain-pusd ConvertPanel
    // case: app calls cascade.wait({ progressHook }) with NO eventHook,
    // PushChain was initialized with progressHook in the UI kit's
    // usePushChainClient. Cascade markers must reach ctx.progressHook so
    // the UI-kit toast receives 999-01 and clears its success-hide timer.
    const ctxProgressHook = jest.fn();
    dispatchCascadeProgressEvent(
      CASCADE_SUCCESS_999_01,
      undefined,
      ctxProgressHook
    );
    expect(ctxProgressHook).toHaveBeenCalledTimes(1);
    expect(ctxProgressHook).toHaveBeenCalledWith(CASCADE_SUCCESS_999_01);
  });

  it('fans out to both channels when they are different references', () => {
    // Caller wires their own eventHook (e.g. analytics) AND the UI kit
    // wired ctx.progressHook at init. Both are distinct functions and both
    // should receive every marker exactly once.
    const primary = jest.fn();
    const secondary = jest.fn();
    dispatchCascadeProgressEvent(
      CASCADE_SUCCESS_999_01,
      primary,
      secondary
    );
    expect(primary).toHaveBeenCalledTimes(1);
    expect(secondary).toHaveBeenCalledTimes(1);
    expect(primary).toHaveBeenCalledWith(CASCADE_SUCCESS_999_01);
    expect(secondary).toHaveBeenCalledWith(CASCADE_SUCCESS_999_01);
  });

  it('dedups when both channels reference the SAME function', () => {
    // Defensive: a caller might pass `eventHook: ctx.progressHook` (or
    // bind the same handler at both levels). The dispatcher must not
    // double-fire — the UI toast logic in usePushChainClient is sensitive
    // to terminal IDs and double-firing 999-01 would re-arm the
    // success-hide timer.
    const same = jest.fn();
    dispatchCascadeProgressEvent(CASCADE_SUCCESS_999_01, same, same);
    expect(same).toHaveBeenCalledTimes(1);
  });

  it('drops events with empty id (pickWaitHooks no-op sentinel)', () => {
    // pickWaitHooks returns id-less events for R4 / unknown routes so
    // cascade can keep its state machine moving without polluting the
    // consumer stream. Dispatcher must filter these on both channels.
    const primary = jest.fn();
    const secondary = jest.fn();
    dispatchCascadeProgressEvent(
      PLACEHOLDER_EMPTY_ID,
      primary,
      secondary
    );
    expect(primary).not.toHaveBeenCalled();
    expect(secondary).not.toHaveBeenCalled();
  });

  it('preserves the ProgressEvent shape (no field reshaping)', () => {
    // Channel handlers downstream (UI-kit setProgress, etc.) read fields
    // off the event. The dispatcher must pass the event by reference,
    // unchanged.
    const observed: ProgressEvent[] = [];
    const sink = (e: ProgressEvent) => {
      observed.push(e);
    };
    dispatchCascadeProgressEvent(
      CASCADE_SUCCESS_999_01,
      undefined,
      sink
    );
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(CASCADE_SUCCESS_999_01);
    expect(observed[0].id).toBe(PROGRESS_HOOK.SEND_TX_999_01);
    expect(observed[0].level).toBe('SUCCESS');
  });

  it('handles cascade-failure markers (999-02) the same way as success', () => {
    // The failure path through emitCascadeFailed also flows through this
    // dispatcher. Verify it's not accidentally tied to one marker family.
    const failureEvent = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_02](
      2,
      2,
      'Outbound failed for hop 1 on eip155:97'
    );
    const ctxProgressHook = jest.fn();
    dispatchCascadeProgressEvent(
      failureEvent,
      undefined,
      ctxProgressHook
    );
    expect(ctxProgressHook).toHaveBeenCalledTimes(1);
    expect(ctxProgressHook.mock.calls[0][0].id).toBe(
      PROGRESS_HOOK.SEND_TX_999_02
    );
    expect(ctxProgressHook.mock.calls[0][0].level).toBe('ERROR');
  });

  it('delivers a multi-event sequence in order across the bridge', () => {
    // Smoke test for an end-to-end sequence the redeem flow would produce
    // when the second hop is the moveable-token outbound. We feed the
    // events the cascade waitForAll body would emit (in order) and check
    // both channels see them in the same order.
    const explicit = jest.fn();
    const ctxProgress = jest.fn();
    const sequence: ProgressEvent[] = [
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_001](2, ['PUSH', 'eip155:11155111']),
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_002_01](
        1,
        2,
        'PUSH',
        'PUSH'
      ),
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_002_99_99](1, 2),
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_002_01](
        2,
        2,
        'PUSH',
        'eip155:11155111'
      ),
      PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_01](2),
    ];
    for (const e of sequence) {
      dispatchCascadeProgressEvent(e, explicit, ctxProgress);
    }
    expect(explicit).toHaveBeenCalledTimes(sequence.length);
    expect(ctxProgress).toHaveBeenCalledTimes(sequence.length);
    expect(explicit.mock.calls.map((c) => c[0].id)).toEqual([
      PROGRESS_HOOK.SEND_TX_001,
      PROGRESS_HOOK.SEND_TX_002_01,
      PROGRESS_HOOK.SEND_TX_002_99_99,
      PROGRESS_HOOK.SEND_TX_002_01,
      PROGRESS_HOOK.SEND_TX_999_01,
    ]);
    expect(ctxProgress.mock.calls.map((c) => c[0].id)).toEqual(
      explicit.mock.calls.map((c) => c[0].id)
    );
  });
});
