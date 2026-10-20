import { getAddress, keccak256, zeroHash, type Address, type Hex } from 'viem';
import type { CHAIN } from '../constants/enums';
import { READ_OUTCOME } from '../read-state/read-state.types';
import type { ReadPrepareOptions } from '../read-state/read-params';
import { JobSpecError } from '../market/errors';
import { decodeJobSpec, encodeJobSpec, int256 } from './codec';
import { resolveJobSpec } from './helpers';
import { parseOutputs, type OutputNode } from './read';
import { PRINCIPAL } from './constants';
import type {
  JobRead,
  JobSpec,
  JobSpecTemplate,
  JobSpecPreview,
  LogicTree,
  Operation,
  PreviewJobSpecOptions,
} from './types';

const resolvers = new WeakMap<
  object,
  (wallet: Address, chain: CHAIN) => Promise<Address>
>();
/** @internal Bind the real client's configured CEA resolver without exposing its runtime. */
export function bindJobPreviewAccounts(
  universal: object,
  resolve: (wallet: Address, chain: CHAIN) => Promise<Address>
): void {
  resolvers.set(universal, resolve);
}

/** Follow the deployed V2 type codes; uint values above int256.max cannot be compared. */
export function decodeJobAnswer(read: JobRead, data: Hex): bigint {
  const bytes = BigInt((data.length - 2) / 2);
  const invalid = (): never => {
    throw new JobSpecError(
      'INVALID_READ_RESULT',
      'The consensus bytes do not contain the selected JobSpec field.'
    );
  };
  const word = (at: bigint): bigint => {
    if (at < BigInt(0) || at + BigInt(32) > bytes) return invalid();
    return BigInt('0x' + data.slice(2 + Number(at) * 2, 66 + Number(at) * 2));
  };
  const dynamic = (n: OutputNode): boolean =>
    [6, 7, 9].includes(n.code) || n.children.some(dynamic);
  const head = (n: OutputNode): bigint =>
    dynamic(n)
      ? BigInt(1)
      : n.code === 8
      ? n.children.reduce((sum, c) => sum + head(c), BigInt(0))
      : n.code === 10
      ? BigInt(n.size ?? 0) * head(n.children[0])
      : BigInt(1);
  let node = parseOutputs(read.outputs);
  let base = BigInt(0);
  for (const index of read.field) {
    let child: OutputNode;
    let start = base;
    let slot: bigint;
    if (node.code === 8) {
      child = node.children[index];
      if (!child) return invalid();
      slot =
        base +
        BigInt(32) *
          node.children
            .slice(0, index)
            .reduce((sum, c) => sum + head(c), BigInt(0));
    } else if (node.code === 9 || node.code === 10) {
      if (
        BigInt(index) >= (node.code === 9 ? word(base) : BigInt(node.size ?? 0))
      )
        return invalid();
      child = node.children[0];
      start += node.code === 9 ? BigInt(32) : BigInt(0);
      slot = start + BigInt(32) * BigInt(index) * head(child);
    } else return invalid();
    base = dynamic(child) ? start + word(slot) : slot;
    if (base > bytes) return invalid();
    node = child;
  }
  const value = word(base);
  if (node.code === 6 || node.code === 7) {
    if (base + BigInt(32) + value > bytes) return invalid();
    return BigInt.asIntN(
      256,
      BigInt(
        keccak256(
          ('0x' +
            data.slice(
              2 + Number(base + BigInt(32)) * 2,
              2 + Number(base + BigInt(32) + value) * 2
            )) as Hex
        )
      )
    );
  }
  if (node.code === 9) return BigInt.asIntN(256, value);
  if (
    (node.code === 1 && value >= BigInt(1) << BigInt(255)) ||
    (node.code === 3 && value > BigInt(1)) ||
    (node.code === 4 && value >= BigInt(1) << BigInt(160))
  )
    return invalid();
  return BigInt.asIntN(256, value);
}

function compare(value: bigint, op: Operation, target: bigint): boolean {
  switch (op) {
    case 'EQUAL':
      return value === target;
    case 'NOT_EQUAL':
      return value !== target;
    case 'GREATER_THAN':
      return value > target;
    case 'GREATER_OR_EQUAL':
      return value >= target;
    case 'LESS_THAN':
      return value < target;
    case 'LESS_OR_EQUAL':
      return value <= target;
  }
}
function combine(
  tree: LogicTree,
  checks: JobSpecPreview['checks']
): boolean | null {
  const results = tree.of.map((x) =>
    typeof x === 'number' ? checks[x].pass : combine(x, checks)
  );
  const yes = results.filter((v) => v === true).length;
  const unknown = results.filter((v) => v === null).length;
  const required =
    tree.kind === 'ALL'
      ? results.length
      : tree.kind === 'ANY'
      ? 1
      : tree.k ?? 0;
  return yes >= required ? true : yes + unknown < required ? false : null;
}

