import { isAddress, size, type Hex } from 'viem';
import { MAX_CALLBACK_GAS_LIMIT, MIN_CONFIRMATIONS_FLOOR, READ_NAMESPACE } from '../constants/read-state';
import { InvalidReadSpecError, type ReadSpecViolation } from './errors';
import type { ReadPreflight, ReadSpec } from './read-state.types';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const UINT16_MAX = 65_535;
const UINT64_MAX = (1n << 64n) - 1n;

export interface ValidateReadSpecInput {
  spec: ReadSpec;
  /** msg.value the request will carry. */
  value: bigint;
  callbackGasLimit: bigint;
  /** When present, the height / expiry / fee rules that need chain state are checked too. */
  preflight?: ReadPreflight;
}

/**
 * Client-side mirror of every revert in `UniversalCallback.requestExternalReadSelf`
 * (feat-read-state f8d1a0c), plus two SDK invariants, so a developer gets a typed
 * violation list instead of an opaque revert. Line numbers refer to the contract.
 */
export function validateReadSpec(input: ValidateReadSpecInput): { ok: true } | { ok: false; violations: ReadSpecViolation[] } {
  const { spec, value, callbackGasLimit, preflight } = input;
  const v: ReadSpecViolation[] = [];

  // :98-103 InvalidAccountId — every account field non-empty
  const ownerLen = isHexLike(spec.account.owner) ? size(spec.account.owner) : 0;
  if (!spec.account.chainNamespace || !spec.account.chainId || ownerLen === 0) v.push('INVALID_ACCOUNT_ID');

  // :104-106 EmptyQuery
  if (!isHexLike(spec.query) || size(spec.query) === 0) v.push('EMPTY_QUERY');

  // :107-109 InvalidMinConfirmations (uint16)
  if (!Number.isInteger(spec.minConfirmations) || spec.minConfirmations < MIN_CONFIRMATIONS_FLOOR || spec.minConfirmations > UINT16_MAX) {
    v.push('INVALID_MIN_CONFIRMATIONS');
  }

  // :113-134 InvalidBlockNumber — heightless: must be 0; else 1..oracleHeight
  if (spec.blockNumber < 0n || spec.blockNumber > UINT64_MAX) {
    v.push('INVALID_BLOCK_NUMBER');
  } else if (preflight) {
    const h = preflight.observedChainHeight;
    const bad = h === 0n ? spec.blockNumber !== 0n : spec.blockNumber === 0n || spec.blockNumber > h;
    if (bad) v.push('INVALID_BLOCK_NUMBER');
  }

  // :119-121 InvalidExpiryHeight — strictly in the future
  if (spec.expiryPushChainHeight < 0n || spec.expiryPushChainHeight > UINT64_MAX) {
    v.push('INVALID_EXPIRY_HEIGHT');
  } else if (preflight && spec.expiryPushChainHeight <= preflight.pushBlockNumber) {
    v.push('INVALID_EXPIRY_HEIGHT');
  }

  // :122-124 ZeroRevertRecipient
  if (!isAddress(spec.revertRecipient) || spec.revertRecipient.toLowerCase() === ZERO_ADDRESS) v.push('ZERO_REVERT_RECIPIENT');

  // :125-130 ZeroCallbackGasLimit / CallbackGasLimitExceeded
  if (callbackGasLimit <= 0n) v.push('ZERO_CALLBACK_GAS_LIMIT');
  else if (callbackGasLimit > MAX_CALLBACK_GAS_LIMIT) v.push('CALLBACK_GAS_LIMIT_EXCEEDED');

  // :132-139 InsufficientFee / ExcessiveFee
  if (preflight && value < preflight.protocolFee) v.push('INSUFFICIENT_FEE');
  if (value > spec.maxFee) v.push('EXCESSIVE_FEE');

  // SDK invariant (not a contract revert): a zero budget is never fulfilled by the node.
  if (preflight && value - preflight.protocolFee <= 0n) v.push('ZERO_CALLBACK_BUDGET');

  // SDM invariant from svm/read_executor.go:29-32 — validators hard-reject any other length.
  if (spec.account.chainNamespace === READ_NAMESPACE.SVM && ownerLen !== 32) v.push('SVM_OWNER_NOT_32_BYTES');

  return v.length === 0 ? { ok: true } : { ok: false, violations: v };
}

export function assertValidReadSpec(input: ValidateReadSpecInput): void {
  const r = validateReadSpec(input);
  if (!r.ok) {
    throw new InvalidReadSpecError(r.violations, {
      destination: `${input.spec.account.chainNamespace}:${input.spec.account.chainId}`,
      hint: 'See ReadSpecViolation names — each mirrors a UniversalCallback revert.',
    });
  }
}

function isHexLike(x: unknown): x is Hex {
  return typeof x === 'string' && /^0x[0-9a-fA-F]*$/.test(x);
}
