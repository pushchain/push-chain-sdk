import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  isHex,
  toFunctionSelector,
  zeroAddress,
  type AbiFunction,
  type AbiParameter,
  type Hex,
} from 'viem';
import { argumentLocation } from '../agentic/codec/abi-layout';
import { JobSpecError } from '../market/errors';
import type {
  JobFill,
  PrepareJobReadOptions,
  PreparedJobRead,
  ExecuteJobReadOptions,
} from './types';
import type { ReadOptions } from '../read-state/read-params';
import type { CHAIN } from '../constants/enums';

const labels = new WeakMap<
  PreparedJobRead,
  {
    selector: Hex;
    outputs: Hex;
    target: string;
    name: string;
    parameters: readonly AbiParameter[];
  }
>();
export function inheritReadLabel(
  source: PreparedJobRead,
  target: PreparedJobRead
): void {
  const value = labels.get(source);
  if (
    value &&
    value.selector === source.selector &&
    value.outputs === source.outputs &&
    value.target === source.target.toLowerCase()
  )
    labels.set(target, value);
}
export function jobReadLabel(read: PreparedJobRead): string | undefined {
  const value = labels.get(read);
  return value &&
    value.selector === read.selector &&
    value.outputs === read.outputs &&
    value.target === read.target.toLowerCase()
    ? value.name
    : undefined;
}
/** Same logical call as a JobSpec read, through the normal paid universal-read path. */
export function jobReadOptions(
  read: PreparedJobRead,
  options: ExecuteJobReadOptions = {}
): ReadOptions {
  validateJobRead(read);
  if (read.fills?.length)
    throw new JobSpecError(
      'UNFILLED_PLACEHOLDER',
      'Resolve WALLET/PARAM holes before sending a prepared read.'
    );
  return {
    ...options,
    chain: `${read.chainNamespace}:${read.chainId}` as Extract<
      CHAIN,
      `eip155:${string}`
    >,
    callData: (read.selector + read.args.slice(2)) as Hex,
  };
}

