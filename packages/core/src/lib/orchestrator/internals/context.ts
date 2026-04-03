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
import { CHAIN_INFO } from '../../constants/chain';
import { EvmClient } from '../../vm-client/evm-client';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';

export interface OrchestratorContext {
  readonly pushClient: PushClient;
  readonly universalSigner: UniversalSigner;
  readonly pushNetwork: PUSH_NETWORK;
  readonly rpcUrls: Partial<Record<CHAIN, string[]>>;
  readonly printTraces: boolean;
  progressHook?: (progress: ProgressEvent) => void;

  // Mutable caches (mutated in-place by submodules)
  ueaVersionCache?: string;
  accountStatusCache: AccountStatus | null;
  /** Cached origin chain EvmClient — avoids creating new clients per call site */
  _originEvmClient?: EvmClient;
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
 * Fires a progress hook event by ID, forwarding args to the hook factory.
 */
export function fireProgressHook(
  ctx: OrchestratorContext,
  hookId: string,
  ...args: any[]
): void {
  const hookEntry = PROGRESS_HOOKS[hookId];
  const hookPayload: ProgressEvent = hookEntry(...args);
  printLog(ctx, hookPayload.message);

  if (ctx.progressHook) {
    ctx.progressHook(hookPayload);
  }
}
