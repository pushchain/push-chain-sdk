import {
  decodeAbiParameters,
  encodeAbiParameters,
  isHex,
  zeroHash,
  type AbiParameter,
  type Hex,
} from 'viem';
import { JobSpecError } from '../market/errors';
import {
  EVALUATIONS,
  OPERATIONS,
  LOGIC_KINDS,
  MUTABILITIES,
  PRINCIPAL,
} from './constants';
import { JOB_SPEC_PARAM, JOB_TEMPLATE_PARAM } from './schema';
import { validateJobRead } from './read';
import type {
  BuildJobSpecOptions,
  BuildJobSpecTemplateOptions,
  JobCheckTemplate,
  JobRead,
  JobReadInput,
  JobSpec,
  JobSpecTemplate,
  LogicTree,
} from './types';

interface LogicWire {
  kind: number;
  checks: readonly number[];
  children: readonly number[];
  k: number;
}
interface CheckWire {
  read: number;
  evaluation: number;
  operation: number;
  target: bigint;
}
interface TemplateCheckWire {
  read: number;
  evaluation: number;
  operation: number;
  source: number;
  value: bigint;
}
interface ReadWire extends Omit<JobRead, 'fills'> {
  fills?: { word: number; source: number; param: number }[];
}
interface SpecWire {
  reads: ReadWire[];
  checks: CheckWire[];
  logic: LogicWire[];
  allowedMutability: number;
  origin: Hex;
  executeBy: bigint;
  failFinalAt: bigint;
}
interface TemplateWire {
  reads: ReadWire[];
  checks: TemplateCheckWire[];
  logic: LogicWire[];
  allowedMutability: number;
  params: { min: bigint; max: bigint }[];
}
const originalLogic = new WeakMap<
  LogicTree,
  { fingerprint: string; wire: LogicWire[] }
>();
const fail = (message: string, code = 'INVALID_JOB_SPEC'): never => {
  throw new JobSpecError(code, message);
};
const fingerprint = (x: unknown): string =>
  JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
