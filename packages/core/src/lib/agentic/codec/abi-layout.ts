import {
  decodeAbiParameters,
  encodeAbiParameters,
  isAddress,
  isHex,
  type AbiParameter,
} from 'viem';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { AgenticHex } from '../agentic.types';

/**
 * ABI head layout for argument-position terms (native pins/amount, universal
 * beneficiary). Contracts take ABSOLUTE byte offsets into calldata with the
 * 4-byte selector included and read exactly one 32-byte word there, so only a
 * single-word static elementary argument can be addressed. Preceding
 * arguments may be dynamic (one head word: the offset pointer) or static
 * tuples / fixed arrays (several head words); both are accounted for here.
 */

const UINT16_MAX = 0xffff;

function components(p: AbiParameter): readonly AbiParameter[] {
  return (p as { components?: readonly AbiParameter[] }).components ?? [];
}

/** Parse a trailing fixed/dynamic array suffix: 'uint256[3]' → base 'uint256', length 3. */
function arraySuffix(
  type: string
): { base: string; length: number | null } | null {
  const m = /^(.*)\[(\d*)\]$/.exec(type);
  if (!m) return null;
  return { base: m[1], length: m[2] === '' ? null : Number(m[2]) };
}

export function isDynamic(p: AbiParameter): boolean {
  const arr = arraySuffix(p.type);
  if (arr) {
    if (arr.length === null) return true;
    return isDynamic({ ...p, type: arr.base } as AbiParameter);
  }
  if (p.type === 'bytes' || p.type === 'string') return true;
  if (p.type === 'tuple') return components(p).some(isDynamic);
  return false;
}

/** Bytes this parameter occupies in the head of an encoding. */
export function headSize(p: AbiParameter): number {
  if (isDynamic(p)) return 32;
  const arr = arraySuffix(p.type);
  if (arr && arr.length !== null) {
    return arr.length * headSize({ ...p, type: arr.base } as AbiParameter);
  }
  if (p.type === 'tuple') {
    return components(p).reduce((sum, c) => sum + headSize(c), 0);
  }
  return 32;
}

const ELEMENTARY =
  /^(address|bool|u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?|bytes([1-9]|[12][0-9]|3[0-2]))$/;

export function isSingleWordStatic(p: AbiParameter): boolean {
  return ELEMENTARY.test(p.type);
}

/**
 * Absolute calldata byte offset (selector included) of argument `arg`.
 * Rejects out-of-range indexes and any argument that is not one static word.
 */
export function argumentOffset(
  inputs: readonly AbiParameter[] | undefined,
  arg: number,
  what: string
): number {
  if (!inputs) {
    throw invalid(
      `${what} needs the function signature (e.g. 'supply(address,uint256,address,uint16)'), not a bare 4-byte selector`
    );
  }
  if (!Number.isInteger(arg) || arg < 0 || arg >= inputs.length) {
    throw invalid(
      `${what} argument index ${arg} is out of range (0..${inputs.length - 1})`
    );
  }
  const target = inputs[arg];
  if (!isSingleWordStatic(target)) {
    throw invalid(
      `${what} argument ${arg} has type ${target.type}; only single-word static arguments can be pinned`
    );
  }
  let offset = 4;
  for (let i = 0; i < arg; i++) offset += headSize(inputs[i]);
  if (offset + 32 > UINT16_MAX) {
    throw invalid(
      `${what} argument ${arg} lies beyond the uint16 offset range`
    );
  }
  return offset;
}

/** Encode a pin's expected value as the exact 32-byte calldata word. */
export function encodeArgWord(
  param: AbiParameter,
  expected: AgenticHex | bigint | string | boolean,
  what: string
): AgenticHex {
  try {
    const isWord =
      typeof expected === 'string' && isHex(expected) && expected.length === 66;
    if (param.type === 'address' && !isWord) {
      if (
        typeof expected !== 'string' ||
        !isAddress(expected, { strict: false })
      ) {
        throw new Error('expected an address');
      }
    } else if (param.type.startsWith('bytes') && !isWord) {
      if (typeof expected !== 'string' || !isHex(expected))
        throw new Error('expected hex');
    }
    // An already-encoded 32-byte word (as decoded rules return) is accepted
    // when it is a canonical encoding of this argument type.
    if (
      typeof expected === 'string' &&
      isHex(expected) &&
      expected.length === 66 &&
      param.type !== 'bytes32'
    ) {
      const [value] = decodeAbiParameters([param], expected as AgenticHex);
      if (
        encodeAbiParameters([param], [value]).toLowerCase() !==
        expected.toLowerCase()
      ) {
        throw new Error('word is not a canonical encoding');
      }
      return expected.toLowerCase() as AgenticHex;
    }
    return encodeAbiParameters([param], [expected]) as AgenticHex;
  } catch (cause) {
    throw invalid(
      `${what} expected value does not encode as ${param.type}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      cause
    );
  }
}

/** Validate a raw calldata offset given directly (offset form). */
export function rawOffset(offset: number, what: string): number {
  if (!Number.isInteger(offset) || offset < 4 || offset + 32 > UINT16_MAX) {
    throw invalid(
      `${what} offset ${offset} must be an integer in [4, ${
        UINT16_MAX - 32
      }] (selector included)`
    );
  }
  return offset;
}

function invalid(message: string, cause?: unknown): AgenticError {
  return new AgenticError(AGENTIC_ERROR_CODE.INVALID_RULE, message, { cause });
}

/** Absolute location of a scalar reached through static tuple/fixed-array indexes. */
export function argumentLocation(
  inputs: readonly AbiParameter[] | undefined,
  arg: number | readonly number[],
  what: string
): { offset: number; param: AbiParameter } {
  if (!inputs) throw invalid(`${what} paths require a full function signature`);
  const path = typeof arg === 'number' ? [arg] : arg;
  if (
    !Array.isArray(path) ||
    path.length === 0 ||
    path.length > 16 ||
    path.some((i) => !Number.isSafeInteger(i) || i < 0)
  )
    throw invalid(`${what} has an invalid argument path`);
  if (path[0] >= inputs.length)
    throw invalid(`${what} argument path is out of range`);
  let offset =
    4 + inputs.slice(0, path[0]).reduce((n, p) => n + headSize(p), 0);
  let param = inputs[path[0]];
  for (const index of path.slice(1)) {
    if (isDynamic(param))
      throw invalid(`${what} cannot descend into a dynamic argument`);
    const arr = arraySuffix(param.type);
    if (arr && arr.length !== null) {
      if (!Number.isSafeInteger(arr.length) || index >= arr.length)
        throw invalid(`${what} fixed-array index is out of range`);
      const child = { ...param, type: arr.base } as AbiParameter;
      offset += index * headSize(child);
      param = child;
    } else if (param.type === 'tuple') {
      const fields = components(param);
      if (index >= fields.length)
        throw invalid(`${what} tuple index is out of range`);
      offset += fields.slice(0, index).reduce((n, p) => n + headSize(p), 0);
      param = fields[index];
    } else throw invalid(`${what} path descends into a scalar`);
  }
  if (
    !isSingleWordStatic(param) ||
    !Number.isSafeInteger(offset) ||
    offset + 32 > UINT16_MAX
  )
    throw invalid(
      `${what} must identify one static ABI word within the uint16 offset range`
    );
  return { offset, param };
}
