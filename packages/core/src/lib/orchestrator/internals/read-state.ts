/**
 * Read-state delegators. Thin: they bind an OrchestratorContext to the pure
 * `read-state/` module and add nothing else.
 */
import type { Address, Hex } from 'viem';
import { prepareRead as _prepareRead, simulateRead as _simulateRead, type PrepareReadDeps } from '../../read-state/spec-builder';
import { trackRead as _trackRead, type TrackReadDeps } from '../../read-state/read-tracker';
import type {
  BuildReadSpecParams,
  PreparedRead,
  ReadLifecycleOptions,
  SimulateReadResult,
  UniversalReadResponse,
} from '../../read-state/read-state.types';
import { fireProgressHook, type OrchestratorContext } from './context';
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

function trackDepsFrom(ctx: OrchestratorContext): TrackReadDeps {
  return {
    pushClient: ctx.pushClient,
    pushNetwork: ctx.pushNetwork,
    // READ-TX ids are a separate band: fireProgressHook never suppresses them (context.ts R1 set).
    emit: (hookId, ...args) => fireProgressHook(ctx, hookId, ...args),
  };
}

export function trackRead(ctx: OrchestratorContext, ref: { txHash: Hex }, opts?: ReadLifecycleOptions): Promise<UniversalReadResponse[]>;
export function trackRead(ctx: OrchestratorContext, ref: { requestId: Hex | bigint }, opts?: ReadLifecycleOptions): Promise<UniversalReadResponse>;
export function trackRead(
  ctx: OrchestratorContext,
  ref: { txHash: Hex } | { requestId: Hex | bigint },
  opts?: ReadLifecycleOptions,
): Promise<UniversalReadResponse | UniversalReadResponse[]> {
  return 'txHash' in ref ? _trackRead(trackDepsFrom(ctx), ref, opts) : _trackRead(trackDepsFrom(ctx), ref, opts);
}
