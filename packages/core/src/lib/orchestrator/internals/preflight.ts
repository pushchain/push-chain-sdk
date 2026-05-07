/**
 * Shared pre-flight balance check for all six outbound paths
 * (R2 EVM, R2 SVM, R3 EVM, R3 SVM, Cascade EVM, Cascade SVM).
 *
 * Today the route handlers silently clamp `nativeValueForGas` down to a
 * value the UEA cannot fully cover, then submit anyway. The under-funded
 * swap reverts inside Uniswap V3's `TransferHelper.safeTransferFrom`
 * with `Error("STF")`, fees are burned, and the user sees an opaque
 * library string with no balance signal.
 *
 * `runPreflight` replaces that branch: it checks the **pre-clamp**
 * buffered pool quote against UEA balance (and optionally a PRC-20 burn
 * balance) and either:
 *   - emits `SEND-TX-203-03` (INFO, sufficient) and lets the caller proceed; or
 *   - emits `SEND-TX-203-03` (ERROR, insufficient) + `SEND-TX-203-04` and
 *     throws `InsufficientUEABalanceError`.
 *
 * The helper is intentionally not "pure" — it emits hooks and may throw.
 * Callers fetch all balances (so the helper itself does no I/O).
 */

import type { OrchestratorContext } from './context';
import { fireProgressHook, printLog } from './context';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import {
  InsufficientUEABalanceError,
  type PreflightPathTag,
} from './errors';

export interface RunPreflightOpts {
  ctx: OrchestratorContext;
  ueaAddress: `0x${string}`;
  /** Effective UEA balance in wei UPC (already includes fresh-wallet prediction). */
  ueaBalance: bigint;
  /** Buffered pool quote (pre-clamp) — what the SDK would actually attempt. */
  requiredValue: bigint;
  /** Reserve covering outer-tx gas + approve(s). */
  gasReserve: bigint;
  pathTag: PreflightPathTag;
  /** Optional: PRC-20 burn token + amount + on-chain UEA balance. */
  burnToken?: `0x${string}`;
  burnAmount?: bigint;
  prc20Balance?: bigint;
  /** Cascade-only: identifies which segment failed. */
  segmentIndex?: number;
  /**
   * Per-call opt-out (`params.options.allowUnderfundedSwap`). When `true`,
   * pre-flight logs the shortfall but does NOT fire 203-04 or throw —
   * caller can fall back to the legacy clamp-and-refund branch.
   */
  allowUnderfundedSwap?: boolean;
}

export type PreflightResult =
  | {
      ok: true;
      /** What `nativeValueForGas` should be (== requiredValue when sufficient). */
      adjustedValue: bigint;
    }
  | {
      ok: false;
      /** Set when allowUnderfundedSwap=true: the legacy clamped value. */
      legacyClampedValue: bigint;
    };

/**
 * Internal: compute the legacy clamp value (matches the pre-existing
 * branches in route-handlers.ts:643-659 / :968-980 / :1396-1412).
 * Returned only when `allowUnderfundedSwap=true`.
 */
function legacyClamp(
  ueaBalance: bigint,
  requiredValue: bigint,
  gasReserve: bigint
): bigint {
  if (ueaBalance >= requiredValue + gasReserve) return requiredValue;
  if (ueaBalance > gasReserve) return ueaBalance - gasReserve;
  if (ueaBalance > BigInt(0))
    return ueaBalance < requiredValue ? ueaBalance : requiredValue;
  return BigInt(0);
}

/**
 * Pre-flight check. PRC-20 balance is checked before the native check —
 * a missing burn token fails before the gas-balance check, so the user
 * sees the actionable PRC-20 shortfall instead of a stale UPC error.
 *
 * Returns a result object instead of throwing for the legacy opt-out
 * path. The throw happens here (not in the caller) for the default
 * `allowUnderfundedSwap=false` case so all 6 paths share one throw site.
 */
