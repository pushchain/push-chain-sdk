/**
 * Read-state delegators. Thin: they bind an OrchestratorContext to the pure
 * `read-state/` module and add nothing else.
 */
import type { Address, Hex } from 'viem';
import { prepareRead as _prepareRead, simulateRead as _simulateRead, type PrepareReadDeps } from '../../read-state/spec-builder';
import type { BuildReadSpecParams, PreparedRead, SimulateReadResult } from '../../read-state/read-state.types';
import type { OrchestratorContext } from './context';
import { computeUEAOffchain } from './uea-manager';

function depsFrom(ctx: OrchestratorContext): PrepareReadDeps {
  let defaultRefundTo: Address | undefined;
  try {
    // The signer's Push-side account: its UEA for an external origin, itself on Push.
    defaultRefundTo = computeUEAOffchain(ctx);
  } catch {
    defaultRefundTo = undefined; // read-only clients without a resolvable account: refundTo becomes required
  }
  return { pushClient: ctx.pushClient, pushNetwork: ctx.pushNetwork, defaultRefundTo };
}

export function prepareRead(ctx: OrchestratorContext, params: BuildReadSpecParams): Promise<PreparedRead> {
  return _prepareRead(depsFrom(ctx), params);
}

export function simulateRead(
  ctx: OrchestratorContext,
  prepared: PreparedRead,
  opts: { appContract: Address; callbackSelector: Hex; staleAfterMs?: number },
): Promise<SimulateReadResult> {
  return _simulateRead(depsFrom(ctx), prepared, opts);
}
