import { EVALUATOR_ABI } from '../job/UniversalEvaluator';
import { EVALUATION_HOOK_ABI } from '../job/UniversalHook';
import { decodeErrorResult, type Hex } from 'viem';
import { AgenticError } from '../agentic/errors';
import { MARKET_ERRORS_ABI } from './contracts/UniversalMarketplaceErrors';
import { JOB_KERNEL_ABI } from './contracts/AgenticCommerce';
import { RULES_HOOK_ABI } from './contracts/RulesBindingHook';

export class MarketError extends AgenticError<string> {
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    cause?: unknown
  ) {
    super(code, message, { userMessage: message, details, cause });
    this.name = 'MarketError';
  }
}
export class JobError extends MarketError {
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    cause?: unknown
  ) {
    super(code, message, details, cause);
    this.name = 'JobError';
  }
}
export class JobSpecError extends MarketError {
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
    cause?: unknown
  ) {
    super(code, message, details, cause);
    this.name = 'JobSpecError';
  }
}
export function unavailable(feature: string): never {
  throw new MarketError(
    'CAPABILITY_UNAVAILABLE',
    `${feature} is not available in the deployed marketplace v2 stack.`,
    { feature }
  );
}
/** Inspect provider error chains without parsing human-readable revert messages. */
export function stackError(error: unknown): unknown {
  if (error instanceof AgenticError) return error;
  const seen = new Set<unknown>();
  const submitted = error as {
    txHash?: string;
    pendingTransactionHash?: string;
    gatewayTxHash?: string;
  } | null;
  const recovery = {
    ...(submitted?.txHash ? { txHash: submitted.txHash } : {}),
    ...(submitted?.pendingTransactionHash
      ? { pendingTransactionHash: submitted.pendingTransactionHash }
      : {}),
    ...(submitted?.gatewayTxHash
      ? { gatewayTxHash: submitted.gatewayTxHash }
      : {}),
  };
  function visit(value: unknown, depth: number): MarketError | undefined {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 8)
      return;
    seen.add(value);
    const o = value as Record<string, unknown>;
    if (o['code'] === 4001 || o['name'] === 'UserRejectedRequestError')
      return new MarketError(
        'REQUEST_REJECTED',
        'The wallet request was cancelled.',
        undefined,
        error
      );
    if (typeof o['data'] === 'string' && /^0x[0-9a-f]+$/i.test(o['data'])) {
      try {
        const decoded = decodeErrorResult({
          abi: [
            ...MARKET_ERRORS_ABI,
            ...JOB_KERNEL_ABI,
            ...RULES_HOOK_ABI,
            ...EVALUATOR_ABI,
            ...EVALUATION_HOOK_ABI,
          ],
          data: o['data'] as Hex,
        });
        const code = decoded.errorName
          .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
          .toUpperCase();
        return new MarketError(
          code,
          `The contract rejected the request: ${decoded.errorName}.`,
          { decodedError: decoded, ...recovery },
          error
        );
      } catch {
        /* This value is not a known stack revert; retain the provider cause. */
      }
    }
    for (const key of ['cause', 'error', 'data']) {
      const found = visit(o[key], depth + 1);
      if (found) return found;
    }
    return;
  }
  return visit(error, 0) ?? error;
}
