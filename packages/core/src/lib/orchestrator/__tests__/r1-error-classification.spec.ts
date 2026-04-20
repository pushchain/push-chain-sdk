/**
 * Unit tests for Route 1 (UOA → Push Chain) error classification and typed
 * error shapes.
 *
 * Covers:
 *  - `classifyDeclineError()` heuristic for real user-decline vs generic
 *    sign-time failures (shared between SEND_TX_104_04 and SEND_TX_204_04).
 *  - SEND_TX_104_04 builder output for both branches.
 *  - PushChainExecutionError typed error for 199-02 failures, including the
 *    anti-regression case where the failure message contains "Timeout" but
 *    must still classify as a failure (not a timeout path).
 */
import PROGRESS_HOOKS, { classifyDeclineError } from '../../progress-hook/progress-hook';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { PushChainExecutionError } from '../internals/push-chain-tx';

describe('R1 error classification', () => {
  describe('classifyDeclineError — true wallet rejections', () => {
    const cases: Array<[string, string]> = [
      ['viem UserRejectedRequestError', 'UserRejectedRequestError: The user rejected the request.'],
      ['ethers ACTION_REJECTED', 'user rejected transaction [ACTION_REJECTED]'],
      ['EIP-1193 4001 code', 'RPC error: { code: 4001, message: "User denied transaction signature" }'],
      ['textual "user rejected"', 'user rejected the request'],
      ['textual "user denied"', 'user denied message signature'],
      ['textual "declined by user"', 'Verification declined by user'],
      ['undefined errorMessage', undefined as unknown as string],
    ];

    it.each(cases)('classifies as user decline: %s', (_label, msg) => {
      const result = classifyDeclineError(msg);
      expect(result.isUserDecline).toBe(true);
      expect(result.title).toBe('Verification Declined');
      expect(result.message).toBe('Verification declined by user');
    });
  });

  describe('classifyDeclineError — generic sign-time failures', () => {
    const cases: Array<[string, string]> = [
      ['insufficient funds', 'insufficient funds for intrinsic transaction cost'],
      ['contract revert during sign', 'contract execution reverted: InvalidSelector()'],
      ['RPC failure', 'Request timed out talking to RPC'],
      ['generic error', 'something went wrong'],
    ];

    it.each(cases)('classifies as signature failure: %s', (_label, msg) => {
      const result = classifyDeclineError(msg);
      expect(result.isUserDecline).toBe(false);
      expect(result.title).toBe('Signature Failed');
      expect(result.message).toBe(msg);
    });
  });

  describe('SEND_TX_104_04 builder', () => {
    it('emits decline copy for a real wallet rejection', () => {
      const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_04](
        'UserRejectedRequestError: The user rejected the request.'
      );
      expect(event.id).toBe(PROGRESS_HOOK.SEND_TX_104_04);
      expect(event.title).toBe('Verification Declined');
      expect(event.message).toBe('Verification declined by user');
      expect(event.level).toBe('ERROR');
      const response = event.response as { error: string; isUserDecline: boolean };
      expect(response.isUserDecline).toBe(true);
      expect(response.error).toBe('UserRejectedRequestError: The user rejected the request.');
    });

    it('emits signature-failed copy for a generic sign-time error', () => {
      const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_04](
        'insufficient funds for intrinsic transaction cost'
      );
      expect(event.title).toBe('Signature Failed');
      expect(event.message).toBe('insufficient funds for intrinsic transaction cost');
      const response = event.response as { isUserDecline: boolean };
      expect(response.isUserDecline).toBe(false);
    });

    it('treats undefined errorMessage as a decline', () => {
      const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_04]();
      expect(event.title).toBe('Verification Declined');
      expect(event.message).toBe('Verification declined by user');
      const response = event.response as { error: string; isUserDecline: boolean };
      expect(response.isUserDecline).toBe(true);
      expect(response.error).toBe('Verification declined by user');
    });
  });

  describe('PushChainExecutionError', () => {
    it('carries a readonly PUSH_CHAIN_EXECUTION_FAILED code', () => {
      const err = new PushChainExecutionError('failed', {
        gatewayTxHash: '0xdef',
      });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(PushChainExecutionError);
      expect(err.code).toBe('PUSH_CHAIN_EXECUTION_FAILED');
      expect(err.gatewayTxHash).toBe('0xdef');
      expect(err.name).toBe('PushChainExecutionError');
    });

    it('gatewayTxHash defaults to undefined', () => {
      const err = new PushChainExecutionError('bare message');
      expect(err.code).toBe('PUSH_CHAIN_EXECUTION_FAILED');
      expect(err.gatewayTxHash).toBeUndefined();
    });

    // Consumer-side classification — proves the typed-error approach is
    // strictly safer than string-prefix matching. A Push-side revert whose
    // error payload happens to contain the word "Timeout" would be
    // mis-classified by any caller doing `err.message.startsWith('Timeout')`
    // but classifies correctly via `instanceof`.
    describe('consumer-side classification (anti-regression vs string-prefix)', () => {
      /** Classifier mirroring the pattern used in response-builder.wait(). */
      type Terminal = 'failure' | 'timeout' | 'unknown';
      class FakeTimeoutError extends Error {
        readonly code = 'TIMEOUT' as const;
      }
      const classifyViaInstanceOf = (err: unknown): Terminal => {
        if (err instanceof PushChainExecutionError) return 'failure';
        if (err instanceof FakeTimeoutError) return 'timeout';
        return 'unknown';
      };
      const classifyViaStringPrefix = (err: unknown): Terminal => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith('Timeout')) return 'timeout';
        return 'failure';
      };

      it('instanceof correctly classifies a PushChainExecutionError whose message starts with "Timeout"', () => {
        const err = new PushChainExecutionError(
          'Timeout waiting for pcTx indexing (Push Chain revert)'
        );
        expect(classifyViaInstanceOf(err)).toBe('failure');
      });

      it('string-prefix WOULD mis-classify the same error — demonstrates the regression being prevented', () => {
        const err = new PushChainExecutionError(
          'Timeout waiting for pcTx indexing (Push Chain revert)'
        );
        // This is exactly the bug the typed error defends against.
        expect(classifyViaStringPrefix(err)).toBe('timeout');
      });

      it('instanceof distinguishes timeout error from execution failure', () => {
        expect(classifyViaInstanceOf(new FakeTimeoutError('anything'))).toBe(
          'timeout'
        );
        expect(
          classifyViaInstanceOf(new PushChainExecutionError('anything'))
        ).toBe('failure');
      });
    });
  });
});
