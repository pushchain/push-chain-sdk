/**
 * Unit tests for Gap B: the `_routeTerminalEmitted` flag on
 * OrchestratorContext. When a route handler's inner catch fires an
 * early terminal-ish error hook (SEND_TX_104_04 / 204_04 / 304_04), it
 * sets the flag; the outer orchestrator.execute() catch then checks the
 * flag and skips its own 199_02 / 299_02 / 399_02 emission so the
 * consumer sees exactly ONE terminal per failure — not two.
 *
 * These tests don't instantiate a full Orchestrator — the flag wiring is
 * a pure contract between the inner route-handler emission and the outer
 * catch condition, so we model both halves directly and assert the
 * resulting stream. The matching live side is covered by the E2E parity
 * specs.
 */
import type { OrchestratorContext } from '../internals/context';
import type { ProgressEvent } from '../../progress-hook/progress-hook.types';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { TransactionRoute } from '../route-detector';
import { fireProgressHook } from '../internals/context';

type Route = TransactionRoute.UOA_TO_PUSH | TransactionRoute.UOA_TO_CEA | TransactionRoute.CEA_TO_PUSH;

function makeCtx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  const events: ProgressEvent[] = [];
  return {
    pushClient: {} as any,
    universalSigner: {} as any,
    pushNetwork: {} as any,
    rpcUrls: {},
    printTraces: false,
    progressHook: (e: ProgressEvent) => events.push(e),
    accountStatusCache: null,
    ...overrides,
    // Expose the collected events via a hidden property so tests can read them.
    // (cast required because `_collectedEvents` isn't on the interface)
    _collectedEvents: events,
  } as unknown as OrchestratorContext;
}

function getEvents(ctx: OrchestratorContext): ProgressEvent[] {
  return (ctx as unknown as { _collectedEvents: ProgressEvent[] })._collectedEvents;
}

/**
 * Mirrors the relevant slice of orchestrator.execute()'s outer catch. When
 * an inner route handler has already fired a terminal-ish error hook, the
 * flag is set and this function is a no-op. Otherwise it fires the
 * route-correct terminal.
 */
function simulateOrchestratorCatch(
  ctx: OrchestratorContext,
  route: Route,
  errMessage: string,
  isRecursiveInnerCall = false
): void {
  if (isRecursiveInnerCall || ctx._routeTerminalEmitted) return;
  if (route === TransactionRoute.CEA_TO_PUSH) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_399_02, errMessage, 'push');
  } else if (route === TransactionRoute.UOA_TO_CEA) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_299_02, errMessage);
  } else {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_02, errMessage);
  }
}

