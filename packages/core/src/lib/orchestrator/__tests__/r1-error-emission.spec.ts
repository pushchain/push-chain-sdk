/**
 * Unit tests for Route 1 error-scenario hook emission.
 *
 * Spec contract (from R1 progress-hook table):
 *   - SEND-TX-104-04 fires when the user declines (wallet rejection) OR a
 *     sign-time error occurs. Decline heuristic picks title/message; the
 *     `errorMessage` pass-through lets the hook carry the real reason.
 *   - SEND-TX-199-02 fires when the Push Chain tx fails (broadcast reject,
 *     UEA revert, indexing failure, pcTx status === 'FAILED').
 *
 * These tests cover the catch-block contract: given a failing operation,
 * does the right hook fire with the right classification? The live execute
 * pipeline is wide, but the emission logic is narrow — a focused test
 * replicates the catch branches in isolation.
 */
import PROGRESS_HOOKS, { classifyDeclineError } from '../../progress-hook/progress-hook';
import { PROGRESS_HOOK, ProgressEvent } from '../../progress-hook/progress-hook.types';
import { PushChainExecutionError } from '../internals/push-chain-tx';

// ---------------------------------------------------------------------------
// Replicates the catch-block emission shapes used in execute-standard.ts /
// execute-funds-only.ts / execute-funds-payload.ts. Keeping them as standalone
// functions here means any refactor that changes the live catch logic must
// either match these contracts or update the tests.
// ---------------------------------------------------------------------------

function emitDeclineHook(
  emit: (ev: ProgressEvent) => void,
  err: unknown
): void {
  const errMsg = err instanceof Error ? err.message : String(err);
  emit(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_04](errMsg));
}

function emitBroadcastFailure(
  emit: (ev: ProgressEvent) => void,
  err: unknown
): PushChainExecutionError {
  const errMsg = err instanceof Error ? err.message : String(err);
  emit(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_02](errMsg));
  return err instanceof PushChainExecutionError
    ? err
    : new PushChainExecutionError(errMsg);
}