export async function previewJobSpec(
  subject: JobSpec | JobSpecTemplate,
  options: PreviewJobSpecOptions
): Promise<JobSpecPreview> {
  // Validate and copy before asynchronous work; later caller mutations must not change paid criteria.
  const input = decodeJobSpec(encodeJobSpec(subject), {
    format: 'params' in subject ? 'template' : 'spec',
  });
  options = {
    ...options,
    params: options.params && [...options.params],
    baseline: options.baseline && [...options.baseline],
    accounts: { ...options.accounts },
  };
  if (
    options.maxTotalFee !== undefined &&
    (typeof options.maxTotalFee !== 'bigint' || options.maxTotalFee < BigInt(0))
  )
    throw new JobSpecError(
      'INVALID_AMOUNT',
      'maxTotalFee must be a nonnegative bigint.'
    );
  if (options.baseline) {
    if (options.baseline.length !== input.reads.length)
      throw new JobSpecError(
        'INVALID_BASELINE',
        'Provide one baseline entry per read; use null for unknown entries.'
      );
    options.baseline.forEach((value) => {
      if (value !== null) int256(value);
    });
  }
  let spec: JobSpec;
  if ('params' in input) {
    if (
      input.checks.some(
        (c) =>
          c.target === PRINCIPAL ||
          (typeof c.target === 'object' && 'principalBps' in c.target)
      ) &&
      options.principal === undefined
    )
      throw new JobSpecError(
        'UNFILLED_PLACEHOLDER',
        'Supply principal to resolve principal-based preview targets.'
      );
    const accounts = { ...options.accounts };
    const resolve = resolvers.get(options.client.universal);
    for (const [index, read] of input.reads.entries()) {
      const chain = `${read.chainNamespace}:${read.chainId}`;
      const needed =
        read.fills?.some((f) => f.source === 'WALLET') ||
        input.checks.some(
          (c) => c.read === index && c.target === 'agentic:wallet'
        );
      if (needed && !accounts[chain] && options.wallet && resolve)
        accounts[chain] = await resolve(
          getAddress(options.wallet),
          chain as CHAIN
        );
    }
    spec = resolveJobSpec(input, {
      principal: options.principal ?? BigInt(0),
      params: options.params ?? [],
      accounts,
      origin: zeroHash,
      executeBy: 0,
      settleWindow: 1,
    });
  } else spec = input;
  const prepared = [];
  for (const read of spec.reads) {
    const readOptions: ReadPrepareOptions = {
      chain: `${read.chainNamespace}:${read.chainId}` as Extract<
        CHAIN,
        `eip155:${string}`
      >,
      callData: (read.selector + read.args.slice(2)) as Hex,
      minConfirmations: read.minConfirmations,
      expiryBlocks: options.expiryBlocks,
      refundTo: options.refundTo,
      callback: options.callback as ReadPrepareOptions['callback'],
    };
    prepared.push(
      await options.client.universal.prepareRead(read.target, readOptions)
    );
  }
  const quoted = prepared.reduce((sum, read) => sum + read.value, BigInt(0));
  if (options.maxTotalFee !== undefined && quoted > options.maxTotalFee)
    throw new JobSpecError(
      'PREVIEW_FEE_EXCEEDED',
      'The prepared read fees exceed maxTotalFee. No read was submitted.',
      { quoted, maxTotalFee: options.maxTotalFee }
    );
  const batch = await options.client.universal.executeReads(prepared, {
    progressHook: options.progressHook,
    advanced: options.advanced,
    waitForCompletion: true,
  });
  const reads: JobSpecPreview['reads'] = batch.reads.map((response, i) => {
    const value = response.raw?.resultData ?? null;
    if (response.outcome !== READ_OUTCOME.SUCCESS || value === null)
      return {
        value,
        decoded: null,
        error:
          response.errorMsg || 'The paid read did not complete successfully.',
        response,
      };
    try {
      return {
        value,
        decoded: decodeJobAnswer(spec.reads[i], value),
        response,
      };
    } catch (e) {
      return { value, decoded: null, error: (e as Error).message, response };
    }
  });
  const checks: JobSpecPreview['checks'] = spec.checks.map((check) => {
    let value = reads[check.read].decoded;
    if (value === null)
      return { pass: null, value, reason: 'READ_UNAVAILABLE' };
    if (check.evaluation === 'NUMBER' || check.evaluation === 'PERCENTAGE') {
      const before = options.baseline?.[check.read];
      if (before === undefined || before === null)
        return { pass: null, value: null, reason: 'BASELINE_REQUIRED' };
      if (check.evaluation === 'PERCENTAGE' && before === BigInt(0))
        return { pass: null, value: null, reason: 'ZERO_BASELINE' };
      try {
        value = int256(value - before);
        if (check.evaluation === 'PERCENTAGE')
          value = int256(value * BigInt(10000)) / before;
      } catch {
        return { pass: null, value: null, reason: 'ARITHMETIC_OVERFLOW' };
      }
    }
    return { pass: compare(value, check.operation, check.target), value };
  });
  return {
    reads,
    checks,
    pass: combine(spec.logic, checks),
    fees: {
      quoted,
      paid: reads.reduce((sum, r) => sum + r.response.fees.paid, BigInt(0)),
    },
  };
}
