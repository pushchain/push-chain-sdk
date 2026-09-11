/**
 * Typed read-state errors.
 *
 * Every error carries a stable `code` so callers classify by `instanceof` or
 * `err.code`, plus curated context and a remediation hint. Mirrors the PC20 error
 * family (`orchestrator/internals/pc20/errors.ts`).
 */

export type ReadStateErrorContext = {
  /** Destination in CAIP-2 form, when relevant. */
  destination?: string;
  /** requestId (0x-prefixed hex), when relevant. */
  requestId?: string;
  /** Push tx hash, when relevant. */
  txHash?: string;
  /** Successfully mined requests from a partial non-atomic batch. */
  transactionHashes?: `0x${string}`[];
  /** Broadcast transaction whose receipt could not be confirmed. Check before retrying. */
  pendingTransactionHash?: `0x${string}`;
  /** Short, actionable remediation. */
  hint?: string;
};

/** Base class for all read-state failures. `instanceof ReadStateError` catches the family. */
export class ReadStateError extends Error {
  readonly code: string;
  readonly destination?: string;
  readonly requestId?: string;
  readonly txHash?: string;
  readonly transactionHashes?: `0x${string}`[];
  readonly pendingTransactionHash?: `0x${string}`;
  readonly hint?: string;

  constructor(code: string, message: string, ctx: ReadStateErrorContext = {}) {
    const parts = [message];
    if (ctx.destination) parts.push(`destination=${ctx.destination}`);
    if (ctx.requestId) parts.push(`requestId=${ctx.requestId}`);
    if (ctx.txHash) parts.push(`txHash=${ctx.txHash}`);
    if (ctx.hint) parts.push(`hint: ${ctx.hint}`);
    super(parts.join(' | '));
    this.name = new.target.name;
    this.code = code;
    this.destination = ctx.destination;
    this.requestId = ctx.requestId;
    this.txHash = ctx.txHash;
    this.transactionHashes = ctx.transactionHashes ? [...ctx.transactionHashes] : undefined;
    this.pendingTransactionHash = ctx.pendingTransactionHash;
    this.hint = ctx.hint;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The query itself is malformed (bad target, non-view ABI function, too many extracts, …). */
export class InvalidReadQueryError extends ReadStateError {
  constructor(message: string, ctx: ReadStateErrorContext = {}) {
    super('INVALID_READ_QUERY', message, ctx);
  }
}

/** Every contract precondition the SDK mirrors client-side. Names match `UniversalCallbackErrors`. */
export type ReadSpecViolation =
  | 'INVALID_ACCOUNT_ID'
  | 'EMPTY_QUERY'
  | 'INVALID_MIN_CONFIRMATIONS'
  | 'DOMAIN_BLOCKED'
  | 'INVALID_BLOCK_NUMBER'
  | 'INVALID_EXPIRY_HEIGHT'
  | 'ZERO_REVERT_RECIPIENT'
  | 'ZERO_CALLBACK_GAS_LIMIT'
  | 'CALLBACK_GAS_LIMIT_EXCEEDED'
  | 'INSUFFICIENT_FEE'
  | 'EXCESSIVE_FEE'
  | 'ZERO_CALLBACK_BUDGET'
  /** Node affordability gate: remaining escrow must cover declared gas at current base fee. */
  | 'INSUFFICIENT_CALLBACK_BUDGET'
  | 'SVM_OWNER_NOT_32_BYTES';

/** A `ReadSpec` that `requestExternalReadSelf` would revert on. */
export class InvalidReadSpecError extends ReadStateError {
  readonly violations: readonly ReadSpecViolation[];
  constructor(violations: readonly ReadSpecViolation[], ctx: ReadStateErrorContext = {}) {
    super('INVALID_READ_SPEC', `ReadSpec violates contract preconditions: ${violations.join(', ')}`, ctx);
    this.violations = violations;
  }
}

/** The destination's oracle height is zero — it is not a configured chain. */
export class ReadHeightUnavailableError extends ReadStateError {
  constructor(destination: string, ctx: ReadStateErrorContext = {}) {
    super('READ_HEIGHT_UNAVAILABLE', 'destination has no observed chain height on UniversalCore', {
      destination,
      hint: 'Only chains with a running chain-meta oracle can be read. Check the CAIP-2 id.',
      ...ctx,
    });
  }
}

/** Destination is not one the read path can route (unknown namespace, or on-chain blacklist). */
export class UnsupportedReadDestinationError extends ReadStateError {
  constructor(message: string, ctx: ReadStateErrorContext = {}) {
    super('UNSUPPORTED_READ_DESTINATION', message, ctx);
  }
}

/** `resultData` does not match the shape the query declared. Fails loud, never mis-decodes. */
export class ReadDecodeError extends ReadStateError {
  constructor(message: string, ctx: ReadStateErrorContext = {}) {
    super('READ_DECODE_FAILED', message, ctx);
  }
}

/** Client-side polling deadline hit before a terminal status. Carries the last status seen. */
export class ReadTimeoutError extends ReadStateError {
  readonly lastStatus: number;
  constructor(lastStatus: number, elapsedMs: number, ctx: ReadStateErrorContext = {}) {
    super('READ_TIMEOUT', `read did not reach a terminal status within ${elapsedMs} ms (last status ${lastStatus})`, {
      hint: 'The request may still complete on-chain — resume with trackRead.',
      ...ctx,
    });
    this.lastStatus = lastStatus;
  }
}

/** No `UniversalRead` record for the reference — not ingested yet, or the tx made no read. */
export class ReadNotFoundError extends ReadStateError {
  constructor(ref: string, ctx: ReadStateErrorContext = {}) {
    super('READ_NOT_FOUND', `no read record for ${ref}`, {
      hint: 'A request is indexed once its block is processed; a tx with no ReadRequested log never gets one.',
      ...ctx,
    });
  }
}

/** No custom receiver was supplied and the canonical registry is not deployed yet. */
export class ReadRegistryUnavailableError extends ReadStateError {
  constructor(method: string, ctx: ReadStateErrorContext = {}) {
    super('READ_REGISTRY_UNAVAILABLE', `${method} needs the UniversalReadRegistry, which is not deployed on this network`, {
      hint: 'Pass callback.target and callback.request (abi, functionName, optional args) for your app contract.',
      ...ctx,
    });
  }
}