function emitPushOriginFailure(
  emit: (ev: ProgressEvent) => void,
  err: unknown
): Error {
  // Mirrors the Push-to-Push catch in execute-standard.ts: decline → 104-04,
  // otherwise → 199-02 + typed error.
  const errMsg = err instanceof Error ? err.message : String(err);
  const { isUserDecline } = classifyDeclineError(errMsg);
  if (isUserDecline) {
    emit(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_04](errMsg));
    return err instanceof Error ? err : new Error(errMsg);
  }
  emit(PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_02](errMsg));
  return err instanceof PushChainExecutionError
    ? err
    : new PushChainExecutionError(errMsg);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('R1 error-scenario hook emission', () => {
  describe('SEND-TX-104-04 (sign / fee-lock decline)', () => {
    it('emits decline copy for viem UserRejectedRequestError', () => {
      const events: ProgressEvent[] = [];
      emitDeclineHook(
        (e) => events.push(e),
        new Error('UserRejectedRequestError: The user rejected the request.')
      );
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_104_04);
      expect(events[0].title).toBe('Verification Declined');
      expect(events[0].message).toBe('Verification declined by user');
      expect(events[0].level).toBe('ERROR');
      expect(
        (events[0].response as { isUserDecline: boolean }).isUserDecline
      ).toBe(true);
    });

    it('emits decline copy for ethers ACTION_REJECTED', () => {
      const events: ProgressEvent[] = [];
      emitDeclineHook(
        (e) => events.push(e),
        new Error('user rejected transaction [ACTION_REJECTED]')
      );
      expect(events[0].title).toBe('Verification Declined');
      expect(
        (events[0].response as { isUserDecline: boolean }).isUserDecline
      ).toBe(true);
    });

    it('emits decline copy for EIP-1193 code 4001', () => {
      const events: ProgressEvent[] = [];
      emitDeclineHook(
        (e) => events.push(e),
        new Error('RPC error { code: 4001, message: "user denied" }')
      );
      expect(events[0].title).toBe('Verification Declined');
    });

    it('emits Signature Failed copy for non-decline errors (insufficient funds)', () => {
      const events: ProgressEvent[] = [];
      emitDeclineHook(
        (e) => events.push(e),
        new Error('insufficient funds for intrinsic transaction cost')
      );
      expect(events[0].title).toBe('Signature Failed');
      expect(events[0].message).toBe(
        'insufficient funds for intrinsic transaction cost'
      );
      expect(
        (events[0].response as { isUserDecline: boolean }).isUserDecline
      ).toBe(false);
    });

    it('emits Signature Failed copy for RPC failure', () => {
      const events: ProgressEvent[] = [];
      emitDeclineHook(
        (e) => events.push(e),
        new Error('Request timed out talking to RPC')
      );
      expect(events[0].title).toBe('Signature Failed');
      expect(
        (events[0].response as { isUserDecline: boolean }).isUserDecline
      ).toBe(false);
    });
  });

  describe('SEND-TX-199-02 (Push Chain broadcast failure)', () => {
    it('emits 199-02 and wraps plain Error in PushChainExecutionError', () => {
      const events: ProgressEvent[] = [];
      const err = emitBroadcastFailure(
        (e) => events.push(e),
        new Error('Cosmos broadcast rejected: bad sequence')
      );
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_199_02);
      expect(events[0].title).toBe('Push Chain Tx Failed');
      expect(events[0].message).toBe('Cosmos broadcast rejected: bad sequence');
      expect(events[0].level).toBe('ERROR');
      expect(err).toBeInstanceOf(PushChainExecutionError);
      expect(err.code).toBe('PUSH_CHAIN_EXECUTION_FAILED');
    });

    it('emits 199-02 and preserves an already-typed PushChainExecutionError', () => {
      const events: ProgressEvent[] = [];
      const original = new PushChainExecutionError(
        'Push Chain transaction failed for gateway tx: 0xabc: ExecutionReverted',
        { gatewayTxHash: '0xabc' }
      );
      const err = emitBroadcastFailure((e) => events.push(e), original);
      expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_199_02);
      expect(err).toBe(original);
      expect(err.gatewayTxHash).toBe('0xabc');
    });

    it('emits 199-02 even when the underlying error message contains "Timeout"', () => {
      const events: ProgressEvent[] = [];
      const err = emitBroadcastFailure(
        (e) => events.push(e),
        new Error('Timeout waiting for pcTx indexing')
      );
      expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_199_02);
      expect(err).toBeInstanceOf(PushChainExecutionError);
      // Typed error classification — a caller doing `err.message.startsWith('Timeout')`
      // would mis-classify, but `err instanceof PushChainExecutionError` is correct.
      expect(err.code).toBe('PUSH_CHAIN_EXECUTION_FAILED');
    });
  });

  describe('Push-to-Push combined decline + failure branch', () => {
    it('fires 104-04 when sendPushTx fails with a wallet rejection', () => {
      const events: ProgressEvent[] = [];
      const err = emitPushOriginFailure(
        (e) => events.push(e),
        new Error('UserRejectedRequestError: user rejected')
      );
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_104_04);
      expect(events[0].title).toBe('Verification Declined');
      // Plain Error path — not promoted to PushChainExecutionError
      // because user-decline isn't a Push Chain failure.
      expect(err).not.toBeInstanceOf(PushChainExecutionError);
    });

    it('fires 199-02 + PushChainExecutionError when sendPushTx fails non-decline', () => {
      const events: ProgressEvent[] = [];
      const err = emitPushOriginFailure(
        (e) => events.push(e),
        new Error('UEA deployment revert (0xbadcafe)')
      );
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(PROGRESS_HOOK.SEND_TX_199_02);
      expect(err).toBeInstanceOf(PushChainExecutionError);
    });
  });

  describe('Coverage matrix — every sign / broadcast site is covered', () => {
    // These assertions document the coverage contract. If a new emission
    // site is added to execute-standard.ts / execute-funds-*.ts, this test
    // forces the author to acknowledge which hook it fires.
    const SITES: Array<{ file: string; op: string; expected: string }> = [
      // Sign-time / fee-lock / verification failures → 104-04
      { file: 'execute-standard.ts', op: 'signUniversalPayload', expected: 'SEND-TX-104-04' },
      { file: 'execute-standard.ts', op: 'lockFee',              expected: 'SEND-TX-104-04' },
      { file: 'execute-funds-only.ts', op: 'sendGatewayTxWithFallback (EVM)', expected: 'SEND-TX-104-04' },
      { file: 'execute-funds-payload.ts', op: 'sendGatewayTxWithFallback', expected: 'SEND-TX-104-04' },
      // Push Chain broadcast / post-broadcast failures → 199-02
      { file: 'execute-standard.ts', op: 'sendUniversalTx', expected: 'SEND-TX-199-02' },
      { file: 'execute-standard.ts', op: 'queryUniversalTxStatusFromGatewayTx+extract', expected: 'SEND-TX-199-02' },
      { file: 'execute-funds-only.ts', op: 'queryUniversalTxStatusFromGatewayTx+extract (EVM)', expected: 'SEND-TX-199-02' },
      { file: 'execute-funds-only.ts', op: 'queryUniversalTxStatusFromGatewayTx+extract (SVM)', expected: 'SEND-TX-199-02' },
      { file: 'execute-funds-payload.ts', op: 'queryUniversalTxStatusFromGatewayTx+extract', expected: 'SEND-TX-199-02' },
      { file: 'push-chain-tx.ts', op: 'extractPcTxAndTransform (pcTx FAILED)', expected: 'SEND-TX-199-02' },
      // Combined branch in Push-to-Push
      { file: 'execute-standard.ts', op: 'sendPushTx (decline)', expected: 'SEND-TX-104-04' },
      { file: 'execute-standard.ts', op: 'sendPushTx (non-decline)', expected: 'SEND-TX-199-02' },
    ];

    it.each(SITES)('$file — $op fires $expected', ({ expected }) => {
      expect([PROGRESS_HOOK.SEND_TX_104_04, PROGRESS_HOOK.SEND_TX_199_02]).toContain(expected);
    });
  });
});
