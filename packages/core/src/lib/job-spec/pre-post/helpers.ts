import { getAddress, toHex, type Hex } from 'viem';
import { copyData } from '../../market/data';
import { JobSpecError } from '../../market/errors';
import { int256 } from '../codec';
import { PRINCIPAL } from '../constants';
import { jobReadLabel, inheritReadLabel } from '../read';
import { encodePrePostJobSpec } from './codec';
import type {
  PrePostJobSpec,
  PrePostJobSpecTemplate,
  PrePostResolveOptions,
} from './types';
export function resolvePrePostJobSpec(
  template: PrePostJobSpecTemplate,
  ctx: PrePostResolveOptions
): PrePostJobSpec {
  encodePrePostJobSpec(template);
  if (
    typeof ctx.principal !== 'bigint' ||
    ctx.principal < BigInt(0) ||
    ctx.principal >= BigInt(1) << BigInt(256) ||
    ctx.params.length !== template.params.length ||
    ctx.params.some(
      (p, i) => int256(p) < template.params[i].min || p > template.params[i].max
    )
  )
    throw new JobSpecError(
      'PARAM_OUT_OF_RANGE',
      'The job values do not match the template bounds.'
    );
  const account = (index: number) => {
    const r = template.reads[index],
      address = ctx.accounts[`${r.chainNamespace}:${r.chainId}`];
    if (!address)
      throw new JobSpecError(
        'UNFILLED_PLACEHOLDER',
        'Resolve the wallet account on every required read chain.'
      );
    return getAddress(address);
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
    const result = { ...copyData(r), args };
    delete result.fills;
    inheritReadLabel(r, result);
    return result;
  });
  const checks = template.checks.map((c) => {
    const t = c.target;
    let target: bigint;
    if (typeof t === 'bigint') target = t;
    else if (t === 'agentic:wallet') target = BigInt(account(c.left[0]));
    else if (t === PRINCIPAL) target = ctx.principal;
    else if ('param' in t) target = ctx.params[t.param];
    else {
      const product = ctx.principal * t.principalBps;
      if (product >= BigInt(1) << BigInt(256))
        throw new JobSpecError(
          'TARGET_OVERFLOW',
          'The principal-based target overflows uint256.'
        );
      target = product / BigInt(10000);
    }
    return { ...copyData(c), target: int256(target) };
  });
  const spec: PrePostJobSpec = {
    profile: 'pre-post-v1',
    reads,
    checks,
    logic: copyData(template.logic),
    allowedMutability: 'NONE',
    origin: ctx.origin,
  };
  encodePrePostJobSpec(spec);
  return spec;
}
export function describePrePostJobSpec(
  spec: PrePostJobSpec | PrePostJobSpecTemplate
): { checks: string[]; logic: string; timing: string } {
  encodePrePostJobSpec(spec);
  const read = (i: number) => {
    const r = spec.reads[i];
    return `read ${i + 1} (${r.at}, ${r.chainNamespace}:${r.chainId}, ${
      r.target
    }, ${jobReadLabel(r) ?? r.selector}, field [${r.field.join(',')}])`;
  };
  return {
    checks: spec.checks.map(
      (c) =>
        `${c.evaluation}: sum(${c.left.map(read).join(' + ')}) ${
          c.right.length ? `against sum(${c.right.map(read).join(' + ')}) ` : ''
        }${c.operation} ${
          typeof c.target === 'bigint'
            ? `${c.target} ${
                c.evaluation === 'PERCENTAGE' ? 'bps' : 'raw units'
              }`
            : typeof c.target === 'object'
            ? JSON.stringify(c.target, (_, v) =>
                typeof v === 'bigint' ? v.toString() : v
              )
            : c.target
        }.`
    ),
    logic: spec.logic
      .map(
        (n, i) =>
          `${i}: ${
            n.kind === 'CHECK'
              ? `check ${n.check + 1}`
              : `${n.kind}${
                  n.kind === 'AT_LEAST' ? ` ${n.k}` : ''
                } [${n.children.join(',')}]`
          }`
      )
      .join('; '),
    timing:
      'PRE reads use fund blocks; POST reads use submit blocks. A FAIL at those fixed blocks is final.',
  };
}