export function outputTypes(params: readonly AbiParameter[]): Hex {
  function type(p: AbiParameter, depth: number): number[] {
    if (depth > 16)
      throw new JobSpecError('INVALID_READ', 'Output type nesting exceeds 16.');
    const a = /^(.*)\[(\d*)\]$/.exec(p.type);
    if (a) {
      const base = { ...p, type: a[1] } as AbiParameter;
      if (!a[2]) return [9, ...type(base, depth + 1)];
      const n = Number(a[2]);
      if (n < 1 || n > 255)
        throw new JobSpecError(
          'INVALID_READ',
          'Fixed output arrays must contain 1..255 elements.'
        );
      return [10, n, ...type(base, depth + 1)];
    }
    if (p.type === 'tuple')
      return tuple(
        (p as { components: readonly AbiParameter[] }).components,
        depth + 1
      );
    if (/^uint(\d+)?$/.test(p.type)) return [1];
    if (/^int(\d+)?$/.test(p.type)) return [2];
    if (p.type === 'bool') return [3];
    if (p.type === 'address') return [4];
    if (/^bytes([1-9]|[12]\d|3[0-2])$/.test(p.type)) return [5];
    if (p.type === 'bytes') return [6];
    if (p.type === 'string') return [7];
    throw new JobSpecError('INVALID_READ', `Unsupported ABI output ${p.type}.`);
  }
  function tuple(items: readonly AbiParameter[], depth: number): number[] {
    if (items.length < 1 || items.length > 255)
      throw new JobSpecError(
        'INVALID_READ',
        'An output tuple needs 1..255 fields.'
      );
    return [8, items.length, ...items.flatMap((p) => type(p, depth))];
  }
  return ('0x' +
    tuple(params, 0)
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')) as Hex;
}

/** Pure ABI preparation, independent of read fees, RPCs and the request preflight. */
export function prepareJobRead(
  options: PrepareJobReadOptions
): PreparedJobRead {
  try {
    if (!/^eip155:[1-9]\d*$/.test(options.chain))
      throw new JobSpecError(
        'CHAIN_UNSUPPORTED',
        'JobSpec reads currently support EVM chain identifiers only.'
      );
    const candidates = options.abi.filter(
      (x): x is AbiFunction =>
        x.type === 'function' &&
        x.name === options.functionName &&
        x.inputs.length === (options.args?.length ?? 0)
    );
    if (candidates.length !== 1)
      throw new JobSpecError(
        'INVALID_READ',
        'Select one exact function ABI for this read, including overloaded functions.'
      );
    const fn = candidates[0];
    if (!['view', 'pure'].includes(fn.stateMutability))
      throw new JobSpecError(
        'INVALID_READ',
        'A JobSpec read must use a view or pure function.'
      );
    const fills: JobFill[] = [];
    const lower = (
      p: AbiParameter,
      value: unknown,
      indices: number[],
      depth: number
    ): unknown => {
      if (depth > 16)
        throw new JobSpecError(
          'INVALID_READ',
          'Read arguments are nested too deeply.'
        );
      const marker = value === 'agentic:wallet';
      const param =
        value && typeof value === 'object' && 'param' in value
          ? (value as { param: unknown }).param
          : undefined;
      if (marker || param !== undefined) {
        if (marker && p.type !== 'address')
          throw new JobSpecError(
            'INVALID_READ',
            'WALLET read arguments must be addresses.'
          );
        if (!marker && !/^u?int(\d+)?$/.test(p.type))
          throw new JobSpecError(
            'INVALID_READ',
            'PARAM read arguments must be static integers.'
          );
        if (
          !marker &&
          (!Number.isInteger(param) || Number(param) < 0 || Number(param) > 255)
        )
          throw new JobSpecError(
            'INVALID_READ',
            'Invalid template parameter index.'
          );
        const word =
          (argumentLocation(fn.inputs, indices, 'Read placeholder').offset -
            4) /
          32;
        if (word > 255)
          throw new JobSpecError(
            'INVALID_READ',
            'Read placeholder is outside the uint8 word range.'
          );
        fills.push({
          word,
          source: marker ? 'WALLET' : 'PARAM',
          ...(!marker ? { param: Number(param) } : {}),
        });
        return marker ? zeroAddress : BigInt(0);
      }
      const a = /^(.*)\[(\d*)\]$/.exec(p.type);
      if (a) {
        if (!Array.isArray(value))
          throw new JobSpecError(
            'INVALID_READ',
            'Array argument must be an array.'
          );
        return value.map((v, i) =>
          lower(
            { ...p, type: a[1] } as AbiParameter,
            v,
            [...indices, i],
            depth + 1
          )
        );
      }
      if (p.type === 'tuple') {
        const fields = (p as { components: readonly AbiParameter[] })
          .components;
        return fields.map((field, i) =>
          lower(
            field,
            Array.isArray(value)
              ? value[i]
              : (value as Record<string, unknown>)?.[field.name ?? ''],
            [...indices, i],
            depth + 1
          )
        );
      }
      return value;
    };
    const values = fn.inputs.map((p, i) => lower(p, options.args?.[i], [i], 0));
    const [chainNamespace, chainId] = options.chain.split(':');
    const prepared = {
      chainNamespace,
      chainId,
      target: getAddress(options.target),
      selector: toFunctionSelector(fn),
      args: encodeAbiParameters(fn.inputs, values),
      outputs: outputTypes(fn.outputs),
      ...(fills.length ? { fills } : {}),
    };
    labels.set(prepared, {
      selector: prepared.selector,
      outputs: prepared.outputs,
      target: prepared.target.toLowerCase(),
      name: fn.name,
      parameters: fn.outputs,
    });
    return prepared;
  } catch (cause) {
    if (cause instanceof JobSpecError) throw cause;
    throw new JobSpecError(
      'INVALID_READ',
      'The read arguments or ABI are invalid.',
      undefined,
      cause
    );
  }
}

export interface OutputNode {
  code: number;
  children: OutputNode[];
  size?: number;
}
export function parseOutputs(outputs: Hex): OutputNode {
  if (!isHex(outputs) || outputs.length % 2 !== 0 || outputs.length > 8194)
    throw new JobSpecError('INVALID_READ', 'Invalid output type layout.');
  const bytes =
    outputs
      .slice(2)
      .match(/../g)
      ?.map((x) => parseInt(x, 16)) ?? [];
  let pos = 0;
  function read(depth: number): OutputNode {
    if (depth > 16 || pos >= bytes.length)
      throw new JobSpecError('INVALID_READ', 'Invalid output type layout.');
    const code = bytes[pos++];
    const n: OutputNode = { code, children: [] };
    if (code === 8 || code === 10) {
      n.size = bytes[pos++];
      if (!n.size)
        throw new JobSpecError(
          'INVALID_READ',
          'An output tuple/array cannot be empty.'
        );
      if (code === 8)
        for (let i = 0; i < n.size; i++) n.children.push(read(depth + 1));
      else n.children.push(read(depth + 1));
    } else if (code === 9) n.children.push(read(depth + 1));
    else if (code < 1 || code > 7)
      throw new JobSpecError('INVALID_READ', 'Unknown output type code.');
    return n;
  }
  const root = read(0);
  if (root.code !== 8 || pos !== bytes.length)
    throw new JobSpecError(
      'INVALID_READ',
      'Outputs must encode exactly one root tuple.'
    );
  return root;
}
export function validateJobRead(
  r: PreparedJobRead & { field?: number[]; minConfirmations?: number }
): void {
  if (
    r.chainNamespace !== 'eip155' ||
    !/^[1-9]\d*$/.test(r.chainId) ||
    !isAddress(r.target) ||
    !/^0x[\da-f]{8}$/i.test(r.selector) ||
    !isHex(r.args) ||
    r.args.length % 2
  )
    throw new JobSpecError('INVALID_READ', 'Invalid EVM JobSpec read.');
  let node = parseOutputs(r.outputs);
  const field = r.field ?? [0];
  if (field.length < 1 || field.length > 16)
    throw new JobSpecError(
      'INVALID_READ',
      'Output field path must have 1..16 indexes.'
    );
  for (const i of field) {
    if (
      !Number.isInteger(i) ||
      i < 0 ||
      i > 255 ||
      ![8, 9, 10].includes(node.code) ||
      (node.code !== 9 && i >= (node.size ?? 0))
    )
      throw new JobSpecError(
        'INVALID_READ',
        'Output field path does not resolve.'
      );
    node = node.children[node.code === 8 ? i : 0];
  }
  if ([8, 10].includes(node.code))
    throw new JobSpecError(
      'INVALID_READ',
      'Choose a scalar or dynamic-length output field.'
    );
}
