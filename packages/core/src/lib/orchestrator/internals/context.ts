/**
 * Shared context for orchestrator submodules.
 *
 * Instead of passing `this` or 5+ parameters to every extracted function,
 * submodules receive this context object. The Orchestrator class implements
 * this interface and passes itself.
 */

import type { PushClient } from '../../push-client/push-client';
import type { UniversalSigner } from '../../universal/universal.types';
import type { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import type { ProgressEvent } from '../../progress-hook/progress-hook.types';
import type { AccountStatus } from '../orchestrator.types';
import { TransactionRoute } from '../route-detector';
import { CHAIN_INFO } from '../../constants/chain';
import { EvmClient } from '../../vm-client/evm-client';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';

export interface OrchestratorContext {
  readonly pushClient: PushClient;
  readonly universalSigner: UniversalSigner;
  readonly pushNetwork: PUSH_NETWORK;
  readonly rpcUrls: Partial<Record<CHAIN, string[]>>;
  readonly printTraces: boolean;
  progressHook?: (progress: ProgressEvent) => void;

  /**
   * The transaction route currently being executed. Set by
   * `Orchestrator.execute()` and `Orchestrator.trackTransaction()` before any
   * submodule fires progress hooks, so route-aware emission code can pick the
   * correct ID range (101 / 201 / 301). Undefined when no transaction is in
   * flight (e.g. during account-status reads).
   */
  currentRoute?: TransactionRoute;

  // Mutable caches (mutated in-place by submodules)
  ueaVersionCache?: string;
  accountStatusCache: AccountStatus | null;
  /** Cached origin chain EvmClient — avoids creating new clients per call site */
  _originEvmClient?: EvmClient;

  /**
   * Set to `true` by inner route handlers after they emit a terminal-ish
   * error hook (104-04 / 204-04 / 304-04 / 199-02 via execute-standard).
   * Checked by `Orchestrator.execute()`'s outer catch so it doesn't fire a
   * second terminal (199-02 / 299-02 / 399-02) on top of the inner one.
   * Reset to `false` at the start of each `execute()` call.
   */
  _routeTerminalEmitted?: boolean;
}

/**
 * Returns (and caches) an EvmClient for the signer's origin chain.
 * Avoids creating new EvmClient instances in lockFee, confirmation, fetchOriginTx, etc.
 */
export function getOriginEvmClient(ctx: OrchestratorContext): EvmClient {
  if (!ctx._originEvmClient) {
    const chain = ctx.universalSigner.account.chain;
    const { defaultRPC } = CHAIN_INFO[chain];
    const rpcUrls = ctx.rpcUrls[chain] || defaultRPC;
    ctx._originEvmClient = new EvmClient({ rpcUrls });
  }
  return ctx._originEvmClient;
}

/**
 * Logs a message to console when printTraces is enabled.
 */
export function printLog(ctx: OrchestratorContext, msg: string): void {
  if (ctx.printTraces) {
    console.log(`[Orchestrator] ${msg}`);
  }
}

/**
 * IDs in the Route 1 range (101–199 + the funds/payload sub-IDs). When the
 * orchestrator is executing a non-R1 route, these IDs are suppressed at the
 * fire boundary so emission code in the inner R1 execute pipeline doesn't
 * leak Route 1 events into a Route 2/3/4 progress stream. The route-specific
 * IDs (201/207/299, 301/307/399, etc.) are emitted explicitly by the route
 * handlers and by `wait()` in response-builder.ts.
 *
 * Exceptions kept in the stream regardless of route:
 *   - All UEA migration hooks.
 *
 * Separately, the intermediate Push-success markers 199-99-99 (R3) and
 * 299-99 (R2) are suppressed at `fanOut` in response-builder.ts — they're
 * internal transition signals, not consumer-facing spec events.
 */
const R1_SUPPRESSED_IN_NON_R1: ReadonlySet<string> = new Set([
  PROGRESS_HOOK.SEND_TX_101,
  PROGRESS_HOOK.SEND_TX_102_01,
  PROGRESS_HOOK.SEND_TX_103_01,
  PROGRESS_HOOK.SEND_TX_103_02,
  PROGRESS_HOOK.SEND_TX_103_03,
  PROGRESS_HOOK.SEND_TX_103_03_01,
  PROGRESS_HOOK.SEND_TX_103_03_02,
  PROGRESS_HOOK.SEND_TX_103_03_03,
  PROGRESS_HOOK.SEND_TX_103_03_04,
  PROGRESS_HOOK.SEND_TX_104_01,
  PROGRESS_HOOK.SEND_TX_104_02,
  PROGRESS_HOOK.SEND_TX_104_03,
  PROGRESS_HOOK.SEND_TX_104_04,
  PROGRESS_HOOK.SEND_TX_105_01,
  PROGRESS_HOOK.SEND_TX_105_02,
  PROGRESS_HOOK.SEND_TX_106_01,
  PROGRESS_HOOK.SEND_TX_106_02,
  PROGRESS_HOOK.SEND_TX_106_03,
  PROGRESS_HOOK.SEND_TX_106_03_01,
  PROGRESS_HOOK.SEND_TX_106_03_02,
  PROGRESS_HOOK.SEND_TX_106_04,
  PROGRESS_HOOK.SEND_TX_106_05,
  PROGRESS_HOOK.SEND_TX_106_06,
  PROGRESS_HOOK.SEND_TX_107,
  PROGRESS_HOOK.SEND_TX_199_01,
  PROGRESS_HOOK.SEND_TX_199_02,
]);

function isR1Route(route: TransactionRoute | undefined): boolean {
  return route === undefined || route === TransactionRoute.UOA_TO_PUSH;
}

/**
 * Fires a progress hook event by ID, forwarding args to the hook factory.
 *
 * Suppresses Route 1 IDs when the active route is not R1 — the inner R1
 * execute pipeline still calls fireProgressHook for events like 101 / 107 /
 * 199_01, but those describe a Push-perspective view that doesn't match the
 * R2/R3/R4 lifecycle the consumer is observing. Route handlers emit the
 * route-specific IDs (201/207/301/307/etc.) explicitly.
 */
export function fireProgressHook(
  ctx: OrchestratorContext,
  hookId: string,
  ...args: any[]
): void {
  if (
    !isR1Route(ctx.currentRoute) &&
    R1_SUPPRESSED_IN_NON_R1.has(hookId)
  ) {
    return;
  }

  const hookEntry = PROGRESS_HOOKS[hookId];
  const hookPayload: ProgressEvent = hookEntry(...args);
  printLog(ctx, hookPayload.message);

  if (ctx.progressHook) {
    ctx.progressHook(hookPayload);
  }
}
