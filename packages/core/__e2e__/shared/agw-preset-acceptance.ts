/** Assertions shared by live acceptance and the actual-contract local suite.
 * No route substitution or asset removal is permitted in this acceptance path.
 */
import {
  encodeAbiParameters,
  getAddress,
  parseAbiItem,
  toFunctionSelector,
  type AbiParameter,
  type Hex,
} from 'viem';
import type { Rule, RulesRecord } from '../../src/lib/agentic/agentic.types';
import type { PresetCategory } from '../../src/lib/agentic/presets/types';

export const PRESET_ACCEPTANCE_CASES = [
  ['DEXES', 'eip155:11155111'],
  ['DEXES', 'eip155:84532'],
  ['DEXES', 'eip155:421614'],
  ['LENDING', 'eip155:11155111'],
  ['LENDING', 'eip155:84532'],
  ['LENDING', 'eip155:421614'],
] as const satisfies readonly (readonly [PresetCategory, `eip155:${string}`])[];

function words(param: AbiParameter): number {
  if (param.type === 'tuple' && 'components' in param)
    return param.components.reduce((n, c) => n + words(c), 0);
  if (/\[|bytes$|string$/.test(param.type))
    throw new Error('Acceptance pin needs a static argument');
  return 1;
}
function pinLocation(
  inputs: readonly AbiParameter[],
  path: number | readonly number[]
): { arg: number; param: AbiParameter } {
  const parts = typeof path === 'number' ? [path] : path;
  let current = inputs,
    offset = 0,
    selected: AbiParameter | undefined;
  for (let depth = 0; depth < parts.length; depth++) {
    const index = parts[depth];
    selected = current[index];
    if (!selected) throw new Error('Invalid pin argument path');
    offset += current.slice(0, index).reduce((n, c) => n + words(c), 0);
    if (depth < parts.length - 1) {
      if (selected.type !== 'tuple' || !('components' in selected))
        throw new Error('Invalid pin tuple path');
      current = selected.components;
    }
  }
  return { arg: offset, param: selected! };
}
export function expectStoredPreset(input: Rule, record: RulesRecord): void {
  if (!('allowedCalls' in record.rule))
    throw new Error('Expected an EVM rule record');
  expect(record.enabled).toBe(true);
  expect(record.agent).toBe(getAddress(input.agent));
  expect(record.chainNamespace).toBe(input.chainNamespace);
  expect(record.validUntil).toBe(input.validUntil);
  expect(record.rule.maxGasPerCall).toBe(input.maxGasPerCall);
  expect(record.rule.assets).toEqual(
    input.assets!.map((a) => ({
      token: getAddress(
        typeof a.token === 'string' ? a.token : a.token.address
      ),
      maxPerCall: a.maxPerCall,
      maxTotal: a.maxTotal ?? BigInt(0),
    }))
  );
  expect(record.spent).toEqual({
    kind: 'universal',
    assets: input.assets!.map((a) => ({
      token: getAddress(
        typeof a.token === 'string' ? a.token : a.token.address
      ),
      spent: BigInt(0),
    })),
  });
  expect(record.rule.allowedCalls).toEqual(
    input.allowedCalls.map((c) => {
      const fn = parseAbiItem(`function ${c.selector}`);
      if (fn.type !== 'function') throw new Error('Expected a function');
      return {
        target: getAddress(c.target),
        selector: toFunctionSelector(fn),
        maxValue: c.maxValue ?? BigInt(0),
        pins: (c.pins ?? []).map((p) => {
          if (!('arg' in p) || p.arg === undefined)
            throw new Error('Expected authored argument pin');
          const loc = pinLocation(fn.inputs, p.arg);
          if ('max' in p) return { arg: loc.arg, max: p.max };
          return {
            arg: loc.arg,
            expected:
              p.expected === 'agentic:wallet'
                ? 'agentic:wallet'
                : (encodeAbiParameters(
                    [loc.param],
                    [p.expected as never]
                  ).toLowerCase() as Hex),
          };
        }),
      };
    })
  );
}
