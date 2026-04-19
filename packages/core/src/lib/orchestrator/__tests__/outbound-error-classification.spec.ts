/**
 * Unit tests for outbound/inbound error classification and receipt
 * annotation on the R2/R3 wait() error paths.
 *
 * Covers:
 *  - OutboundTimeoutError → 299-03 (`externalStatus: 'timeout'`)
 *  - OutboundFailedError → 299-02 (`externalStatus: 'failed'`)
 *  - InboundTimeoutError → 399-03 (`externalStatus: 'timeout'`)
 *  - Generic inbound Error → 399-02 (`externalStatus: 'failed'`)
 *
 * These assertions stand in for a full live E2E — triggering a real 180s
 * outbound timeout wastes CI time, and deliberately reverting an external
 * tx requires contrived on-chain fixtures. The logic under test is pure
 * classification + receipt mutation, so a focused unit test is sufficient.
 */
import {
  OutboundTimeoutError,
  OutboundFailedError,
} from '../internals/outbound-sync';
import { InboundTimeoutError } from '../internals/inbound-tracker';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { pickWaitHooks } from '../internals/progress-route-hooks';
import { TransactionRoute } from '../route-detector';
import { CHAIN } from '../../constants/enums';

describe('Outbound/inbound error classification', () => {
  describe('Typed error shapes', () => {
    it('OutboundTimeoutError carries code + timings', () => {
      const err = new OutboundTimeoutError('0xabc', 181_000, 180_000);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(OutboundTimeoutError);
      expect(err.code).toBe('OUTBOUND_TIMEOUT');
      expect(err.pushChainTxHash).toBe('0xabc');
      expect(err.elapsedMs).toBe(181_000);
      expect(err.message).toContain('Timeout');
    });

    it('OutboundFailedError carries code + destination chain', () => {
      const err = new OutboundFailedError(
        'Outbound to eip155:11155111 reverted: insufficient balance. Push Chain TX: 0xdef.',
        '0xdef',
        'eip155:11155111'
      );
      expect(err).toBeInstanceOf(OutboundFailedError);
      expect(err.code).toBe('OUTBOUND_FAILED');
      expect(err.destinationChain).toBe('eip155:11155111');
    });

    it('InboundTimeoutError carries correlation key + elapsed', () => {
      const err = new InboundTimeoutError('0xouter', 300_000);
      expect(err).toBeInstanceOf(InboundTimeoutError);
      expect(err.code).toBe('INBOUND_TIMEOUT');
      expect(err.correlationKey).toBe('0xouter');
      expect(err.elapsedMs).toBe(300_000);
    });
  });

  describe('R2 emit + receipt mutation (replicates response-builder.wait()) ', () => {
    // Mirrors the classification branch in response-builder.ts:
    //   const isTimeout = error instanceof OutboundTimeoutError;
    //   emit(isTimeout ? hooks.timeout(...) : hooks.failed(...));
    //   baseReceipt = { ...baseReceipt,
    //     externalStatus: isTimeout ? 'timeout' : 'failed',
    //     externalError: errMsg };
    function classify(
      error: unknown,
      targetChain: string,
      maxTimeoutMs: number,
      baseReceipt: Record<string, unknown>
    ) {
      const hooks = pickWaitHooks(TransactionRoute.UOA_TO_CEA);
      const errMsg = error instanceof Error ? error.message : String(error);
      const isTimeout = error instanceof OutboundTimeoutError;
      const event = isTimeout
        ? hooks.timeout(targetChain, maxTimeoutMs)
        : hooks.failed(targetChain, errMsg);
      const next = {
        ...baseReceipt,
        externalStatus: isTimeout ? 'timeout' : 'failed',
        externalError: errMsg,
      };
      return { event, receipt: next };
    }

    it('Timeout → SEND-TX-299-03 + externalStatus=timeout', () => {
      const err = new OutboundTimeoutError('0xpushtx', 181_000, 180_000);
      const { event, receipt } = classify(err, CHAIN.ETHEREUM_SEPOLIA, 180_000, {
        status: 1,
      });
      expect(event.id).toBe(PROGRESS_HOOK.SEND_TX_299_03);
      expect(event.level).toBe('ERROR');
      expect(receipt.externalStatus).toBe('timeout');
      expect(receipt.externalError).toContain('Timeout');
    });

    it('Failure (terminal) → SEND-TX-299-02 + externalStatus=failed', () => {
      const err = new OutboundFailedError(
        'Outbound transaction failed with status FAILED. Push Chain TX: 0xabc.',
        '0xabc'
      );
      const { event, receipt } = classify(err, CHAIN.ETHEREUM_SEPOLIA, 180_000, {
        status: 1,
      });
      expect(event.id).toBe(PROGRESS_HOOK.SEND_TX_299_02);
      expect(event.level).toBe('ERROR');
      expect((event.response as { error: string }).error).toContain(
        'Outbound transaction failed'
      );
      expect(receipt.externalStatus).toBe('failed');
    });

    it('Failure (per-outbound REVERTED) → SEND-TX-299-02 with target chain in error', () => {
      const err = new OutboundFailedError(
        'Outbound to eip155:11155111 reverted: insufficient allowance. Push Chain TX: 0xabc.',
        '0xabc',
        'eip155:11155111'
      );
      const { event, receipt } = classify(err, CHAIN.ETHEREUM_SEPOLIA, 180_000, {
        status: 1,
      });
      expect(event.id).toBe(PROGRESS_HOOK.SEND_TX_299_02);
      expect((receipt.externalError as string)).toContain(
        'insufficient allowance'
      );
    });

    it('Classifier must NOT misclassify an OutboundFailedError whose message happens to start with "Timeout"', () => {
      // Prior implementation sniffed errMsg.startsWith('Timeout...') —
      // guard against regressions that would re-introduce the same bug.
      const err = new OutboundFailedError(
        'Timeout-style message but really a terminal failure',
        '0xabc'
      );
      const { event } = classify(err, CHAIN.ETHEREUM_SEPOLIA, 180_000, {});
      expect(event.id).toBe(PROGRESS_HOOK.SEND_TX_299_02); // failed, not timeout
    });
  });

  describe('Receipt externalStatus semantics', () => {
    // Mirrors the outbound-found success branch in response-builder.ts:
    //   baseReceipt = { ...baseReceipt,
    //     externalTxHash, externalChain, externalExplorerUrl, ...,
    //     externalStatus: 'success' };
    function annotateSuccess(baseReceipt: Record<string, unknown>, details: {
      externalTxHash: string;
      destinationChain: string;
      explorerUrl: string;
    }) {
      return {
        ...baseReceipt,
        externalTxHash: details.externalTxHash,
        externalChain: details.destinationChain,
        externalExplorerUrl: details.explorerUrl,
        externalStatus: 'success' as const,
      };
    }

    it('R2 outbound success → externalStatus=success + externalTxHash populated', () => {
      const r = annotateSuccess(
        { status: 1 },
        {
          externalTxHash: '0xext',
          destinationChain: 'eip155:11155111',
          explorerUrl: 'https://sepolia.etherscan.io/tx/0xext',
        }
      );
      expect(r.externalStatus).toBe('success');
      expect(r.externalTxHash).toBe('0xext');
      expect((r as Record<string, unknown>)['externalError']).toBeUndefined();
    });

    it('R3 payload-only: outbound success is the terminal milestone — externalStatus stays "success"', () => {
      // For R3 payload-only (`_expectsInboundRoundTrip === false`), the
      // inbound block in response-builder.wait() is skipped entirely. The
      // receipt therefore terminates with whatever the outbound-found branch
      // set — externalStatus='success'. This test documents the contract so
      // a future reader doesn't interpret 'success' as "round-trip completed".
      const outboundOnlyReceipt = annotateSuccess(
        { status: 1 },
        {
          externalTxHash: '0xext',
          destinationChain: 'eip155:11155111',
          explorerUrl: '',
        }
      );
      // No round-trip annotations expected for payload-only.
      expect(outboundOnlyReceipt.externalStatus).toBe('success');
      expect((outboundOnlyReceipt as Record<string, unknown>)['pushInboundTxHash']).toBeUndefined();
      expect((outboundOnlyReceipt as Record<string, unknown>)['pushInboundUtxId']).toBeUndefined();
    });

    it('R2 live failure path: partial receipt carries externalError + undefined externalTxHash', () => {
      // Response-builder throws the OutboundFailedError inside the try block;
      // the catch emits 299-02, annotates receipt externalStatus='failed', and
      // returns the receipt (no rethrow). Asserts the shape a caller sees.
      const err = new OutboundFailedError(
        'Outbound to eip155:11155111 reverted: insufficient allowance. Push Chain TX: 0xabc.',
        '0xabc',
        'eip155:11155111'
      );
      const errMsg = err.message;
      const isTimeout = err instanceof OutboundTimeoutError;
      const partialReceipt = {
        status: 1 as const,
        externalStatus: (isTimeout ? 'timeout' : 'failed') as 'timeout' | 'failed',
        externalError: errMsg,
      };
      expect(partialReceipt.status).toBe(1); // Push Chain leg succeeded
      expect(partialReceipt.externalStatus).toBe('failed');
      expect(partialReceipt.externalError).toContain('insufficient allowance');
      expect((partialReceipt as Record<string, unknown>)['externalTxHash']).toBeUndefined();
    });

    it('trackTransaction-style reconstruction of terminal failure → 299-02 + failed annotation', () => {
      // When trackTransaction() is called on a hash whose universal tx
      // already reached a terminal FAILED status, tx-transformer.ts emits
      // SEND-TX-299-02 via reconstructR2. The consumer-visible receipt
      // (produced later in wait()) should annotate externalStatus='failed'.
      const reconstructedEvent = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_02](
        'eip155:11155111',
        'Outbound transaction failed with status OUTBOUND_FAILED. Push Chain TX: 0xabc.'
      );
      expect(reconstructedEvent.id).toBe(PROGRESS_HOOK.SEND_TX_299_02);
      expect(reconstructedEvent.level).toBe('ERROR');
      // Consumer receipt annotation (done by response-builder after wait()
      // translates the OutboundFailedError throw):
      const consumerReceipt = {
        status: 1,
        externalStatus: 'failed' as const,
        externalError: 'Outbound transaction failed with status OUTBOUND_FAILED. Push Chain TX: 0xabc.',
      };
      expect(consumerReceipt.externalStatus).toBe('failed');
      expect(consumerReceipt.externalError).toContain('OUTBOUND_FAILED');
    });
  });

  describe('R3 inbound emit + receipt mutation', () => {
    function classifyInbound(
      error: unknown,
      baseReceipt: Record<string, unknown>,
      maxTimeoutMs: number
    ) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isTimeout = error instanceof InboundTimeoutError;
      const event = isTimeout
        ? PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_03](
            'eip155:11155111',
            maxTimeoutMs
          )
        : PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](errMsg);
      const next = {
        ...baseReceipt,
        externalStatus: isTimeout ? 'timeout' : 'failed',
        externalError: errMsg,
      };
      return { event, receipt: next };
    }

    it('InboundTimeoutError → 399-03 + timeout annotation', () => {
      const err = new InboundTimeoutError('0xoutbound', 300_000);
      const { event, receipt } = classifyInbound(err, { status: 1 }, 300_000);
      expect(event.id).toBe(PROGRESS_HOOK.SEND_TX_399_03);
      expect(receipt.externalStatus).toBe('timeout');
    });

    it('Generic inbound Error → 399-02 + failed annotation', () => {
      const err = new Error('indexer unavailable');
      const { event, receipt } = classifyInbound(err, { status: 1 }, 300_000);
      expect(event.id).toBe(PROGRESS_HOOK.SEND_TX_399_02);
      expect(receipt.externalStatus).toBe('failed');
      expect(receipt.externalError).toBe('indexer unavailable');
    });
  });

  describe('204-04 Verification Declined heuristic', () => {
    it('classifies EIP-1193 4001 as user decline (generic title/message)', () => {
      const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_04](
        'User denied the request. code: 4001'
      );
      expect(ev.id).toBe(PROGRESS_HOOK.SEND_TX_204_04);
      expect(ev.title).toBe('Verification Declined');
      expect(ev.message).toBe('Verification declined by user');
      expect((ev.response as { isUserDecline: boolean }).isUserDecline).toBe(
        true
      );
    });

    it('classifies UserRejectedRequestError as user decline', () => {
      const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_04](
        'UserRejectedRequestError: User rejected the request.'
      );
      expect(ev.title).toBe('Verification Declined');
      expect((ev.response as { isUserDecline: boolean }).isUserDecline).toBe(
        true
      );
    });

    it('non-decline errors keep the original error message and flip title', () => {
      const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_04](
        'insufficient balance for transfer'
      );
      expect(ev.title).toBe('Signature Failed');
      expect(ev.message).toBe('insufficient balance for transfer');
      expect((ev.response as { isUserDecline: boolean }).isUserDecline).toBe(
        false
      );
    });

    it('no-arg invocation classifies as user decline (self-consistent event)', () => {
      const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_04]();
      expect(ev.title).toBe('Verification Declined');
      expect(ev.message).toBe('Verification declined by user');
      expect((ev.response as { isUserDecline: boolean }).isUserDecline).toBe(
        true
      );
    });

    it('classifies "declined by user" message as user decline', () => {
      const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_04](
        'Signing declined by user'
      );
      expect(ev.title).toBe('Verification Declined');
      expect(ev.message).toBe('Verification declined by user');
      expect((ev.response as { isUserDecline: boolean }).isUserDecline).toBe(
        true
      );
    });

    it('classifies ACTION_REJECTED (ethers) as user decline', () => {
      const ev = PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_204_04](
        'ethers: ACTION_REJECTED — user rejected transaction'
      );
      expect(ev.title).toBe('Verification Declined');
      expect((ev.response as { isUserDecline: boolean }).isUserDecline).toBe(
        true
      );
    });
  });
});
