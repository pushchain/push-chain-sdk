import {
  PushChainExecutionError,
  type DecodedErrorPayload,
} from '../orchestrator/internals/errors';
import { agenticUserMessage, agenticRevertUserMessage } from './error-messages';

/**
 * Stable AGW error codes. The first groups are specified by the AGW SDK page
 * (section 3.f); the remainder are SDK-owned codes that keep unsupported or
 * unverified capabilities from being mistaken for success.
 */
export const AGENTIC_ERROR_CODE = {
  // create / rule validation (spec 3.f)
  DUPLICATE_RULE: 'DUPLICATE_RULE',
  AGENT_IS_OWNER: 'AGENT_IS_OWNER',
  AMBIGUOUS_RULE: 'AMBIGUOUS_RULE',
  TARGET_NOT_ON_RULE_CHAIN: 'TARGET_NOT_ON_RULE_CHAIN',
  ASSET_CHAIN_MISMATCH: 'ASSET_CHAIN_MISMATCH',
  TOKEN_ROUTE_UNAVAILABLE: 'TOKEN_ROUTE_UNAVAILABLE',
  REQUEST_REJECTED: 'REQUEST_REJECTED',
  // initialize with agenticWallet (spec 3.f)
  NOT_OWNER_OR_AGENT: 'NOT_OWNER_OR_AGENT',
  WALLET_NOT_DEPLOYED: 'WALLET_NOT_DEPLOYED',
  NOT_AGENTIC_WALLET: 'NOT_AGENTIC_WALLET',
  // rules.delete (spec 3.f)
  DELETE_NEEDS_TARGET: 'DELETE_NEEDS_TARGET',
  // sendTransaction (spec 3.f)
  NO_RULES_FOR_CHAIN: 'NO_RULES_FOR_CHAIN',
  FROM_NOT_ALLOWED: 'FROM_NOT_ALLOWED',
  NOT_ALLOWED_IN_AGENTIC_MODE: 'NOT_ALLOWED_IN_AGENTIC_MODE',
  // SDK-owned
  INVALID_RULE: 'INVALID_RULE',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  READ_ONLY: 'READ_ONLY',
  NOT_WALLET_OWNER: 'NOT_WALLET_OWNER',
  RULE_NOT_FOUND: 'RULE_NOT_FOUND',
  RULE_READ_FAILED: 'RULE_READ_FAILED',
  INCONSISTENT_READ: 'INCONSISTENT_READ',
  INDEX_RACE: 'INDEX_RACE',
  RECEIPT_MISMATCH: 'RECEIPT_MISMATCH',
  RECEIPT_UNAVAILABLE: 'RECEIPT_UNAVAILABLE',
  AGENT_GAS_INSUFFICIENT: 'AGENT_GAS_INSUFFICIENT',
  WALLET_BALANCE_INSUFFICIENT: 'WALLET_BALANCE_INSUFFICIENT',
} as const;

export type AgenticErrorCode =
  (typeof AGENTIC_ERROR_CODE)[keyof typeof AGENTIC_ERROR_CODE];

/**
 * Pre-signature AGW failure: invalid input, unsupported capability, failed
 * eligibility or a read that cannot be trusted. Nothing was signed or sent
 * except receipt errors, which retain the submitted transaction hash.
 */
export class AgenticError extends Error {
  readonly code: AgenticErrorCode;
  /** Safe end-user copy; message/cause retain technical diagnostics. */
  readonly userMessage: string;
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
      userMessage?: string;
    } = {}
  ) {
    super(message);
    this.name = 'AgenticError';
    this.code = code;
    this.userMessage =
      opts.userMessage ?? agenticUserMessage(code, message, opts.details);
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
  readonly userMessage: string;

  constructor(
    message: string,
    opts: {
      decodedError?: DecodedErrorPayload;
      gatewayTxHash?: string;
      agenticCode?: string;
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
    this.userMessage = agenticRevertUserMessage(
      opts.decodedError?.name ?? opts.agenticCode
    );
  }
}

export function ruleConstraintLimit(
  actual: number,
  callCount: number,
  chainNamespace?: string
): AgenticError {
  const message = `This rule has ${actual} conditions. The maximum is 32. Remove duplicate functions or select fewer tokens or functions.`;
  return new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, message, {
    userMessage: message,
    hint: 'Regenerate the preset after changing selections. Do not drop individual conditions or bypass the contract limit.',
    details: {
      reason: 'RULE_CONSTRAINT_LIMIT',
      field: 'allowedCalls',
      actual,
      limit: 32,
      callCount,
      chainNamespace,
    },
  });
}

export function ruleErrorContext(
  error: unknown,
  ruleIndex: number,
  chainNamespace?: string
): unknown {
  if (!(error instanceof AgenticError)) return error;
  if (error.details?.['ruleIndex'] !== undefined) return error;
  return new AgenticError(error.code, error.message, {
    hint: error.hint,
    userMessage: `Rule ${ruleIndex + 1}: ${error.userMessage}`,
    cause: error.cause ?? error,
    details: {
      ...error.details,
      ruleIndex,
      ...(chainNamespace ? { chainNamespace } : {}),
    },
  });
}

export function tokenRouteUnavailable(
  cause: unknown,
  token: string,
  chainNamespace: string,
  assetIndex: number
): AgenticError {
  if (cause instanceof AgenticError) return cause;
  const names: Record<string, string> = {
    'eip155:1': 'Ethereum',
    'eip155:11155111': 'Ethereum Sepolia',
    'eip155:8453': 'Base',
    'eip155:84532': 'Base Sepolia',
    'eip155:42161': 'Arbitrum',
    'eip155:421614': 'Arbitrum Sepolia',
    'eip155:56': 'BNB Chain',
    'eip155:97': 'BNB Testnet',
  };
  const network =
    names[chainNamespace] ??
    (chainNamespace.startsWith('solana:')
      ? 'the selected Solana network'
      : 'the selected network');
  const message = `This token cannot be sent from Push to ${network}. Choose a supported token, or use destination funding for balances held on that network.`;
  return new AgenticError(AGENTIC_ERROR_CODE.TOKEN_ROUTE_UNAVAILABLE, message, {
    userMessage: message,
    hint: "For prefunded preset destinations, use funding: 'destination' and pass the returned rules unchanged. selectedAssets is review metadata; do not copy it back into rule.assets.",
    details: {
      token,
      chainNamespace,
      assetIndex,
      field: `assets[${assetIndex}].token`,
      funding: 'push',
    },
    cause,
  });
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