export function runPreflight(opts: RunPreflightOpts): PreflightResult {
  const {
    ctx,
    ueaAddress,
    ueaBalance,
    requiredValue,
    gasReserve,
    pathTag,
    burnToken,
    burnAmount,
    prc20Balance,
    segmentIndex,
    allowUnderfundedSwap,
  } = opts;

  // Each route bucket gets its own preflight IDs so hook streams stay
  // self-consistent within their convention (R2 → 203-xx, R3 → 303-xx,
  // cascade → 003-xx). The three hook formatters share an identical
  // signature, so the runtime branching is just an ID swap at each fire site.
  const isCascade = pathTag === 'CASCADE';
  const isR3 = pathTag === 'R3_EVM' || pathTag === 'R3_SVM';
  const HOOK_PRE_INFO = isCascade
    ? PROGRESS_HOOK.SEND_TX_003_03
    : isR3
      ? PROGRESS_HOOK.SEND_TX_303_04
      : PROGRESS_HOOK.SEND_TX_203_03;
  const HOOK_PRE_FAIL = isCascade
    ? PROGRESS_HOOK.SEND_TX_003_04
    : isR3
      ? PROGRESS_HOOK.SEND_TX_303_05
      : PROGRESS_HOOK.SEND_TX_203_04;

  // 1. PRC-20 burn-balance check (skipped when burnAmount = 0 — R3 paths
  //    structurally hold zero of the source-chain native PRC-20; see plan §9 #4).
  if (burnAmount && burnAmount > BigInt(0) && burnToken) {
    const onHand = prc20Balance ?? BigInt(0);
    const sufficient = onHand >= burnAmount;
    fireProgressHook(
      ctx,
      HOOK_PRE_INFO,
      burnAmount,
      onHand,
      sufficient,
      ueaAddress,
      pathTag,
      { kind: 'PRC20', burnToken, segmentIndex }
    );
    if (!sufficient) {
      const shortfall = burnAmount - onHand;
      if (allowUnderfundedSwap) {
        printLog(
          ctx,
          `[preflight ${pathTag}] PRC-20 shortfall ${shortfall} of ${burnToken}; ` +
            `allowUnderfundedSwap=true — proceeding with legacy clamp behaviour, ` +
            `swap is expected to revert with InsufficientBalance(0xf4d678b8) on-chain.`
        );
        return {
          ok: false,
          legacyClampedValue: legacyClamp(ueaBalance, requiredValue, gasReserve),
        };
      }
      fireProgressHook(
        ctx,
        HOOK_PRE_FAIL,
        burnAmount,
        onHand,
        shortfall,
        ueaAddress,
        pathTag,
        { kind: 'PRC20', burnToken, segmentIndex }
      );
      throw new InsufficientUEABalanceError({
        required: burnAmount,
        available: onHand,
        shortfall,
        ueaAddress,
        pathTag,
        reason: 'PRC20',
        burnToken,
        segmentIndex,
      });
    }
  }

  // 2. Native (UPC) balance check.
  const totalRequired = requiredValue + gasReserve;
  const sufficient = ueaBalance >= totalRequired;
  fireProgressHook(
    ctx,
    HOOK_PRE_INFO,
    totalRequired,
    ueaBalance,
    sufficient,
    ueaAddress,
    pathTag,
    { kind: 'NATIVE', segmentIndex }
  );
  if (sufficient) {
    return { ok: true, adjustedValue: requiredValue };
  }

  const shortfall = totalRequired - ueaBalance;
  if (allowUnderfundedSwap) {
    const clamped = legacyClamp(ueaBalance, requiredValue, gasReserve);
    printLog(
      ctx,
      `[preflight ${pathTag}] UPC shortfall ${shortfall} wei; ` +
        `allowUnderfundedSwap=true — proceeding with legacy clamped value ${clamped}, ` +
        `swap may revert inside Uniswap with Error("STF") if the clamp under-funds the pool quote.`
    );
    return { ok: false, legacyClampedValue: clamped };
  }

  fireProgressHook(
    ctx,
    HOOK_PRE_FAIL,
    totalRequired,
    ueaBalance,
    shortfall,
    ueaAddress,
    pathTag,
    { kind: 'NATIVE', segmentIndex }
  );
  throw new InsufficientUEABalanceError({
    required: totalRequired,
    available: ueaBalance,
    shortfall,
    ueaAddress,
    pathTag,
    reason: 'NATIVE',
    segmentIndex,
  });
}

/**
 * SVM-only telemetry threshold. Buffered pool quotes above this value
 * fire `SEND-TX-203-05` (R2 single-route), `SEND-TX-303-06` (R3
 * single-route), or `SEND-TX-003-05` (cascade). The threshold is for
 * visibility, not truncation — pre-flight handles drain protection.
 * v2 may add a hard cap once telemetry justifies a number.
 */
export const SVM_NATIVE_VALUE_WARN_THRESHOLD = BigInt(5000) * BigInt(1e18);

/**
 * Fire the SVM warn-threshold hook + log line if the buffered quote
 * exceeds the threshold. Non-blocking; `nativeValueForGas` is not
 * truncated by the caller. The hook ID switches between buckets so
 * each stream stays self-consistent within its convention (R2 → 203,
 * R3 → 303, cascade → 003).
 */
export function maybeFireSvmWarnThreshold(
  ctx: OrchestratorContext,
  bufferedQuote: bigint,
  gasToken: `0x${string}`,
  pathTag: PreflightPathTag
): void {
  if (bufferedQuote <= SVM_NATIVE_VALUE_WARN_THRESHOLD) return;
  const HOOK_WARN =
    pathTag === 'CASCADE'
      ? PROGRESS_HOOK.SEND_TX_003_05
      : pathTag === 'R3_EVM' || pathTag === 'R3_SVM'
        ? PROGRESS_HOOK.SEND_TX_303_06
        : PROGRESS_HOOK.SEND_TX_203_05;
  fireProgressHook(
    ctx,
    HOOK_WARN,
    bufferedQuote,
    SVM_NATIVE_VALUE_WARN_THRESHOLD,
    gasToken,
    pathTag
  );
  printLog(
    ctx,
    `[preflight ${pathTag}] SVM warn-threshold tripped: bufferedQuote=${bufferedQuote} > ` +
      `${SVM_NATIVE_VALUE_WARN_THRESHOLD} for gasToken=${gasToken} — pool may be skewed`
  );
}
