import {
  PushChainExecutionError,
  type DecodedErrorPayload,
} from '../orchestrator/internals/errors';

/**
 * Stable AGW error codes. The first groups are specified by the AGW SDK page
 * (section 3.f); the remainder are SDK-owned codes that keep unsupported or
 * unverified capabilities from being mistaken for success.
 */
export const AGENTIC_ERROR_CODE = {
  // create / rule validation (spec 3.f)
  AGENT_IS_OWNER: 'AGENT_IS_OWNER',
  DUPLICATE_RULE: 'DUPLICATE_RULE',
  TARGET_NOT_ON_RULE_CHAIN: 'TARGET_NOT_ON_RULE_CHAIN',
  ASSET_CHAIN_MISMATCH: 'ASSET_CHAIN_MISMATCH',
  // initialize with agenticWallet (spec 3.f)
  NOT_OWNER_OR_AGENT: 'NOT_OWNER_OR_AGENT',
  WALLET_NOT_DEPLOYED: 'WALLET_NOT_DEPLOYED',
  NOT_AGENTIC_WALLET: 'NOT_AGENTIC_WALLET',
  // rules.revoke (spec 3.f)
  REVOKE_NEEDS_TARGET: 'REVOKE_NEEDS_TARGET',
  // sendTransaction (spec 3.f)
  NO_RULES_FOR_CHAIN: 'NO_RULES_FOR_CHAIN',
  FROM_NOT_ALLOWED: 'FROM_NOT_ALLOWED',
  NOT_ALLOWED_IN_AGENTIC_MODE: 'NOT_ALLOWED_IN_AGENTIC_MODE',
  // SDK-owned
  INVALID_RULE: 'INVALID_RULE',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  GENERATION_UNSUPPORTED: 'GENERATION_UNSUPPORTED',
  READ_ONLY: 'READ_ONLY',
  NOT_WALLET_OWNER: 'NOT_WALLET_OWNER',
  RULE_NOT_FOUND: 'RULE_NOT_FOUND',
  RULE_READ_FAILED: 'RULE_READ_FAILED',
  INCONSISTENT_READ: 'INCONSISTENT_READ',
  INDEX_RACE: 'INDEX_RACE',
  CREATE_PARTIAL: 'CREATE_PARTIAL',
  RECEIPT_MISMATCH: 'RECEIPT_MISMATCH',
  RECEIPT_UNAVAILABLE: 'RECEIPT_UNAVAILABLE',
  AGENT_GAS_INSUFFICIENT: 'AGENT_GAS_INSUFFICIENT',
  WALLET_BALANCE_INSUFFICIENT: 'WALLET_BALANCE_INSUFFICIENT',
  GATEWAY_ALLOWANCE_INSUFFICIENT: 'GATEWAY_ALLOWANCE_INSUFFICIENT',
  RULE_LIMIT_EXCEEDED: 'RULE_LIMIT_EXCEEDED',
} as const;

export type AgenticErrorCode =
  (typeof AGENTIC_ERROR_CODE)[keyof typeof AGENTIC_ERROR_CODE];

/**
 * Pre-signature AGW failure: invalid input, unsupported capability, failed
 * eligibility or a read that cannot be trusted. Nothing was signed or sent
 * unless `details` explicitly records committed hashes (CREATE_PARTIAL).
 */
export class AgenticError extends Error {
  readonly code: AgenticErrorCode;
  readonly hint?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  override readonly cause?: unknown;

  constructor(
    code: AgenticErrorCode,
    message: string,
    opts: {
      hint?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = 'AgenticError';
    this.code = code;
    this.hint = opts.hint;
    this.details = opts.details;
    this.cause = opts.cause;
  }
}

/**
 * On-chain AGW, URP, factory or engine revert surfaced from an agentic send.
 * Extends core's structured execution error so `instanceof
 * PushChainExecutionError` keeps working, and keeps the underlying cause plus
 * any batch recovery hashes.
 */
export class AgenticRevertError extends PushChainExecutionError {
  readonly agenticCode?: string;
  readonly transactionHashes?: `0x${string}`[];
  readonly pendingTransactionHash?: `0x${string}`;

  constructor(
    message: string,
    opts: {
      decodedError?: DecodedErrorPayload;
      gatewayTxHash?: string;
      agenticCode?: string;
      transactionHashes?: `0x${string}`[];
      pendingTransactionHash?: `0x${string}`;
      cause?: unknown;
    } = {}
  ) {
    super(message, {
      decodedError: opts.decodedError,
      gatewayTxHash: opts.gatewayTxHash,
      cause: opts.cause,
    });
    this.name = 'AgenticRevertError';
    this.agenticCode = opts.agenticCode;
    this.transactionHashes = opts.transactionHashes
      ? [...opts.transactionHashes]
      : undefined;
    this.pendingTransactionHash = opts.pendingTransactionHash;
  }
}

export function capabilityUnavailable(
  capability: string,
  dependency: string,
  hint?: string
): AgenticError {
  return new AgenticError(
    AGENTIC_ERROR_CODE.CAPABILITY_UNAVAILABLE,
    `AGW capability "${capability}" is not available: ${dependency}`,
    { hint, details: { capability, dependency } }
  );
}
