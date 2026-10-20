import { getAddress, keccak256, toHex, type Address, type Hex } from 'viem';
import { encodeJobSpec, int256 } from './codec';
import { PRINCIPAL } from './constants';
import { JobSpecError } from '../market/errors';
import type { JobSpec, JobSpecTemplate, LogicTree } from './types';
export function resolveJobSpec(
  template: JobSpecTemplate,
  ctx: {
    principal: bigint;
    params: bigint[];
    accounts: Record<string, Address>;
    origin: Hex;
    executeBy: number;
    settleWindow: number;
  }
): JobSpec {
  encodeJobSpec(template);
  if (
    ctx.params.length !== template.params.length ||
    ctx.params.some(
      (n, i) => int256(n) < template.params[i].min || n > template.params[i].max
    )
  )
    throw new JobSpecError(
      'PARAM_OUT_OF_RANGE',
      'The job parameters do not match the template bounds.'
    );
  const account = (read: number): Address => {
    const r = template.reads[read];
    const a = ctx.accounts[`${r.chainNamespace}:${r.chainId}`];
    if (!a)
      throw new JobSpecError(
        'UNFILLED_PLACEHOLDER',
        'Resolve the wallet account on every read chain.'
      );
    return getAddress(a);
  };
  const reads = template.reads.map((r, i) => {
    let args = r.args;
    for (const f of r.fills ?? []) {
      const value =
        f.source === 'WALLET'
          ? BigInt(account(i))
          : BigInt.asUintN(256, ctx.params[f.param ?? 0]);
      const at = 2 + f.word * 64;
      args = (args.slice(0, at) +
        toHex(value, { size: 32 }).slice(2) +
        args.slice(at + 64)) as Hex;
    }
    const read = { ...r };
    delete read.fills;
    return { ...read, args };
  });
  const checks = template.checks.map((c) => {
    const t = c.target;
    const target =
      typeof t === 'bigint'
        ? t
        : t === PRINCIPAL
        ? ctx.principal
        : t === 'agentic:wallet'
        ? BigInt(account(c.read))
        : 'param' in t
        ? ctx.params[t.param]
        : (() => {
            const product = ctx.principal * t.principalBps;
            if (product >= BigInt(1) << BigInt(256))
              throw new JobSpecError(
                'TARGET_OVERFLOW',
                'The principal-based target overflows uint256.'
              );
            return product / BigInt(10000);
          })();
    return { ...c, target: int256(target) };
  });
  const spec = {
    reads,
    checks,
    logic: template.logic,
    allowedMutability: template.allowedMutability,
    origin: ctx.origin,
    executeBy: ctx.executeBy,
    failFinalAt: ctx.executeBy + ctx.settleWindow,
  };
  encodeJobSpec(spec);
  return spec;
}
const words = {
  EQUAL: 'equals',
  NOT_EQUAL: 'does not equal',
  GREATER_THAN: 'is greater than',
  GREATER_OR_EQUAL: 'is at least',
  LESS_THAN: 'is less than',
  LESS_OR_EQUAL: 'is at most',
};
export function describeJobSpec(
  spec: JobSpec | JobSpecTemplate,
  options?: { principal?: bigint; decimals?: Record<Address, number> }
): { checks: string[]; logic: string; timing: string } {
  encodeJobSpec(spec);
  function logic(t: LogicTree): string {
    return `${
      t.kind === 'ALL' ? 'All' : t.kind === 'ANY' ? 'Any' : `At least ${t.k}`
    } of (${t.of
      .map((x) => (typeof x === 'number' ? `check ${x + 1}` : logic(x)))
      .join(', ')})`;
  }
  return {
    checks: spec.checks.map((c) => {
      const r = spec.reads[c.read];
      const t = c.target;
      const target =
        typeof t === 'bigint'
          ? t.toString()
          : t === PRINCIPAL
          ? options?.principal?.toString() ?? 'principal'
          : t === 'agentic:wallet'
          ? 'the wallet on this chain'
          : 'param' in t
          ? `parameter ${t.param + 1}`
          : options?.principal !== undefined
          ? ((options.principal * t.principalBps) / BigInt(10000)).toString()
          : `${t.principalBps} basis points of principal`;
      return `Read ${c.read + 1}: ${r.target} ${r.selector} on ${
        r.chainNamespace
      }:${r.chainId}, field [${r.field.join(',')}], ${c.evaluation} ${
        words[c.operation]
      } ${target}${c.evaluation === 'PERCENTAGE' ? ' bps' : ' (raw units)'}.`;
    }),
    logic: logic(spec.logic),
    timing:
      'executeBy' in spec
        ? `Execute by ${new Date(
            spec.executeBy * 1000
          ).toISOString()}; failure is final after ${new Date(
            spec.failFinalAt * 1000
          ).toISOString()}.`
        : '',
  };
}
export function specOrigin(
  marketplace: Address,
  cardId: bigint,
  version: bigint,
  principal: bigint
): Hex {
  // Imported here to keep the public helpers independent of client state.
  return keccak256(
    ('0x' +
      [
        marketplace.slice(2).padStart(64, '0'),
        ...[cardId, version, principal].map((n) =>
          toHex(n, { size: 32 }).slice(2)
        ),
      ].join('')) as Hex
  );
}
