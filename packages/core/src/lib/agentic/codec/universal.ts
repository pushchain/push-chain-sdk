import { isAddress } from 'viem';
import { AgenticCapability, requireCapability } from '../capabilities';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { UniversalRule } from '../agentic.types';
import { argumentOffset } from './abi-layout';
import { parseSelector } from './selectors';

/** Proposed multi-asset limits (page 1 §4c) and the pinned allow-list limit. */
export const MAX_ASSETS = 8;
export const MAX_ALLOWED_CALLS = 32;

const CAIP2 = /^(eip155:[0-9]+|solana:[1-9A-HJ-NP-Za-km-z]{32,44})$/;

/**
 * Structural validation of a TARGET UniversalRule that does not depend on the
 * unresolved wire format: chain id shape, call allow-list, selector/beneficiary
 * positions. Approval policy is left to UI/marketplace (Harsh H1). Runs before the capability gate so
 * callers get precise input errors.
 */
export function validateUniversalRuleShape(rule: UniversalRule, nowSeconds: number): void {
  if (typeof rule.chainNamespace !== 'string' || !CAIP2.test(rule.chainNamespace)) {
    throw invalid(`chainNamespace "${String(rule.chainNamespace)}" is not a CAIP-2 eip155/solana chain`);
  }
  if (!Number.isInteger(rule.validUntil) || rule.validUntil <= nowSeconds) {
    throw invalid('validUntil must be a future unix timestamp in seconds');
  }
  if (!Array.isArray(rule.assets) || rule.assets.length > MAX_ASSETS) {
    throw invalid(`assets must be an array of at most ${MAX_ASSETS} caps`);
  }
  if (typeof rule.maxGasPerCall !== 'bigint' || rule.maxGasPerCall <= BigInt(0)) {
    throw invalid('maxGasPerCall must be a positive bigint (PC wei per outbound)');
  }
  if (
    !Array.isArray(rule.allowedCalls) ||
    rule.allowedCalls.length < 1 ||
    rule.allowedCalls.length > MAX_ALLOWED_CALLS
  ) {
    throw invalid(`allowedCalls must contain 1..${MAX_ALLOWED_CALLS} entries`);
  }
  const seen = new Set<string>();
  rule.allowedCalls.forEach((call, i) => {
    if (!isAddress(call.target, { strict: false })) {
      throw invalid(`allowedCalls[${i}].target is not an EVM address`);
    }
    const parsed = parseSelector(call.selector);
    if (parsed.valueOnly) throw invalid(`allowedCalls[${i}] cannot be value-only`);
    if (call.beneficiary !== undefined) {
      argumentOffset(parsed.inputs, call.beneficiary, `allowedCalls[${i}].beneficiary`);
      const t = (parsed.inputs ?? [])[call.beneficiary]?.type;
      if (t !== 'address') throw invalid(`allowedCalls[${i}].beneficiary must be an address argument`);
    }
    const key = `${call.target.toLowerCase()}:${parsed.selector}`;
    if (seen.has(key)) throw invalid(`allowedCalls[${i}] duplicates an earlier target/selector`);
    seen.add(key);
  });
  const tokens = new Set<string>();
  rule.assets.forEach((a, i) => {
    const address = typeof a.token === 'string' ? a.token : a.token?.address;
    if (typeof address !== 'string') throw invalid(`assets[${i}].token is missing an address`);
    const key = address.toLowerCase();
    if (tokens.has(key)) throw invalid(`assets[${i}] duplicates an earlier token`);
    tokens.add(key);
    if (typeof a.maxPerCall !== 'bigint' || a.maxPerCall < BigInt(0)) {
      throw invalid(`assets[${i}].maxPerCall must be a non-negative bigint`);
    }
  });
}

/**
 * Encode a target UniversalRule. NOT IMPLEMENTED: the multi-asset wire format,
 * empty-assets routing, expectedCEA width and envelope version have no
 * matching contract artifacts (A05/A07). Never falls back to the historical
 * single-asset terms.
 */
export function encodeUniversalRule(
  rule: UniversalRule,
  ctx: { capabilities: ReadonlySet<AgenticCapability>; nowSeconds: number }
): never {
  validateUniversalRuleShape(rule, ctx.nowSeconds);
  const svm = rule.chainNamespace.startsWith('solana:');
  requireCapability(
    ctx.capabilities,
    svm ? AgenticCapability.UNIVERSAL_SVM_RULES : AgenticCapability.UNIVERSAL_EVM_RULES
  );
  // A generation that advertises the capability must supply its own codec.
  throw new AgenticError(
    AGENTIC_ERROR_CODE.CAPABILITY_UNAVAILABLE,
    'no universal rule codec is implemented for this generation'
  );
}

function invalid(message: string): AgenticError {
  return new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, message);
}

