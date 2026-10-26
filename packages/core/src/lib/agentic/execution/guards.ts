import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';

/** Methods the spec forbids on an agentic client (spec 2.a). */
export type ForbiddenAgenticMethod =
  | 'prepareTransaction'
  | 'executeTransactions'
  | 'migrateCEA'
  | 'rescueFunds'
  | 'payGasWith';

export function notAllowedInAgenticMode(method: ForbiddenAgenticMethod | string): AgenticError {
  return new AgenticError(
    AGENTIC_ERROR_CODE.NOT_ALLOWED_IN_AGENTIC_MODE,
    `${method} is not available on a client initialized with agenticWallet`,
    {
      hint:
        method === 'prepareTransaction' || method === 'executeTransactions'
          ? 'Use sendTransaction; cascades would run from the signer, not the wallet.'
          : 'Use a client initialized without agenticWallet for signer-level operations.',
    }
  );
}

/**
 * Reject inputs that would execute from somewhere other than the wallet, or
 * that agentic mode does not support, before any signature or RPC call.
 */
export function guardAgenticSendParams(params: unknown): void {
  if (!params || typeof params !== 'object') {
    throw new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, 'sendTransaction needs a transaction object');
  }
  const p = params as {
    from?: unknown;
    payGasWith?: unknown;
    migration?: unknown;
  };
  if (p.from !== undefined && p.from !== null) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.FROM_NOT_ALLOWED,
      '`from` (Routes 3 and 4) is not allowed in agenticWallet mode',
      { hint: 'A CEA-originated call makes msg.sender a CEA, so the wallet door check would fail.' }
    );
  }
  if (p.payGasWith !== undefined) throw notAllowedInAgenticMode('payGasWith');
  if (p.migration) throw notAllowedInAgenticMode('migrateCEA');
}
