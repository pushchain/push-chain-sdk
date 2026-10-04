import {
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  isAddress,
  isHex,
  type AbiParameter,
  type Address,
  type Hex,
} from 'viem';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { AgenticHex, NativeRule } from '../agentic.types';
import { argumentOffset, encodeArgWord, rawOffset } from './abi-layout';
import { AGENTIC_DEFAULTS, UINT256_MAX, withDefault } from './defaults';
import { parseSelector, VALUE_ONLY_SELECTOR, type ParsedSelector } from './selectors';

/** URP native limits at e704d5b (Types.sol MAX_PINS, AGW MAX_NATIVE_ACTIONS). */
export const MAX_PINS = 8;
const UINT32_MAX = 2 ** 32 - 1;
const UINT48_MAX = 2 ** 48 - 1;

/** NativeTerms (Types.sol:354-363 at e704d5b). */
export interface NativeTermsWire {
  validUntil: number;
  target: Address;
  selector: Hex;
  maxValuePerCall: bigint;
  maxValueTotal: bigint;
  amount: { enabled: boolean; offset: number; maxPerCall: bigint; maxTotal: bigint };
  maxCalls: number;
  pins: readonly { offset: number; expected: Hex }[];
}

export const NATIVE_TERMS_PARAM: AbiParameter = {
  type: 'tuple',
  components: [
    { name: 'validUntil', type: 'uint48' },
    { name: 'target', type: 'address' },
    { name: 'selector', type: 'bytes4' },
    { name: 'maxValuePerCall', type: 'uint256' },
    { name: 'maxValueTotal', type: 'uint256' },
    {
      name: 'amount',
      type: 'tuple',
      components: [
        { name: 'enabled', type: 'bool' },
        { name: 'offset', type: 'uint16' },
        { name: 'maxPerCall', type: 'uint256' },
        { name: 'maxTotal', type: 'uint256' },
      ],
    },
    { name: 'maxCalls', type: 'uint32' },
    {
      name: 'pins',
      type: 'tuple[]',
      components: [
        { name: 'offset', type: 'uint16' },
        { name: 'expected', type: 'bytes32' },
      ],
    },
  ],
};

function invalid(message: string, details?: Record<string, unknown>): AgenticError {
  return new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, message, { details });
}

function assertUint(value: bigint, bits: number, field: string): void {
  if (typeof value !== 'bigint' || value < BigInt(0) || value >= BigInt(2) ** BigInt(bits)) {
    throw invalid(`${field} must be a uint${bits} bigint`);
  }
}

export interface NativeEncodeContext {
  /** Current unix time in seconds; grants with validUntil <= now are rejected. */
  nowSeconds: number;
}

