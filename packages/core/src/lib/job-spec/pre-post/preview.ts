import type { JobSpecPreview, Operation } from '../types';
import { int256 } from '../codec';
import type { CHAIN } from '../../constants/enums';
import {
  observeJobReads,
  resolveJobPreviewAccount,
  decodeJobAnswer,
} from '../preview';
import { decodePrePostJobSpec, encodePrePostJobSpec } from './codec';
import { resolvePrePostJobSpec } from './helpers';
import { JobSpecError } from '../../market/errors';
import { zeroHash } from 'viem';
import type {
  PrePostJobSpec,
  PrePostJobSpecTemplate,
  PreviewPrePostJobSpecOptions,
} from './types';
function compare(a: bigint, op: Operation, b: bigint): boolean {
  switch (op) {
    case 'EQUAL':
      return a === b;
    case 'NOT_EQUAL':
      return a !== b;
    case 'GREATER_THAN':
      return a > b;
    case 'GREATER_OR_EQUAL':
      return a >= b;
    case 'LESS_THAN':
      return a < b;
    case 'LESS_OR_EQUAL':
      return a <= b;
  }
}
/** Exact int256 arithmetic and percentage comparison used by JobSpecLib. */
export function judgePrePost(
  spec: PrePostJobSpec,
  values: readonly (bigint | null)[]
): Pick<JobSpecPreview, 'checks' | 'pass'> {
  encodePrePostJobSpec(spec);
  if (values.length !== spec.reads.length)
    throw new JobSpecError(
      'INVALID_READ_RESULT',
      'Provide one value or null per read.'
    );
  const sum = (side: number[]): bigint | null => {
    let total = BigInt(0);
    for (const i of side) {
      const n = values[i];
      if (n === null) return null;
      total = int256(total + int256(n));
    }
    return total;
  };
  const checks = spec.checks.map((c) => {
    try {
      const left = sum(c.left),
        right = sum(c.right);
      if (left === null || (c.right.length > 0 && right === null))
        return { pass: null, value: null, reason: 'READ_UNAVAILABLE' };
      if (c.evaluation === 'BOOLEAN' || c.evaluation === 'COMPARE')
        return { pass: compare(left, c.operation, c.target), value: left };
      const before = right as bigint,
        delta = int256(left - before);
      if (c.evaluation === 'NUMBER')
        return { pass: compare(delta, c.operation, c.target), value: delta };
      if (before <= BigInt(0))
        return { pass: false, value: null, reason: 'NONPOSITIVE_BASELINE' };
      const lhs = int256(delta * BigInt(10000)),
        rhs = int256(c.target * before);
      return { pass: compare(lhs, c.operation, rhs), value: lhs / before };
    } catch {
      return { pass: null, value: null, reason: 'ARITHMETIC_OVERFLOW' };
    }
  });
  const nodes: (boolean | null)[] = [];
  for (let i = spec.logic.length - 1; i >= 0; i--) {
    const n = spec.logic[i];
    if (n.kind === 'CHECK') {
      nodes[i] = checks[n.check].pass;
      continue;
    }
    const children = n.children.map((j) => nodes[j]);
    const yes = children.filter((x) => x === true).length,
      unknown = children.filter((x) => x === null).length,
      need = n.kind === 'ALL' ? children.length : n.kind === 'ANY' ? 1 : n.k;
    nodes[i] = yes >= need ? true : yes + unknown < need ? false : null;
  }
  return { checks, pass: nodes[0] };
}
export async function previewPrePostJobSpec(
  subject: PrePostJobSpec | PrePostJobSpecTemplate,
  options: PreviewPrePostJobSpecOptions
): Promise<JobSpecPreview> {
  const input = decodePrePostJobSpec(encodePrePostJobSpec(subject), {
    format: 'params' in subject ? 'template' : 'spec',
  });
  options = {
    ...options,
    params: options.params && [...options.params],
    accounts: { ...options.accounts },
    resume: options.resume && [...options.resume],
    blockNumbers: { ...options.blockNumbers },
  };
  if (
    options.maxTotalFee !== undefined &&
    (typeof options.maxTotalFee !== 'bigint' || options.maxTotalFee < BigInt(0))
  )
    throw new JobSpecError(
      'INVALID_AMOUNT',
      'maxTotalFee must be a nonnegative bigint.'
    );
  if ('params' in input && options.wallet) {
    for (const [i, read] of input.reads.entries()) {
      const chain = `${read.chainNamespace}:${read.chainId}`;
      if (
        !options.accounts?.[chain] &&
        (read.fills?.some((f) => f.source === 'WALLET') ||
          input.checks.some(
            (c) => c.left[0] === i && c.target === 'agentic:wallet'
          ))
      ) {
        const account = await resolveJobPreviewAccount(
          options.client.universal,
          options.wallet,
          chain as CHAIN
        );
        if (account)
          options.accounts = { ...options.accounts, [chain]: account };
      }
    }
  }
  const spec =
    'params' in input
      ? resolvePrePostJobSpec(input, {
          principal: options.principal ?? BigInt(0),
          params: options.params ?? [],
          accounts: options.accounts ?? {},
          origin: zeroHash,
        })
      : input;
  if (
    'params' in input &&
    options.principal === undefined &&
    input.checks.some(
      (c) =>
        c.target === 'agentic:principal' ||
        (typeof c.target === 'object' && 'principalBps' in c.target)
    )
  )
    throw new JobSpecError(
      'UNFILLED_PLACEHOLDER',
      'Supply principal to resolve the template.'
    );
  const blocks = spec.reads.map((r, i) => {
    const block = options.blockNumbers?.[i];
    if (
      (r.at === 'PRE_EXECUTION' && block === undefined) ||
      (block !== undefined &&
        (typeof block !== 'bigint' ||
          block <= BigInt(0) ||
          block >= BigInt(1) << BigInt(64)))
    )
      throw new JobSpecError(
        'PREVIEW_BLOCK_REQUIRED',
        'Provide an explicit historical block for every PRE_EXECUTION read.'
      );
    return block;
  });
  const observed = await observeJobReads(
    spec.reads,
    options,
    blocks,
    (read, data) =>
      decodeJobAnswer(read, data, { maxBytes: 4096, strictArrayLength: true })
  );
  return {
    ...observed,
    ...judgePrePost(
      spec,
      observed.reads.map((r) => r.decoded)
    ),
  };
}
