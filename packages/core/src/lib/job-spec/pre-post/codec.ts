import {
  decodeAbiParameters,
  encodeAbiParameters,
  isHex,
  zeroHash,
  type AbiParameter,
  type Hex,
} from 'viem';
import { copyData } from '../../market/data';
import { JobSpecError } from '../../market/errors';
import { int256 } from '../codec';
import { EVALUATIONS, OPERATIONS, PRINCIPAL } from '../constants';
import {
  inheritReadLabel,
  validateJobRead,
  parseOutputs,
  type OutputNode,
} from '../read';
import { PRE_POST_SPEC_PARAM, PRE_POST_TEMPLATE_PARAM } from './schema';
import {
  PRE_POST_PROFILE,
  type BuildPrePostJobSpecOptions,
  type BuildPrePostJobSpecTemplateOptions,
  type PrePostCheckTemplate,
  type PrePostJobSpec,
  type PrePostJobSpecTemplate,
  type PrePostLogic,
  type PrePostReadInput,
} from './types';
export const PRE_POST_CONSTANTS = Object.freeze({
  PROFILE: PRE_POST_PROFILE,
  SOURCE_COMMIT: '8666c2ac2304ffd97a7ada121170c397d0f6125d',
  READ_AT: Object.freeze({
    POST_EXECUTION: 'POST_EXECUTION',
    PRE_EXECUTION: 'PRE_EXECUTION',
  } as const),
  LOGIC: Object.freeze({
    CHECK: 'CHECK',
    ALL: 'ALL',
    ANY: 'ANY',
    AT_LEAST: 'AT_LEAST',
  } as const),
  MAX_READS: 32,
  MAX_CHECKS: 16,
  MAX_LOGIC: 32,
  MAX_DESCRIPTION_BYTES: 32768,
});
const mutabilities = ['BOTH', 'NONE', 'CLIENT', 'PROVIDER'] as const;
const kinds = ['CHECK', 'ALL', 'ANY', 'AT_LEAST'] as const;
const phases = ['POST_EXECUTION', 'PRE_EXECUTION'] as const;
function fail(message: string): never {
  throw new JobSpecError('INVALID_JOB_SPEC', message);
}
function index<T>(items: readonly T[], value: T): number {
  const n = items.indexOf(value);
  if (n < 0) fail('Unknown criteria enum value.');
  return n;
}
function count(values: readonly unknown[], max: number, min = 1): void {
  if (!Array.isArray(values) || values.length < min || values.length > max)
    fail(`Expected ${min}..${max} entries.`);
}
function logic(
  input: BuildPrePostJobSpecOptions['logic'],
  checks: number
): PrePostLogic[] {
  return typeof input === 'string'
    ? [
        {
          kind: input,
          check: 0,
          children: Array.from({ length: checks }, (_, i) => i + 1),
          k: 0,
        },
        ...Array.from(
          { length: checks },
          (_, check): PrePostLogic => ({
            kind: 'CHECK',
            check,
            children: [],
            k: 0,
          })
        ),
      ]
    : copyData(input);
}
function reads(input: BuildPrePostJobSpecOptions['reads']) {
  return input.map((r) => {
    const wrapper = r as PrePostReadInput;
    const source = 'read' in r ? wrapper.read : r;
    const result = {
      ...copyData(source),
      minConfirmations:
        wrapper.minConfirmations ??
        ('minConfirmations' in source ? Number(source.minConfirmations) : 1),
      field: [
        ...(wrapper.field ??
          ('field' in source ? (source.field as number[]) : [0])),
      ],
      at: wrapper.at ?? ('POST_EXECUTION' as const),
    };
    inheritReadLabel(source, result);
    return result;
  });
}
export function templateTarget(
  target: PrePostCheckTemplate['target'],
  params: number
): { source: number; value: bigint } {
  if (typeof target === 'bigint') return { source: 0, value: int256(target) };
  if (target === PRINCIPAL) return { source: 1, value: BigInt(10000) };
  if (target === 'agentic:wallet') return { source: 3, value: BigInt(0) };
  if (
    target &&
    typeof target === 'object' &&
    'principalBps' in target &&
    int256(target.principalBps) > BigInt(0)
  )
    return { source: 1, value: target.principalBps };
  if (
    target &&
    typeof target === 'object' &&
    'param' in target &&
    Number.isInteger(target.param) &&
    target.param >= 0 &&
    target.param < params
  )
    return { source: 2, value: BigInt(target.param) };
  return fail('Unknown or out-of-range template target.');
}
export function validatePrePost(
  spec: PrePostJobSpec | PrePostJobSpecTemplate
): void {
  if (spec.profile !== PRE_POST_PROFILE)
    fail('An explicit pre-post-v1 profile is required.');
  count(spec.reads, 32);
  count(spec.checks, 16);
  count(spec.logic, 32);
  const template = 'params' in spec;
  if (template) {
    // Each bound uses two ABI words; the encoded-size cap supplies the effective limit.
    count(spec.params, 512, 0);
    for (const p of spec.params)
      if (int256(p.min) > int256(p.max))
        fail('Parameter minimum exceeds its maximum.');
    if ('allowedMutability' in spec)
      fail('The current card template has no mutability field.');
  } else {
    index(mutabilities, spec.allowedMutability);
    if (!/^0x[\da-f]{64}$/i.test(spec.origin)) fail('Invalid criteria origin.');
  }
  if ('executeBy' in spec || 'failFinalAt' in spec)
    fail('This profile has no JobSpec timing fields.');
  let anyPost = false;
  for (const r of spec.reads) {
    validateJobRead(r);
    if (/^0x0{40}$/i.test(r.target))
      fail('Evaluator read targets must be nonzero.');
    const root = parseOutputs(r.outputs);
    const dynamic = (node: OutputNode): boolean =>
      [6, 7, 9].includes(node.code) || node.children.some(dynamic);
    const head = (node: OutputNode): bigint =>
      dynamic(node)
        ? BigInt(1)
        : node.code === 8
        ? node.children.reduce((sum, child) => sum + head(child), BigInt(0))
        : node.code === 10
        ? BigInt(node.size ?? 0) * head(node.children[0])
        : BigInt(1);
    const depth = (node: OutputNode, level: number): void => {
      if (level > 8) fail('Output nesting exceeds the evaluator limit.');
      node.children.forEach((child) => depth(child, level + 1));
    };
    depth(root, 0);
    if (
      r.outputs.length > 258 ||
      r.field.length > 8 ||
      root.children.reduce((sum, child) => sum + head(child), BigInt(0)) *
        BigInt(32) >
        BigInt(4096)
    )
      fail('Output layout exceeds evaluator limits.');
    index(phases, r.at);
    anyPost ||= r.at === 'POST_EXECUTION';
    if (
      r.chainNamespace.length > 32 ||
      r.chainId.length > 32 ||
      (r.args.length - 2) / 2 > 512 ||
      !Number.isInteger(r.minConfirmations) ||
      r.minConfirmations < 1 ||
      r.minConfirmations > 65535
    )
      fail('Read exceeds evaluator limits.');
    const used = new Set<number>();
    for (const f of r.fills ?? []) {
      if (
        !template ||
        !Number.isInteger(f.word) ||
        f.word < 0 ||
        f.word > 255 ||
        (f.word + 1) * 32 > (r.args.length - 2) / 2 ||
        used.has(f.word)
      )
        fail('Invalid or unresolved fill.');
      used.add(f.word);
      if (f.source === 'WALLET' && f.param !== undefined && f.param !== 0)
        fail('A WALLET fill cannot carry a parameter index.');
      if (f.source !== 'WALLET' && f.source !== 'PARAM')
        fail('Unknown fill source.');
      if (
        f.source === 'PARAM' &&
        (!Number.isInteger(f.param) ||
          (f.param ?? -1) < 0 ||
          (f.param ?? -1) >= (spec as PrePostJobSpecTemplate).params.length)
      )
        fail('Fill parameter is out of range.');
    }
  }
  if (!anyPost) fail('At least one POST_EXECUTION read is required.');
  const usedReads = new Set<number>();
  for (const c of spec.checks) {
    index(EVALUATIONS, c.evaluation);
    index(OPERATIONS, c.operation);
    for (const side of [c.left, c.right]) {
      count(side, 32, 0);
      side.forEach((r, i) => {
        if (
          !Number.isInteger(r) ||
          r < 0 ||
          r >= spec.reads.length ||
          (i > 0 && r <= side[i - 1])
        )
          fail('Check sides must be sorted, distinct valid read indexes.');
        usedReads.add(r);
      });
    }
    if (c.left.some((r) => c.right.includes(r)))
      fail('Check sides must not overlap.');
    const pair = c.evaluation === 'NUMBER' || c.evaluation === 'PERCENTAGE';
    if (
      !c.left.length ||
      c.right.length > 0 !== pair ||
      (c.evaluation === 'BOOLEAN' &&
        (c.left.length !== 1 || c.operation !== 'EQUAL'))
    )
      fail('Invalid check sides or operation.');
    if (template)
      templateTarget(c.target, (spec as PrePostJobSpecTemplate).params.length);
    else if (typeof c.target !== 'bigint')
      fail('Complete criteria require resolved targets.');
    else int256(c.target);
    if (
      c.evaluation === 'BOOLEAN' &&
      typeof c.target === 'bigint' &&
      c.target !== BigInt(0) &&
      c.target !== BigInt(1)
    )
      fail('BOOLEAN target must be 0 or 1.');
  }
  const reached = new Set([0]),
    usedChecks = new Set<number>();
  spec.logic.forEach((n, i) => {
    index(kinds, n.kind);
    if (
      !reached.has(i) ||
      !Number.isInteger(n.check) ||
      n.check < 0 ||
      n.check > 255 ||
      !Number.isInteger(n.k) ||
      n.k < 0 ||
      n.k > 255
    )
      fail('Invalid or unreachable logic entry.');
    count(n.children, 32, 0);
    if (n.kind === 'CHECK') {
      if (n.check >= spec.checks.length || n.children.length)
        fail('Invalid CHECK leaf.');
      usedChecks.add(n.check);
    } else {
      if (
        !n.children.length ||
        (n.kind === 'AT_LEAST' && (n.k < 1 || n.k > n.children.length))
      )
        fail('Invalid logic threshold.');
      n.children.forEach((child, j) => {
        if (
          !Number.isInteger(child) ||
          child <= i ||
          child >= spec.logic.length ||
          (j > 0 && child <= n.children[j - 1])
        )
          fail('Logic children must be sorted and follow their parent.');
        reached.add(child);
      });
    }
  });
  if (
    usedChecks.size !== spec.checks.length ||
    usedReads.size !== spec.reads.length
  )
    fail('Every check and read must contribute to the root verdict.');
}
export function buildPrePostJobSpec(
  options: BuildPrePostJobSpecOptions
): PrePostJobSpec {
  if ('executeBy' in options || 'failFinalAt' in options)
    fail('This profile has no JobSpec timing fields.');
  const spec: PrePostJobSpec = {
    profile: PRE_POST_PROFILE,
    reads: reads(options.reads),
    checks: copyData(options.checks),
    logic: logic(options.logic, options.checks.length),
    allowedMutability: options.allowedMutability ?? 'NONE',
    origin: options.origin ?? zeroHash,
  };
  encodePrePostJobSpec(spec);
  return spec;
}
export function buildPrePostJobSpecTemplate(
  options: BuildPrePostJobSpecTemplateOptions
): PrePostJobSpecTemplate {
  if (
    'allowedMutability' in options ||
    'executeBy' in options ||
    'failFinalAt' in options
  )
    fail('This template has no mutability or timing fields.');
  const spec: PrePostJobSpecTemplate = {
    profile: PRE_POST_PROFILE,
    reads: reads(options.reads),
    checks: copyData(options.checks),
    logic: logic(options.logic, options.checks.length),
    params: copyData(options.params ?? []),
  };
  encodePrePostJobSpec(spec);
  return spec;
}
export function encodePrePostJobSpec(
  spec: PrePostJobSpec | PrePostJobSpecTemplate
): Hex {
  validatePrePost(spec);
  const template = 'params' in spec;
  const value = {
    reads: spec.reads.map(({ fills, at, ...r }) => ({
      ...r,
      at: index(phases, at),
      ...(template
        ? {
            fills: (fills ?? []).map((f) => ({
              word: f.word,
              source: f.source === 'WALLET' ? 0 : 1,
              param: f.param ?? 0,
            })),
          }
        : {}),
    })),
    checks: spec.checks.map((c) => ({
      left: c.left,
      right: c.right,
      evaluation: index(EVALUATIONS, c.evaluation),
      operation: index(OPERATIONS, c.operation),
      ...(template
        ? templateTarget(c.target, spec.params.length)
        : { target: c.target }),
    })),
    logic: spec.logic.map((n) => ({ ...n, kind: index(kinds, n.kind) })),
    ...(template
      ? { params: spec.params }
      : {
          allowedMutability: index(mutabilities, spec.allowedMutability),
          origin: spec.origin,
        }),
  };
  const bytes = encodeAbiParameters(
    [
      (template
        ? PRE_POST_TEMPLATE_PARAM
        : PRE_POST_SPEC_PARAM) as AbiParameter,
    ],
    [value]
  );
  if (bytes.length > 2 + 32768 * 2)
    fail('Encoded criteria exceed the 32 KB evaluator limit.');
  return bytes;
}
export function decodePrePostJobSpec(
  bytes: Hex,
  options: { format: 'spec' }
): PrePostJobSpec;
export function decodePrePostJobSpec(
  bytes: Hex,
  options: { format: 'template' }
): PrePostJobSpecTemplate;
export function decodePrePostJobSpec(
  bytes: Hex,
  options: { format: 'spec' | 'template' }
): PrePostJobSpec | PrePostJobSpecTemplate;
export function decodePrePostJobSpec(
  bytes: Hex,
  options: { format: 'spec' | 'template' }
): PrePostJobSpec | PrePostJobSpecTemplate {
  if (!isHex(bytes) || bytes.length > 65538)
    fail('Invalid or oversized criteria.');
  try {
    const template = options.format === 'template';
    type Wire = {
      reads: (Omit<PrePostJobSpec['reads'][number], 'at' | 'fills'> & {
        at: number;
        fills?: { word: number; source: number; param: number }[];
      })[];
      checks: {
        left: number[];
        right: number[];
        evaluation: number;
        operation: number;
        target: bigint;
        source: number;
        value: bigint;
      }[];
      logic: (Omit<PrePostLogic, 'kind'> & { kind: number })[];
      allowedMutability: number;
      origin: Hex;
      params: PrePostJobSpecTemplate['params'];
    };
    const w = decodeAbiParameters(
      [
        (template
          ? PRE_POST_TEMPLATE_PARAM
          : PRE_POST_SPEC_PARAM) as AbiParameter,
      ],
      bytes
    )[0] as Wire;
    const spec = {
      profile: PRE_POST_PROFILE,
      reads: w.reads.map(({ at, fills, ...r }) => ({
        ...r,
        at: phases[at],
        ...(template
          ? {
              fills: (fills ?? []).map((f) => {
                if (f.source > 1 || (f.source === 0 && f.param !== 0))
                  fail('Invalid stored fill.');
                return {
                  word: f.word,
                  source:
                    f.source === 0 ? ('WALLET' as const) : ('PARAM' as const),
                  ...(f.source === 1 ? { param: f.param } : {}),
                };
              }),
            }
          : {}),
      })),
      checks: w.checks.map((c) => ({
        left: [...c.left],
        right: [...c.right],
        evaluation: EVALUATIONS[c.evaluation],
        operation: OPERATIONS[c.operation],
        target: !template
          ? c.target
          : c.source === 0
          ? c.value
          : c.source === 1
          ? c.value === BigInt(10000)
            ? PRINCIPAL
            : { principalBps: c.value }
          : c.source === 2
          ? { param: Number(c.value) }
          : c.source === 3 && c.value === BigInt(0)
          ? ('agentic:wallet' as const)
          : fail('Invalid stored target.'),
      })),
      logic: w.logic.map((n) => ({
        ...n,
        children: [...n.children],
        kind: kinds[n.kind],
      })),
      ...(template
        ? { params: w.params.map((p) => ({ ...p })) }
        : {
            allowedMutability: mutabilities[w.allowedMutability],
            origin: w.origin,
          }),
    } as PrePostJobSpec | PrePostJobSpecTemplate;
    if (encodePrePostJobSpec(spec).toLowerCase() !== bytes.toLowerCase())
      fail('Noncanonical criteria encoding.');
    return spec;
  } catch (cause) {
    throw new JobSpecError(
      'UNSUPPORTED_JOB_SPEC',
      'The bytes are not canonical pre-post-v1 criteria.',
      undefined,
      cause
    );
  }
}
