/**
 * Unit tests for Route 3 (CEA on source chain → Push Chain) error
 * classification.
 *
 * Covers:
 *  - SEND_TX_304_04 builder output for both branches (wallet rejection vs
 *    generic sign-time failure) via the shared `classifyDeclineError` helper.
 *  - Parity assertion: 104_04 / 204_04 / 304_04 all emit identical title +
 *    message strings for the same errorMessage — locks the shared-helper
 *    contract so future changes don't drift one route's copy from another.
 */
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';

describe('R3 error classification', () => {
  describe('SEND_TX_304_04 builder', () => {
    it('emits decline copy for a real wallet rejection', () => {
      const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_04](
        'UserRejectedRequestError: The user rejected the request.'
      );
      expect(event.id).toBe(PROGRESS_HOOK.SEND_TX_304_04);
      expect(event.title).toBe('Verification Declined');
      expect(event.message).toBe('Verification declined by user');
      expect(event.level).toBe('ERROR');
      const response = event.response as { error: string; isUserDecline: boolean };
      expect(response.isUserDecline).toBe(true);
      expect(response.error).toBe(
        'UserRejectedRequestError: The user rejected the request.'
      );
    });

    it('emits signature-failed copy for a generic sign-time error', () => {
      const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_04](
        'insufficient funds for intrinsic transaction cost'
      );
      expect(event.title).toBe('Signature Failed');
      expect(event.message).toBe(
        'insufficient funds for intrinsic transaction cost'
      );
      const response = event.response as { isUserDecline: boolean };
      expect(response.isUserDecline).toBe(false);
    });

    it('treats undefined errorMessage as a decline', () => {
      const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_04]();
      expect(event.title).toBe('Verification Declined');
      expect(event.message).toBe('Verification declined by user');
      const response = event.response as {
        error: string;
        isUserDecline: boolean;
      };
      expect(response.isUserDecline).toBe(true);
      expect(response.error).toBe('Verification declined by user');
    });

    it('classifies ethers ACTION_REJECTED as a decline', () => {
      const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_04](
        'user rejected transaction [ACTION_REJECTED]'
      );
      expect(event.title).toBe('Verification Declined');
      const response = event.response as { isUserDecline: boolean };
      expect(response.isUserDecline).toBe(true);
    });

    it('classifies EIP-1193 4001 code as a decline', () => {
      const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_04](
        'RPC error: { code: 4001, message: "User denied transaction signature" }'
      );
      expect(event.title).toBe('Verification Declined');
      const response = event.response as { isUserDecline: boolean };
      expect(response.isUserDecline).toBe(true);
    });

    it('classifies RPC timeout during signing as signature-failed (not decline)', () => {
      const event = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_04](
        'Request timed out talking to RPC'
      );
      expect(event.title).toBe('Signature Failed');
      const response = event.response as { isUserDecline: boolean };
      expect(response.isUserDecline).toBe(false);
    });
  });

  // Parity guard: 104_04 / 204_04 / 304_04 share classifyDeclineError. If one
  // gets a different title/message for the same input, the shared-helper
  // contract has drifted.
  describe('104_04 / 204_04 / 304_04 parity (shared classifier)', () => {
    const inputs = [
      'UserRejectedRequestError: The user rejected the request.',
      'user rejected transaction [ACTION_REJECTED]',
      'insufficient funds for intrinsic transaction cost',
      'something went wrong',
      undefined,
    ];

    it.each(inputs)(
      'emits identical title + message across all three routes for: %s',
      (msg) => {
        const e1 = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_104_04](msg);
        const e2 = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_04](msg);
        const e3 = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_304_04](msg);
        expect(e3.title).toBe(e1.title);
        expect(e3.message).toBe(e1.message);
        expect(e2.title).toBe(e1.title);
        expect(e2.message).toBe(e1.message);
        const r1 = e1.response as { isUserDecline: boolean };
        const r2 = e2.response as { isUserDecline: boolean };
        const r3 = e3.response as { isUserDecline: boolean };
        expect(r3.isUserDecline).toBe(r1.isUserDecline);
        expect(r2.isUserDecline).toBe(r1.isUserDecline);
      }
    );
  });
});
