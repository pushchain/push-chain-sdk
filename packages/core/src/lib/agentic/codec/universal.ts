import { getAddress, isAddress, type Address } from 'viem';
import { AgenticCapability, requireCapability } from '../capabilities';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { UniversalRule } from '../agentic.types';
import type { RuleEncodeContext, PreparedRule } from './rules';
import { argumentOffset, rawOffset } from './abi-layout';
import { parseSelector } from './selectors';
import { AGENTIC_DEFAULTS, UINT256_MAX, withDefault } from './defaults';
import { buildSession, encodeEnvelope } from './session';
import { SEND_OUTBOUND_SELECTOR } from '../contracts/v4';
import {
  encodeUniversalTerms,
  type AssetCapWire,
  type UniversalTermsWire,
} from './universal-terms';

export const MAX_ASSETS = 8;
export const MAX_ALLOWED_CALLS = 32;
export interface ResolvedUniversalRule {
  expectedCEA: Address;
  assets: readonly AssetCapWire[];
}

const CAIP2 = /^(eip155:[0-9]+|solana:[1-9A-HJ-NP-Za-km-z]{32,44})$/;
const UINT48_MAX = 2 ** 48 - 1;
function cap(value: unknown, what: string): asserts value is bigint {
  if (typeof value !== 'bigint' || value < BigInt(0) || value > UINT256_MAX)
    throw invalid(`${what} must be a uint256 bigint`);
}
export function validateUniversalRuleShape(
  rule: UniversalRule,
  nowSeconds: number
): void {
  if (
    typeof rule.chainNamespace !== 'string' ||
    !CAIP2.test(rule.chainNamespace)
  )
    throw invalid('chainNamespace must be a CAIP-2 eip155/solana chain');
  if (
    !Number.isSafeInteger(rule.validUntil) ||
    rule.validUntil <= nowSeconds ||
    rule.validUntil > UINT48_MAX
  )
    throw invalid('validUntil must be a future uint48 unix timestamp');
  if (!Array.isArray(rule.assets) || rule.assets.length > MAX_ASSETS)
    throw invalid(`assets must be an array of at most ${MAX_ASSETS} caps`);
  cap(rule.maxGasPerCall, 'maxGasPerCall');
  if (rule.maxGasPerCall === BigInt(0))
    throw invalid('maxGasPerCall must be positive');
  if (
    !Array.isArray(rule.allowedCalls) ||
    rule.allowedCalls.length < 1 ||
    rule.allowedCalls.length > MAX_ALLOWED_CALLS
  )
    throw invalid(`allowedCalls must contain 1..${MAX_ALLOWED_CALLS} entries`);
  const seen = new Set<string>();
  rule.allowedCalls.forEach((call, i) => {
    if (!isAddress(call.target, { strict: false }))
      throw invalid(`allowedCalls[${i}].target is not an EVM address`);
    const parsed = parseSelector(call.selector);
    if (parsed.valueOnly)
      throw invalid(`allowedCalls[${i}] cannot be value-only`);
    if (call.beneficiary !== undefined && call.beneficiaryOffset !== undefined)
      throw invalid('beneficiary and beneficiaryOffset are mutually exclusive');
    if (call.beneficiary !== undefined) {
      argumentOffset(
        parsed.inputs,
        call.beneficiary,
        `allowedCalls[${i}].beneficiary`
      );
      if (parsed.inputs?.[call.beneficiary]?.type !== 'address')
        throw invalid(
          `allowedCalls[${i}].beneficiary must be an address argument`
        );
    }
    if (call.beneficiaryOffset !== undefined)
      rawOffset(call.beneficiaryOffset, `allowedCalls[${i}].beneficiary`);
    cap(
      call.maxValue ?? AGENTIC_DEFAULTS.universal.allowedCallMaxValue.value,
      `allowedCalls[${i}].maxValue`
    );
    const key = `${call.target.toLowerCase()}:${parsed.selector}`;
    if (seen.has(key))
      throw invalid(`allowedCalls[${i}] duplicates an earlier target/selector`);
    seen.add(key);
  });
  const tokens = new Set<string>();
  rule.assets.forEach((a, i) => {
    const address = typeof a.token === 'string' ? a.token : a.token?.address;
    if (typeof address !== 'string')
      throw invalid(`assets[${i}].token is missing an address`);
    const key = address.toLowerCase();
    if (tokens.has(key))
      throw invalid(`assets[${i}] duplicates an earlier token`);
    tokens.add(key);
    cap(a.maxPerCall, `assets[${i}].maxPerCall`);
    cap(
      withDefault(a.maxTotal, AGENTIC_DEFAULTS.universal.assetMaxTotal),
      `assets[${i}].maxTotal`
    );
  });
}