/** Normalize and validate a public NativeRule into wire terms. Pure. */
export function nativeRuleToTerms(
  rule: NativeRule,
  ctx: NativeEncodeContext
): { terms: NativeTermsWire; parsed: ParsedSelector } {
  if (!isAddress(rule.target, { strict: false }) || /^0x0{40}$/i.test(rule.target)) {
    throw invalid('native rule target must be a non-zero address');
  }
  if (
    !Number.isInteger(rule.validUntil) ||
    rule.validUntil <= ctx.nowSeconds ||
    rule.validUntil > UINT48_MAX
  ) {
    throw invalid('validUntil must be a future unix timestamp in seconds (uint48)', {
      validUntil: rule.validUntil,
    });
  }
  const parsed = parseSelector(rule.selector);
  const pinsIn = rule.pins ?? [];
  if (parsed.valueOnly && (pinsIn.length > 0 || rule.amount)) {
    throw invalid('a value-only rule cannot carry pins or an amount rule');
  }
  if (pinsIn.length > MAX_PINS) {
    throw invalid(`at most ${MAX_PINS} pins are allowed`, { pins: pinsIn.length });
  }

  const pins = pinsIn.map((p, i) => {
    if ('offset' in p) {
      if (typeof p.expected !== 'string' || !isHex(p.expected) || p.expected.length !== 66) {
        throw invalid(`pins[${i}].expected must be the exact 32-byte calldata word in offset form`);
      }
      return { offset: rawOffset(p.offset, `pins[${i}]`), expected: p.expected.toLowerCase() as Hex };
    }
    const offset = argumentOffset(parsed.inputs, p.arg, `pins[${i}]`);
    const param = (parsed.inputs as readonly AbiParameter[])[p.arg];
    return { offset, expected: encodeArgWord(param, p.expected, `pins[${i}]`) };
  });
  const offsets = new Set(pins.map((p) => p.offset));
  if (offsets.size !== pins.length) throw invalid('two pins address the same argument');

  let amount: NativeTermsWire['amount'] = {
    enabled: false,
    offset: 0,
    maxPerCall: BigInt(0),
    maxTotal: BigInt(0),
  };
  if (rule.amount) {
    let offset: number;
    if ('offset' in rule.amount) {
      offset = rawOffset(rule.amount.offset, 'amount');
    } else {
      offset = argumentOffset(parsed.inputs, rule.amount.arg, 'amount');
      const param = (parsed.inputs as readonly AbiParameter[])[rule.amount.arg];
      if (!/^uint\d*$/.test(param.type)) {
        throw invalid(`amount argument must be an unsigned integer, got ${param.type}`);
      }
    }
    if (offsets.has(offset)) throw invalid('amount argument is also pinned');
    assertUint(rule.amount.maxPerCall, 256, 'amount.maxPerCall');
    const maxTotal = withDefault(rule.amount.maxTotal, AGENTIC_DEFAULTS.native.amountMaxTotal);
    assertUint(maxTotal, 256, 'amount.maxTotal');
    amount = { enabled: true, offset, maxPerCall: rule.amount.maxPerCall, maxTotal };
  }

  const maxValuePerCall = withDefault(rule.maxValuePerCall, AGENTIC_DEFAULTS.native.maxValuePerCall);
  const maxValueTotal = withDefault(rule.maxValueTotal, AGENTIC_DEFAULTS.native.maxValueTotal);
  assertUint(maxValuePerCall, 256, 'maxValuePerCall');
  assertUint(maxValueTotal, 256, 'maxValueTotal');
  const maxCalls =
    rule.maxCalls === undefined ? Number(AGENTIC_DEFAULTS.native.maxCalls.value) : rule.maxCalls;
  if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > UINT32_MAX) {
    throw invalid('maxCalls must be a uint32 integer');
  }

  return {
    parsed,
    terms: {
      validUntil: rule.validUntil,
      target: getAddress(rule.target),
      selector: parsed.selector,
      maxValuePerCall,
      maxValueTotal,
      amount,
      maxCalls,
      pins,
    },
  };
}

export function encodeNativeTerms(terms: NativeTermsWire): Hex {
  return encodeAbiParameters([NATIVE_TERMS_PARAM], [terms]);
}

export function decodeNativeTerms(body: Hex): NativeTermsWire {
  const [terms] = decodeAbiParameters([NATIVE_TERMS_PARAM], body);
  return terms as unknown as NativeTermsWire;
}

/**
 * Wire terms back to the public NativeRule shape. Stored terms carry calldata
 * offsets and exact words but no ABI, so pins and amount are returned in the
 * raw `offset` form (never a guessed argument index) and `selector` is the
 * 4-byte hex. The result re-encodes to the same terms.
 */
export function nativeTermsToRule(terms: NativeTermsWire, agent: Address, ref: AgenticHex): NativeRule {
  const rule: NativeRule = {
    agent: getAddress(agent),
    target: getAddress(terms.target),
    selector:
      terms.selector.toLowerCase() === VALUE_ONLY_SELECTOR
        ? 'value-only'
        : (terms.selector.toLowerCase() as AgenticHex),
    validUntil: Number(terms.validUntil),
    maxValuePerCall: terms.maxValuePerCall,
    maxValueTotal: terms.maxValueTotal,
    maxCalls: Number(terms.maxCalls),
  };
  if (!/^0x0{64}$/i.test(ref)) rule.ref = ref;
  if (terms.pins.length > 0) {
    rule.pins = terms.pins.map((p) => ({
      offset: Number(p.offset),
      expected: p.expected.toLowerCase() as AgenticHex,
    }));
  }
  if (terms.amount.enabled) {
    rule.amount = {
      offset: Number(terms.amount.offset),
      maxPerCall: terms.amount.maxPerCall,
      maxTotal: terms.amount.maxTotal,
    };
  }
  return rule;
}

export function isUnlimited(value: bigint): boolean {
  return value === UINT256_MAX;
}
