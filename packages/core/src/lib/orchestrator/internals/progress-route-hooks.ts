/**
 * Per-route progress hook builders for the outbound polling phase
 * (.wait() in response-builder.ts and per-hop loops in cascade.waitForAll).
 *
 * Splitting this out gives both call sites a single source of truth for
 * which IDs fire on each route, so cascade hops and single-tx outbound
 * stay in lockstep.
 */

import type { OutboundTxDetails } from '../orchestrator.types';
import type { ProgressEvent } from '../../progress-hook/progress-hook.types';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import { TransactionRoute } from '../route-detector';

export type WaitHookSet = {
  intermediatePushOk?: (chain: string, pushTxHash: string) => ProgressEvent;
  awaiting: (chain: string) => ProgressEvent;
  polling: (chain: string, elapsedMs: number) => ProgressEvent;
  success: (details: OutboundTxDetails) => ProgressEvent;
  timeout: (chain: string, elapsedMs: number) => ProgressEvent;
  failed: (chain: string, errMsg: string) => ProgressEvent;
};

export function pickWaitHooks(
  route: TransactionRoute | string | undefined
): WaitHookSet {
  if (route === TransactionRoute.UOA_TO_CEA) {
    return {
      intermediatePushOk: (chain, txHash) =>
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_99](chain, txHash),
      awaiting: (chain) => PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_209_01](chain),
      polling: (chain, elapsed) =>
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_209_02](chain, elapsed),
      success: (details) =>
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_01](details),
      timeout: (chain, elapsed) =>
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_03](chain, elapsed),
      failed: (chain, msg) =>
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_02](chain, msg),
    };
  }
  if (route === TransactionRoute.CEA_TO_PUSH) {
    return {
      intermediatePushOk: (_chain, txHash) =>
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_99_99](txHash),
      awaiting: (chain) => PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_309_01](chain),
      polling: (chain, elapsed) =>
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_309_02](chain, elapsed),
      // For R3, the outbound-poll "success" is the source-chain CEA executing
      // (309-03 INFO). Terminal 399-01 fires after the inbound-to-Push poll
      // (handled by waitForInboundPushTx in response-builder).
      success: (details) =>
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_309_03](
          details.destinationChain,
          details.externalTxHash
        ),
      // R3 outbound (source-chain CEA) failures share the 399-02/03 IDs with
      // R3 inbound; pass phase='outbound' so the title reflects the source
      // chain instead of "Push Chain Inbound …".
      timeout: (chain, elapsed) =>
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_03](chain, elapsed, 'outbound'),
      failed: (chain, msg) =>
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](msg, 'outbound', chain),
    };
  }
  // Route 4 (CEA_TO_CEA) has no spec'd ID range yet; cascade hops and
  // trackTransaction of pre-existing R4 UTXs still flow through here. Return
  // a no-op set so wait() / cascade progress without emitting progress
  // events for R4. When R4 gets its own ID range, add a branch above.
  return NOOP_WAIT_HOOKS;
}

/** Sentinel event returned by NOOP_WAIT_HOOKS. Emission sites can detect
 * and skip it by id === '' if they want to suppress no-op events. */
const NOOP_EVENT: ProgressEvent = Object.freeze({
  id: '',
  title: '',
  message: '',
  level: 'INFO',
  response: null,
  timestamp: '',
});

const NOOP_WAIT_HOOKS: WaitHookSet = Object.freeze({
  awaiting: () => NOOP_EVENT,
  polling: () => NOOP_EVENT,
  success: () => NOOP_EVENT,
  timeout: () => NOOP_EVENT,
  failed: () => NOOP_EVENT,
}) as WaitHookSet;

/** True when the hook set is the no-op placeholder (route has no spec'd
 * ID range). Emission sites should skip firing and receipt-mutation blocks. */
export function isNoopHookSet(hooks: WaitHookSet): boolean {
  return hooks === NOOP_WAIT_HOOKS;
}