export function encodeUniversalRule(
  rule: UniversalRule,
  ctx: RuleEncodeContext
): PreparedRule {
  if (rule.chainNamespace.startsWith('solana:'))
    requireCapability(ctx.capabilities, AgenticCapability.UNIVERSAL_SVM_RULES);
  validateUniversalRuleShape(rule, ctx.nowSeconds);
  requireCapability(
    ctx.capabilities,
    rule.chainNamespace.startsWith('solana:')
      ? AgenticCapability.UNIVERSAL_SVM_RULES
      : AgenticCapability.UNIVERSAL_EVM_RULES
  );
  const resolved = ctx.universal?.get(rule);
  if (!resolved || !ctx.gateway)
    throw invalid(
      'universal encoding requires resolved wallet CEA, PRC20 assets and gateway context'
    );
  if (
    resolved.assets.length < 1 ||
    resolved.assets.length > MAX_ASSETS ||
    new Set(resolved.assets.map((a) => a.token.toLowerCase())).size !==
      resolved.assets.length
  )
    throw invalid('resolved assets must be 1..8 distinct PRC20s');
  if (
    !isAddress(resolved.expectedCEA) ||
    /^0x0{40}$/i.test(resolved.expectedCEA)
  )
    throw invalid('expectedCEA must be a non-zero wallet destination account');
  const terms: UniversalTermsWire = {
    validUntil: rule.validUntil,
    expectedCEA: getAddress(resolved.expectedCEA),
    assets: resolved.assets,
    maxGasPerCall: rule.maxGasPerCall,
    allowedCalls: rule.allowedCalls.map((call) => ({
      target: getAddress(call.target),
      selector: parseSelector(call.selector).selector,
      hasBeneficiary:
        call.beneficiary !== undefined || call.beneficiaryOffset !== undefined,
      beneficiaryOffset:
        call.beneficiaryOffset ??
        (call.beneficiary === undefined
          ? 0
          : argumentOffset(
              parseSelector(call.selector).inputs,
              call.beneficiary,
              'beneficiary'
            )),
      maxValue: withDefault(
        call.maxValue,
        AGENTIC_DEFAULTS.universal.allowedCallMaxValue
      ),
    })),
  };
  const agent = getAddress(rule.agent);
  return {
    rule,
    agent,
    chainNamespace: rule.chainNamespace,
    universalTerms: terms,
    session: buildSession({
      validator: ctx.validator,
      agent,
      rulesPolicy: ctx.rulesPolicy,
      actions: [
        {
          target: ctx.gateway,
          selector: SEND_OUTBOUND_SELECTOR,
          initData: encodeEnvelope(
            rule.chainNamespace,
            encodeUniversalTerms(terms)
          ),
        },
      ],
    }),
  };
}

/** Source token addresses must be resolved from each PRC20 before calling this. */
export function universalTermsToRule(
  terms: UniversalTermsWire,
  agent: Address,
  chainNamespace: UniversalRule['chainNamespace'],
  tokens: readonly Address[]
): UniversalRule {
  if (tokens.length !== terms.assets.length)
    throw invalid('origin-token list does not match stored asset order');
  return {
    agent,
    chainNamespace,
    validUntil: Number(terms.validUntil),
    maxGasPerCall: terms.maxGasPerCall,
    assets: terms.assets.map((a, i) => ({
      token: tokens[i],
      maxPerCall: a.maxPerCall,
      maxTotal: a.maxTotal,
    })),
    allowedCalls: terms.allowedCalls.map((c) => ({
      target: c.target,
      selector: c.selector,
      maxValue: c.maxValue,
      ...(c.hasBeneficiary
        ? { beneficiaryOffset: Number(c.beneficiaryOffset) }
        : {}),
    })),
  };
}
function invalid(message: string): AgenticError {
  return new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, message);
}
