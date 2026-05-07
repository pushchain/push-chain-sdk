/**
 * Typed errors for orchestrator pre-flight checks.
 *
 * `PushChainExecutionError` lives here (instead of push-chain-tx.ts) so the
 * pre-flight `InsufficientUEABalanceError` can extend it without creating a
 * circular import (preflight.ts → errors.ts → push-chain-tx.ts → context.ts
 * → … → route-handlers.ts → preflight.ts). push-chain-tx.ts re-exports it
 * for backward-compat with existing `instanceof PushChainExecutionError`
 * callers.
 */

/**
 * Structured decoded-error payload attached to terminal failure hooks
 * (199-02 / 299-02 / 399-02). Mirrors the optional formatter parameter
 * shape so the orchestrator's outer catch can lift it off the thrown
 * error and pass it straight through.
 */
export interface DecodedErrorPayload {
  name?: string;
  hint?: string;
  selector?: string;
  decoded?: string;
}

/**
 * Typed error for Route 1 Push Chain tx failures. Thrown by
 * `extractPcTxAndTransform` when the final pcTx commits with `status === 'FAILED'`,
 * and surfaced as `SEND_TX_199_02` on the live stream. The readonly `code`
 * discriminator lets callers classify via `instanceof PushChainExecutionError`
 * instead of sniffing error messages.
 *
 * Carries the origin-chain gateway tx hash. There is no successful Push Chain
 * tx to reference on this path — by definition the pcTx committed `FAILED`.
 *
 * `decodedError`: optional structured payload that flows through to terminal
 * failure hook payloads (199-02 / 299-02 / 399-02 / 999-02). Set by the
 * decoder wire-in (push-chain-tx.ts) and by InsufficientUEABalanceError so
 * consumers don't have to parse the message string.
 */
export class PushChainExecutionError extends Error {
  readonly code = 'PUSH_CHAIN_EXECUTION_FAILED' as const;
  readonly gatewayTxHash?: string;
  readonly decodedError?: DecodedErrorPayload;
  constructor(
    message: string,
    opts: { gatewayTxHash?: string; decodedError?: DecodedErrorPayload } = {}
  ) {
    super(message);
    this.name = 'PushChainExecutionError';
    this.gatewayTxHash = opts.gatewayTxHash;
    this.decodedError = opts.decodedError;
  }
}

export type PreflightPathTag =
  | 'R2_EVM'
  | 'R2_SVM'
  | 'R3_EVM'
  | 'R3_SVM'
  | 'CASCADE';

export type PreflightShortfallReason = 'NATIVE' | 'PRC20';

export interface InsufficientUEABalanceErrorOpts {
  required: bigint;
  available: bigint;
  shortfall: bigint;
  ueaAddress: `0x${string}`;
  pathTag: PreflightPathTag;
  /** 'NATIVE' = UPC shortfall; 'PRC20' = burn-token shortfall. */
  reason?: PreflightShortfallReason;
  /** Burn token address (only set when reason === 'PRC20'). */
  burnToken?: `0x${string}`;
  /** Cascade-only: zero-based index of the failing segment. */
  segmentIndex?: number;
}

/**
 * Thrown by `runPreflight` when the UEA cannot cover the required outbound
 * cost. No cosmos tx is submitted on this path — the existing silent-clamp
 * behaviour was previously submitting under-funded swaps that reverted
 * inside Uniswap with `Error("STF")`.
 */
export class InsufficientUEABalanceError extends PushChainExecutionError {
  readonly required: bigint;
  readonly available: bigint;
  readonly shortfall: bigint;
  readonly ueaAddress: `0x${string}`;
  readonly pathTag: PreflightPathTag;
  readonly reason: PreflightShortfallReason;
  readonly burnToken?: `0x${string}`;
  readonly segmentIndex?: number;

  constructor(opts: InsufficientUEABalanceErrorOpts) {
    const reason: PreflightShortfallReason = opts.reason ?? 'NATIVE';
    const segLabel =
      opts.segmentIndex !== undefined ? `:seg${opts.segmentIndex}` : '';
    const tokenSuffix =
      reason === 'PRC20' && opts.burnToken
        ? ` of token ${opts.burnToken}`
        : '';
    const currencyLabel = reason === 'PRC20' ? 'units' : 'wei UPC';
    const remediation =
      reason === 'PRC20'
        ? `Bridge the burn token to UEA on Push Chain before retrying.`
        : `Bridge >=${opts.shortfall} wei UPC to the UEA on Push Chain before retrying.`;
    const message =
      `InsufficientUEABalance [${opts.pathTag}${segLabel}:${reason}]: ` +
      `UEA ${opts.ueaAddress} has ${opts.available} ${currencyLabel}${tokenSuffix}; ` +
      `outbound requires ${opts.required} ${currencyLabel}; shortfall ${opts.shortfall} ${currencyLabel}. ` +
      remediation;
    // Lift the structured info into the parent's decodedError so the
    // orchestrator's outer catch can pass it straight through to the
    // terminal failure hook payload (299-02 / 399-02 / 999-02) without
    // parsing the message string.
    super(message, {
      decodedError: {
        name: 'InsufficientUEABalance',
        hint: remediation,
      },
    });
    this.name = 'InsufficientUEABalanceError';
    this.required = opts.required;
    this.available = opts.available;
    this.shortfall = opts.shortfall;
    this.ueaAddress = opts.ueaAddress;
    this.pathTag = opts.pathTag;
    this.reason = reason;
    this.burnToken = opts.burnToken;
    this.segmentIndex = opts.segmentIndex;
  }
}