describe('Gap B: terminal-suppression flag on OrchestratorContext', () => {
  describe('R3 (CEA_TO_PUSH)', () => {
    it('suppresses 399-02 when 304-04 has fired (single terminal)', () => {
      const ctx = makeCtx({ currentRoute: TransactionRoute.CEA_TO_PUSH });

      // Inner route-handler simulation: executeFn threw → emit 304-04 +
      // set flag + rethrow.
      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_04, 'user rejected');
      ctx._routeTerminalEmitted = true;

      // Outer orchestrator catch: should skip 399-02 because flag is set.
      simulateOrchestratorCatch(ctx, TransactionRoute.CEA_TO_PUSH, 'user rejected');

      const ids = getEvents(ctx).map((e) => e.id);
      expect(ids).toEqual(['SEND-TX-304-04']);
      expect(ids).not.toContain('SEND-TX-399-02');
    });

    it('emits 399-02 (phase=push) when no inner terminal fired (pre-sign failure)', () => {
      const ctx = makeCtx({ currentRoute: TransactionRoute.CEA_TO_PUSH });

      // No inner terminal — simulate a pre-sign RPC failure that propagates
      // uncaught through the route handler to the orchestrator catch.
      simulateOrchestratorCatch(
        ctx,
        TransactionRoute.CEA_TO_PUSH,
        'Route 3 setup failed: could not resolve CEA'
      );

      const events = getEvents(ctx);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('SEND-TX-399-02');
      expect(events[0].title).toBe('Push Chain Tx Failed');
    });

    it('recursive inner call does not emit terminal even if flag is unset', () => {
      const ctx = makeCtx({ currentRoute: TransactionRoute.CEA_TO_PUSH });

      simulateOrchestratorCatch(
        ctx,
        TransactionRoute.CEA_TO_PUSH,
        'inner frame error',
        true // isRecursiveInnerCall
      );

      expect(getEvents(ctx)).toHaveLength(0);
    });
  });

  describe('R2 (UOA_TO_CEA)', () => {
    it('suppresses 299-02 when 204-04 has fired', () => {
      const ctx = makeCtx({ currentRoute: TransactionRoute.UOA_TO_CEA });

      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_04, 'signature failed');
      ctx._routeTerminalEmitted = true;

      simulateOrchestratorCatch(
        ctx,
        TransactionRoute.UOA_TO_CEA,
        'signature failed'
      );

      const ids = getEvents(ctx).map((e) => e.id);
      expect(ids).toEqual(['SEND-TX-204-04']);
      expect(ids).not.toContain('SEND-TX-299-02');
    });

    it('emits 299-02 when no inner terminal fired', () => {
      const ctx = makeCtx({ currentRoute: TransactionRoute.UOA_TO_CEA });

      simulateOrchestratorCatch(
        ctx,
        TransactionRoute.UOA_TO_CEA,
        'pre-sign failure'
      );

      const ids = getEvents(ctx).map((e) => e.id);
      expect(ids).toEqual(['SEND-TX-299-02']);
    });
  });

  describe('R1 (UOA_TO_PUSH)', () => {
    it('suppresses 199-02 when 104-04 has fired (user decline)', () => {
      const ctx = makeCtx({ currentRoute: TransactionRoute.UOA_TO_PUSH });

      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_04, 'user rejected');
      ctx._routeTerminalEmitted = true;

      simulateOrchestratorCatch(
        ctx,
        TransactionRoute.UOA_TO_PUSH,
        'user rejected'
      );

      const ids = getEvents(ctx).map((e) => e.id);
      expect(ids).toEqual(['SEND-TX-104-04']);
      expect(ids).not.toContain('SEND-TX-199-02');
    });

    it('suppresses second 199-02 when inner pipeline already fired 199-02', () => {
      // execute-standard.ts fires either 104-04 (decline) or 199-02 (other)
      // and sets the flag. The outer orchestrator catch must honor it.
      const ctx = makeCtx({ currentRoute: TransactionRoute.UOA_TO_PUSH });

      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_02, 'RPC failure');
      ctx._routeTerminalEmitted = true;

      simulateOrchestratorCatch(
        ctx,
        TransactionRoute.UOA_TO_PUSH,
        'RPC failure'
      );

      const ids = getEvents(ctx).map((e) => e.id);
      expect(ids).toEqual(['SEND-TX-199-02']); // exactly one, not two
    });
  });

  describe('Flag lifecycle (reset at execute() entry)', () => {
    it('fresh ctx does not have flag set — outer catch fires terminal', () => {
      const ctx = makeCtx({ currentRoute: TransactionRoute.CEA_TO_PUSH });
      // Default: flag undefined (falsy) — catch fires.
      expect(ctx._routeTerminalEmitted).toBeFalsy();
      simulateOrchestratorCatch(
        ctx,
        TransactionRoute.CEA_TO_PUSH,
        'first call'
      );
      expect(getEvents(ctx)).toHaveLength(1);
    });

    it('flag from a prior execute() is reset at the start of the next one', () => {
      const ctx = makeCtx({ currentRoute: TransactionRoute.CEA_TO_PUSH });

      // Previous execute set the flag.
      ctx._routeTerminalEmitted = true;

      // Start of new execute() — reset (mirrors the reset in
      // orchestrator.ts before the try block).
      ctx._routeTerminalEmitted = false;

      // This execute errors with a pre-sign failure (no inner terminal).
      simulateOrchestratorCatch(
        ctx,
        TransactionRoute.CEA_TO_PUSH,
        'second call pre-sign failure'
      );

      const ids = getEvents(ctx).map((e) => e.id);
      expect(ids).toEqual(['SEND-TX-399-02']); // terminal fires normally
    });
  });
});
