import {
  parseAbiItem,
  toFunctionSelector,
  type AbiFunction,
  type AbiParameter,
} from 'viem';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { AgenticHex, Selector } from '../agentic.types';

/** Selector URP uses for a value-only native rule (empty calldata). */
export const VALUE_ONLY_SELECTOR = '0xffffffff' as const;

export interface ParsedSelector {
  /** 4-byte selector, lowercase. */
  selector: AgenticHex;
  /** Canonical signature when the caller supplied one. */
  signature?: string;
  /** ABI inputs, only available when the caller supplied a signature. */
  inputs?: readonly AbiParameter[];
  valueOnly: boolean;
}

const HEX_SELECTOR = /^0x[0-9a-fA-F]{8}$/;

/**
 * Parse a public selector (`'0x617ba037'`, `'supply(address,uint256,address,uint16)'`
 * or `'value-only'`). A signature is required wherever pins, amounts or
 * beneficiaries need argument positions; a bare hex selector carries none.
 */
export function parseSelector(input: Selector | 'value-only'): ParsedSelector {
  if (input === 'value-only') {
    return { selector: VALUE_ONLY_SELECTOR, valueOnly: true };
  }
  if (typeof input !== 'string') {
    throw invalid(`selector must be a string, got ${typeof input}`);
  }
  if (HEX_SELECTOR.test(input)) {
    const selector = input.toLowerCase() as AgenticHex;
    if (selector === VALUE_ONLY_SELECTOR) {
      return { selector, valueOnly: true };
    }
    return { selector, valueOnly: false };
  }
  let item: AbiFunction;
  try {
    const parsed = parseAbiItem(`function ${input}`);
    if (parsed.type !== 'function') throw new Error('not a function');
    item = parsed;
  } catch (cause) {
    throw invalid(
      `selector "${input}" is neither a 4-byte hex selector nor a function signature`,
      cause
    );
  }
  const selector = toFunctionSelector(item).toLowerCase() as AgenticHex;
  if (selector === VALUE_ONLY_SELECTOR) {
    throw invalid(`selector "${input}" collides with the reserved value-only selector`);
  }
  return {
    selector,
    signature: `${item.name}(${item.inputs.map(canonicalType).join(',')})`,
    inputs: item.inputs,
    valueOnly: false,
  };
}

function canonicalType(p: AbiParameter): string {
  if (p.type.startsWith('tuple')) {
    const components = (p as { components?: readonly AbiParameter[] }).components ?? [];
    return `(${components.map(canonicalType).join(',')})${p.type.slice(5)}`;
  }
  return p.type;
}

function invalid(message: string, cause?: unknown): AgenticError {
  return new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, message, { cause });
}