export function int256(value: bigint, what = 'Target'): bigint {
  if (
    typeof value !== 'bigint' ||
    value < -(BigInt(1) << BigInt(255)) ||
    value >= BigInt(1) << BigInt(255)
  )
    fail(`${what} must fit int256.`);
  return value;
}
function count(
  values: readonly unknown[],
  max: number,
  what: string,
  min = 1
): void {
  if (!Array.isArray(values) || values.length < min || values.length > max)
    fail(
      `${what} must contain ${min}..${max} entries.`,
      `TOO_MANY_${what.toUpperCase()}`
    );
}
function timestamp(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0)
    fail('Timestamps must be nonnegative safe integers.');
}
function enumIndex<T>(values: T[], value: T, name: string): number {
  const i = values.indexOf(value);
  if (i < 0) fail(`Unknown ${name}.`);
  return i;
}
export function flattenLogic(tree: LogicTree, checkCount: number): LogicWire[] {
  const nodes: LogicWire[] = [];
  const active = new Set<LogicTree>();
  function visit(t: LogicTree): number {
    if (!t || active.has(t) || nodes.length >= 32)
      fail('Logic is cyclic or exceeds 32 operators.', 'BAD_TREE');
    active.add(t);
    const index = nodes.length;
    const kind = enumIndex(LOGIC_KINDS, t.kind, 'logic kind');
    if (!Array.isArray(t.of) || !t.of.length || t.of.length > 255)
      fail('Logic operators need 1..255 operands.', 'BAD_TREE');
    const k = t.kind === 'AT_LEAST' ? t.k ?? 0 : 0;
    if (
      !Number.isInteger(k) ||
      (t.kind === 'AT_LEAST' && (k < 1 || k > t.of.length)) ||
      (t.kind !== 'AT_LEAST' && t.k !== undefined && t.k !== 0)
    )
      fail('Invalid AT_LEAST threshold.', 'BAD_TREE');
    const n: LogicWire = { kind, checks: [], children: [], k: k };
    nodes.push(n);
    for (const item of t.of) {
      if (typeof item === 'number') {
        if (
          !Number.isInteger(item) ||
          item < 0 ||
          item >= checkCount ||
          n.checks.includes(item)
        )
          fail('Dangling or duplicated check index.', 'BAD_TREE');
        (n.checks as number[]).push(item);
      } else (n.children as number[]).push(visit(item));
    }
    active.delete(t);
    return index;
  }
  visit(tree);
  const saved = originalLogic.get(tree);
  return saved?.fingerprint === fingerprint(tree) ? saved.wire : nodes;
}
function nestLogic(nodes: LogicWire[], checkCount: number): LogicTree {
  count(nodes, 32, 'logic');
  const reached = new Set<number>();
  let expanded = 0;
  function visit(index: number, depth: number): LogicTree {
    if (++expanded > 512 || depth > 32)
      fail('Stored logic is too large to describe as a tree.', 'BAD_TREE');
    const n = nodes[index];
    if (!n || !LOGIC_KINDS[n.kind])
      fail('Unknown stored logic kind.', 'BAD_TREE');
    reached.add(index);
    if (
      n.checks.some((i) => !Number.isInteger(i) || i < 0 || i >= checkCount) ||
      new Set(n.checks).size !== n.checks.length
    )
      fail('Invalid stored check reference.', 'BAD_TREE');
    if (
      n.children.some((i) => i <= index || i >= nodes.length) ||
      new Set(n.children).size !== n.children.length
    )
      fail('Invalid stored child reference.', 'BAD_TREE');
    const t: LogicTree = {
      kind: LOGIC_KINDS[n.kind],
      of: [...n.checks, ...n.children.map((i) => visit(i, depth + 1))],
      ...(n.kind === 2 ? { k: n.k } : {}),
    };
    if (n.kind !== 2 && n.k !== 0)
      fail('Unexpected threshold on stored logic.', 'BAD_TREE');
    return t;
  }
  const tree = visit(0, 0);
  if (reached.size !== nodes.length)
    fail('Stored logic has unreachable operators.', 'BAD_TREE');
  // Preserve an unchanged, valid topological order instead of rewriting signed bytes.
  originalLogic.set(tree, { fingerprint: fingerprint(tree), wire: nodes });
  flattenLogic(tree, checkCount);
  return tree;
}
function normalizeReads(values: BuildJobSpecOptions['reads']): JobRead[] {
  count(values, 16, 'reads');
  return values.map((input) => {
    const wrapper = input as JobReadInput;
    const source = 'read' in input ? wrapper.read : input;
    const read: JobRead = {
      ...source,
      field: [...(wrapper.field ?? [0])],
      minConfirmations: wrapper.minConfirmations ?? 1,
      ...(source.fills ? { fills: source.fills.map((f) => ({ ...f })) } : {}),
    };
    return read;
  });
}
function validate(spec: JobSpec | JobSpecTemplate): void {
  count(spec.reads, 16, 'reads');
  count(spec.checks, 16, 'checks');
  enumIndex(MUTABILITIES, spec.allowedMutability, 'allowedMutability');
  const template = 'params' in spec;
  if (template) {
    count(spec.params, 16, 'params', 0);
    for (const p of spec.params)
      if (int256(p.min) > int256(p.max))
        fail('Parameter minimum exceeds its maximum.');
  } else {
    timestamp(spec.executeBy);
    timestamp(spec.failFinalAt);
    if (
      spec.failFinalAt <= spec.executeBy ||
      !/^0x[\da-f]{64}$/i.test(spec.origin)
    )
      fail('Invalid JobSpec timing or origin.');
  }
  for (const r of spec.reads) {
    validateJobRead(r);
    if (
      !Number.isInteger(r.minConfirmations) ||
      r.minConfirmations < 1 ||
      r.minConfirmations > 65535
    )
      fail('Read confirmations must be 1..65535.');
    const words = new Set<number>();
    for (const f of r.fills ?? []) {
      if (!template)
        fail(
          'A complete JobSpec cannot contain placeholders.',
          'UNFILLED_PLACEHOLDER'
        );
      if (
        !Number.isInteger(f.word) ||
        f.word < 0 ||
        f.word > 255 ||
        f.word * 32 + 32 > (r.args.length - 2) / 2 ||
        words.has(f.word)
      )
        fail('Invalid or duplicate fill word.');
      words.add(f.word);
      if (!['WALLET', 'PARAM'].includes(f.source)) fail('Unknown fill source.');
      if (
        f.source === 'PARAM' &&
        (!Number.isInteger(f.param) ||
          (f.param ?? -1) < 0 ||
          (f.param ?? -1) >= (spec as JobSpecTemplate).params.length)
      )
        fail('Fill parameter is out of range.');
    }
  }
  for (const c of spec.checks) {
    if (!Number.isInteger(c.read) || c.read < 0 || c.read >= spec.reads.length)
      fail('Check read index is out of range.');
    enumIndex(EVALUATIONS, c.evaluation, 'evaluation');
    enumIndex(OPERATIONS, c.operation, 'operation');
    if (c.evaluation === 'BOOLEAN' && c.operation !== 'EQUAL')
      fail('BOOLEAN checks use EQUAL.');
    if (typeof c.target === 'bigint') int256(c.target);
    else if (!template)
      fail(
        'Complete JobSpec targets must be resolved integers.',
        'UNFILLED_PLACEHOLDER'
      );
    else targetWire(c.target, (spec as JobSpecTemplate).params.length);
  }
  flattenLogic(spec.logic, spec.checks.length);
}
function targetWire(
  target: JobCheckTemplate['target'],
  params: number
): { source: number; value: bigint } {
  if (typeof target === 'bigint') return { source: 0, value: int256(target) };
  if (target === PRINCIPAL) return { source: 1, value: BigInt(10000) };
  if (target === 'agentic:wallet') return { source: 3, value: BigInt(0) };
  if (target && typeof target === 'object' && 'principalBps' in target) {
    if (int256(target.principalBps) <= BigInt(0))
      fail('principalBps must be positive.');
    return { source: 1, value: target.principalBps };
  }
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
export function buildJobSpec(options: BuildJobSpecOptions): JobSpec {
  const spec: JobSpec = {
    reads: normalizeReads(options.reads),
    checks: options.checks.map((c) => ({ ...c })),
    logic:
      typeof options.logic === 'string'
        ? { kind: options.logic, of: options.checks.map((_, i) => i) }
        : options.logic,
    allowedMutability: options.allowedMutability ?? 'NONE',
    origin: options.origin ?? zeroHash,
    executeBy: options.executeBy,
    failFinalAt: options.failFinalAt,
  };
  validate(spec);
  if (options.expiredAt !== undefined) {
    timestamp(options.expiredAt);
    if (options.failFinalAt >= options.expiredAt)
      fail('failFinalAt must precede job expiry.', 'FAIL_WINDOW_THIN');
  }
  return spec;
}
export function buildJobSpecTemplate(
  options: BuildJobSpecTemplateOptions
): JobSpecTemplate {
  const t: JobSpecTemplate = {
    reads: normalizeReads(options.reads),
    checks: options.checks.map((c) => ({ ...c })),
    logic:
      typeof options.logic === 'string'
        ? { kind: options.logic, of: options.checks.map((_, i) => i) }
        : options.logic,
    allowedMutability: options.allowedMutability ?? 'NONE',
    params: (options.params ?? []).map((p) => ({ ...p })),
  };
  validate(t);
  return t;
}
export function encodeJobSpec(spec: JobSpec | JobSpecTemplate): Hex {
  validate(spec);
  const base = {
    reads: spec.reads.map(({ fills, ...r }) =>
      'params' in spec
        ? {
            ...r,
            fills: (fills ?? []).map((f) => ({
              word: f.word,
              source: f.source === 'WALLET' ? 0 : 1,
              param: f.param ?? 0,
            })),
          }
        : r
    ),
    logic: flattenLogic(spec.logic, spec.checks.length),
    allowedMutability: MUTABILITIES.indexOf(spec.allowedMutability),
  };
  const checks = spec.checks.map((c) => ({
    read: c.read,
    evaluation: EVALUATIONS.indexOf(c.evaluation),
    operation: OPERATIONS.indexOf(c.operation),
    ...('params' in spec
      ? targetWire(c.target, spec.params.length)
      : { target: c.target }),
  }));
  const value =
    'params' in spec
      ? { ...base, checks, params: spec.params }
      : {
          ...base,
          checks,
          origin: spec.origin,
          executeBy: BigInt(spec.executeBy),
          failFinalAt: BigInt(spec.failFinalAt),
        };
  return encodeAbiParameters(
    [('params' in spec ? JOB_TEMPLATE_PARAM : JOB_SPEC_PARAM) as AbiParameter],
    [value]
  );
}
/** Known callers pass the format; inference requires one canonical validated decode. */
export function decodeJobSpec(
  bytes: Hex,
  options?: { format?: 'spec' | 'template' }
): JobSpec | JobSpecTemplate {
  if (!isHex(bytes) || bytes.length > 524290)
    fail('Invalid or oversized JobSpec encoding.');
  const valid: (JobSpec | JobSpecTemplate)[] = [];
  for (const template of options?.format
    ? [options.format === 'template']
    : [false, true]) {
    try {
      const w = decodeAbiParameters(
        [(template ? JOB_TEMPLATE_PARAM : JOB_SPEC_PARAM) as AbiParameter],
        bytes
      )[0] as SpecWire & TemplateWire;
      const reads: JobRead[] = w.reads.map(({ fills: rawFills, ...r }) => ({
        ...r,
        ...(template
          ? {
              fills: (rawFills ?? []).map((f) => {
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
      }));
      const checks = w.checks.map((c) => {
        const common = {
          read: c.read,
          evaluation: EVALUATIONS[c.evaluation],
          operation: OPERATIONS[c.operation],
        };
        if (!template) return { ...common, target: c.target };
        const t = c as unknown as TemplateCheckWire;
        const target =
          t.source === 0
            ? t.value
            : t.source === 1
            ? t.value === BigInt(10000)
              ? PRINCIPAL
              : { principalBps: t.value }
            : t.source === 2
            ? { param: Number(t.value) }
            : t.source === 3 && t.value === BigInt(0)
            ? ('agentic:wallet' as const)
            : fail('Unknown template target.');
        return { ...common, target };
      });
      const common = {
        reads,
        checks,
        logic: nestLogic(w.logic, checks.length),
        allowedMutability: MUTABILITIES[w.allowedMutability],
      };
      const spec = (
        template
          ? { ...common, params: w.params }
          : {
              ...common,
              origin: w.origin,
              executeBy: Number(w.executeBy),
              failFinalAt: Number(w.failFinalAt),
            }
      ) as JobSpec | JobSpecTemplate;
      if (encodeJobSpec(spec).toLowerCase() === bytes.toLowerCase())
        valid.push(spec);
    } catch {
      /* Wrong shape, unsupported wire, malformed enums or noncanonical bytes. */
    }
  }
  if (valid.length !== 1)
    fail(
      'The bytes do not identify one supported canonical deployed-v2 JobSpec format.',
      'UNSUPPORTED_JOB_SPEC'
    );
  return valid[0];
}
